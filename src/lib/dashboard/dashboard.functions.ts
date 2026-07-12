// Angel Adaptive — dashboard data (server function).
//
// getDashboard reads angel_sites / angel_events / angel_content_inventory via
// the service-role admin client (RLS is locked down, so reads are server-side),
// then runs the pure aggregator. It is resilient: if the service-role key or the
// tables are unavailable, it returns an empty, dbAvailable:false envelope so the
// UI renders a clean empty state instead of erroring.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { GOAL_KINDS, type GoalCandidate } from "@/adaptive/crawler-inventory";
import {
  aggregate,
  expandSegmentLeaves,
  attachRecent,
  RECENT_WINDOW_DAYS,
  type DashboardMetrics,
  type DashEvent,
  type InventoryEntry,
} from "./aggregate";

// ---- tenancy helpers (server-only) ------------------------------------------

/** Emails allowed to see/administer every site (comma-separated env). */
export function isAdminEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const set = new Set(
    (process.env.ANGEL_ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(email.toLowerCase());
}

type AuthCtx = { userId: string; claims: { email?: string } };

/** True if the caller may see/configure `slug`: an admin, or a member of it. */
async function ownsSite(
  admin: { from: (t: string) => any },
  ctx: AuthCtx,
  slug: string,
): Promise<boolean> {
  if (isAdminEmail(ctx.claims?.email)) return true;
  const { data } = await admin
    .from("angel_site_members")
    .select("id")
    .eq("user_id", ctx.userId)
    .eq("site_slug", slug)
    .maybeSingle();
  return !!data;
}

const genKey = () => "ak_" + globalThis.crypto.randomUUID().replace(/-/g, "");

export interface SiteRef {
  slug: string;
  name: string | null;
  domain: string | null;
}

export type ConsentMode = "anonymous" | "attested";

/** The selected site's owner-set config (attestation + measurement), as shown
 *  and edited in the dashboard. Served to the snippet via
 *  /api/adaptive/consent-config. */
export interface SiteConfigView {
  consentMode: ConsentMode;
  holdoutPct: number;
  conversionUrl: string | null;
  conversionSelector: string | null;
  /** The goal's visible label (auto-harvested), e.g. "Skapa konto". */
  conversionText: string | null;
  /** Who set the goal: 'auto' (legacy pre-confirm pick) | 'owner' (confirmed) | null. */
  conversionSource: "auto" | "owner" | null;
  /** WHAT converting means (GoalKind), persisted at confirm; null on raw
   *  owner overrides and legacy rows. */
  conversionKind: string | null;
  /** Per-site write key gating the ingest endpoints. null = unkeyed. */
  ingestKey: string | null;
  /** Observe-first (croengine-vision.md): false (default) → Angel observerar
   *  bara, inga synliga adaptationer körs. Bevis-vyn visar då "Observera-läge"
   *  i st f en tom arm-tabell. */
  adaptationsEnabled: boolean;
  /** Fas 4 master-switch (fas4-per-segment-serving.md): false (default) → inga
   *  per-segment-varianter serveras, oavsett variantstatus. Manuell dashboard-
   *  toggle (ägarbeslut 2026-07-12). decide-vägen läser den inte ännu. */
  servingEnabled: boolean;
  /** The judged business type, when detected (e.g. "comparison"). */
  businessType: string | null;
  /** Ranked conversion-goal candidates proposed at harvest — the owner confirms
   *  one to activate Angel. Empty until the first harvest judges the page. */
  goalCandidates: GoalCandidate[];
}

/** En redesign-variant i dashboardens livscykelvy (Fas 4). ops visas som antal —
 *  detaljerna (grind-verdikt, skärmdumpar) bor i evidence och får en egen yta
 *  när servering kopplas in. */
export interface VariantView {
  id: string;
  path: string;
  segmentKey: string;
  status: "candidate" | "verified" | "serving" | "winner" | "retired";
  opsCount: number;
  updatedAt: string;
}

/** Zero-config default hold-out, applied on attestation so measurement is ready
 *  with no stats knowledge needed. Note (observe-first): the hold-out only
 *  measures once the site enables adaptations — until then no adapted arm runs,
 *  so the bucket withholds nothing. */
export const DEFAULT_HOLDOUT_PCT = 12;

const DEFAULT_SITE_CONFIG: SiteConfigView = {
  consentMode: "anonymous",
  holdoutPct: 0,
  conversionUrl: null,
  conversionSelector: null,
  conversionText: null,
  conversionSource: null,
  conversionKind: null,
  businessType: null,
  goalCandidates: [],
  ingestKey: null,
  adaptationsEnabled: false,
  servingEnabled: false,
};

export interface DashboardResponse {
  site: string;
  sites: SiteRef[];
  dbAvailable: boolean;
  generatedAt: string;
  metrics: DashboardMetrics;
  /** Defaults to the anonymous, measurement-off config when unavailable. */
  siteConfig: SiteConfigView;
  /** Fas 4: sajtens redesign-varianter (alla statusar), nyast först. */
  variants: VariantView[];
  /** Admin extras (the sandbox link) render only for ANGEL_ADMIN_EMAILS. */
  isAdmin: boolean;
}

// Seeded baseline — shown in the site picker when the DB can't be reached
// (e.g. local dev without a service-role key).
const FALLBACK_SITES: SiteRef[] = [
  { slug: "hubspot", name: "HubSpot", domain: "hubspot.com" },
];

const EVENT_LIMIT = 5000;

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1).default(FALLBACK_SITES[0].slug),
      /** Browser tz offset (Date#getTimezoneOffset) so time buckets read as the
       *  owner's local wall-clock, not UTC. */
      tzOffsetMinutes: z.number().int().min(-840).max(840).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<DashboardResponse> => {
    const { site, tzOffsetMinutes } = data;
    const ctx = context as unknown as AuthCtx;
    const generatedAt = new Date().toISOString();

    // Imported inside the handler so the service-role client never reaches the
    // client bundle.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      const admin = isAdminEmail(ctx.claims?.email);

      const { data: siteRows } = await supabaseAdmin
        .from("angel_sites")
        .select(
          "slug,name,domain,consent_mode,holdout_pct,conversion_url,conversion_selector,conversion_text,conversion_source,conversion_kind,ingest_key,adaptations_enabled,serving_enabled,goal_candidates",
        )
        .order("slug");
      // `sandbox--<host>` rows are the admin sandbox's private per-host scratch
      // sites (inventory the preview needs). They carry no measurement and must
      // never appear in the dashboard's site picker as if they were customers.
      const rows = (siteRows ?? []).filter(
        (r: { slug: string }) => !r.slug.startsWith("sandbox--"),
      );

      // Ownership filter: admins see every site; everyone else only their own.
      let owned: Set<string> | null = null;
      if (!admin) {
        const { data: mem } = await supabaseAdmin
          .from("angel_site_members")
          .select("site_slug")
          .eq("user_id", ctx.userId);
        owned = new Set((mem ?? []).map((r: { site_slug: string }) => r.site_slug));
      }
      const visibleRows = admin
        ? rows
        : rows.filter((r: { slug: string }) => owned!.has(r.slug));
      const sites = visibleRows as SiteRef[];
      const canView = admin || owned!.has(site);

      // Only read a site's events/inventory if the caller may view it.
      let events: DashEvent[] = [];
      let inventory: InventoryEntry[] = [];
      let siteConfig: SiteConfigView = DEFAULT_SITE_CONFIG;
      if (canView) {
        // A failed read must surface as dbAvailable:false, NOT as an empty
        // site — "no data" gates onboarding UI (the install card), so it can't
        // be allowed to masquerade as "no traffic yet".
        const { data: eventRows, error: evError } = await supabaseAdmin
          .from("angel_events")
          .select("type,payload,visitor_hash,decision_id,created_at")
          .eq("site", site)
          .order("created_at", { ascending: false })
          .limit(EVENT_LIMIT);
        if (evError) throw evError;
        const { data: invRows, error: invError } = await supabaseAdmin
          .from("angel_content_inventory")
          .select("slot,item_id,text,selector,meta")
          .eq("site_slug", site);
        if (invError) throw invError;

        events = (eventRows ?? []).map((r) => ({
          type: r.type,
          payload: (r.payload as Record<string, unknown>) ?? {},
          visitorHash: r.visitor_hash,
          decisionId: r.decision_id,
          createdAt: r.created_at,
        }));
        inventory = (invRows ?? []).map((r) => ({
          slot: r.slot,
          id: r.item_id,
          text: r.text,
          selector: r.selector,
          meta: (r.meta as Record<string, string> | null) ?? {},
        }));

        const current = rows.find((r: { slug: string }) => r.slug === site) as
          | {
              consent_mode?: string;
              holdout_pct?: number;
              conversion_url?: string | null;
              conversion_selector?: string | null;
              conversion_text?: string | null;
              conversion_source?: string | null;
              conversion_kind?: string | null;
              ingest_key?: string | null;
              adaptations_enabled?: boolean;
              serving_enabled?: boolean;
              goal_candidates?: { businessType?: string; goals?: GoalCandidate[] } | null;
            }
          | undefined;
        if (current) {
          const judged = current.goal_candidates ?? null;
          siteConfig = {
            consentMode: current.consent_mode === "attested" ? "attested" : "anonymous",
            holdoutPct: typeof current.holdout_pct === "number" ? current.holdout_pct : 0,
            conversionUrl: current.conversion_url ?? null,
            conversionSelector: current.conversion_selector ?? null,
            conversionText: current.conversion_text ?? null,
            conversionSource:
              current.conversion_source === "auto" || current.conversion_source === "owner"
                ? current.conversion_source
                : null,
            conversionKind: current.conversion_kind ?? null,
            ingestKey: current.ingest_key ?? null,
            adaptationsEnabled: current.adaptations_enabled === true,
            servingEnabled: current.serving_enabled === true,
            businessType: typeof judged?.businessType === "string" ? judged.businessType : null,
            goalCandidates: Array.isArray(judged?.goals) ? judged.goals.slice(0, 6) : [],
          };
        }
      }

      // Fas 4: sajtens redesign-varianter (alla statusar) för livscykelvyn.
      // Best-effort — tabellen är ny och tom tills genereringskedjan skriver hit.
      let variants: VariantView[] = [];
      try {
        const { data: vRows, error: vErr } = await supabaseAdmin
          .from("angel_variants")
          .select("id,path,segment_key,status,ops,updated_at")
          .eq("site", site)
          .order("updated_at", { ascending: false })
          .limit(50);
        if (!vErr && Array.isArray(vRows)) {
          variants = vRows.map((v) => ({
            id: v.id,
            path: v.path,
            segmentKey: v.segment_key,
            status: v.status as VariantView["status"],
            opsCount: Array.isArray(v.ops) ? v.ops.length : 0,
            updatedAt: v.updated_at,
          }));
        }
      } catch (vErr) {
        console.warn(`[angel] variant list unavailable:`, vErr);
      }

      const metrics = aggregate(events, inventory, { tzOffsetMinutes });
      // Fas 2: segment över HELA historiken via angel_segment_rollup, inte
      // dashboardens EVENT_LIMIT-fönster — annars mäter volymgrinden (1000/100)
      // mot ett glidande färskt fönster och ljuger vid riktig trafik. Två anrop:
      // livstid + senaste RECENT_WINDOW_DAYS (för "över tid"-kolumnen). Bäst-
      // effort: faller tillbaka på den fönster-baserade rollupen om RPC:n dör.
      try {
        const [allRes, recentRes] = await Promise.all([
          supabaseAdmin.rpc("angel_segment_rollup", { p_site: site }),
          supabaseAdmin.rpc("angel_segment_rollup", {
            p_site: site,
            p_since: new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000).toISOString(),
          }),
        ]);
        const toLeaves = (rows: NonNullable<typeof allRes.data>) =>
          rows.map((r) => ({
            channel: r.channel,
            device: r.device,
            country: r.country,
            returning: r.is_returning === true,
            visits: Number(r.visits) || 0,
            conversions: Number(r.conversions) || 0,
            formStarts: Number(r.form_starts) || 0,
            formAbandons: Number(r.form_abandons) || 0,
          }));
        if (!allRes.error && Array.isArray(allRes.data)) {
          const allTime = expandSegmentLeaves(toLeaves(allRes.data));
          const recent =
            !recentRes.error && Array.isArray(recentRes.data)
              ? expandSegmentLeaves(toLeaves(recentRes.data))
              : [];
          metrics.segmentGroups = attachRecent(allTime, recent);
        }
      } catch (segErr) {
        console.warn(`[angel] segment rollup unavailable, using window fallback:`, segErr);
      }

      return {
        site,
        sites,
        dbAvailable: true,
        generatedAt,
        metrics,
        siteConfig,
        variants,
        isAdmin: admin,
      };
    } catch (err) {
      console.warn(`[angel] dashboard data unavailable:`, err);
      return {
        site,
        sites: FALLBACK_SITES,
        dbAvailable: false,
        generatedAt,
        metrics: aggregate([], []),
        siteConfig: DEFAULT_SITE_CONFIG,
        variants: [],
        isAdmin: false,
      };
    }
  });

/** One event in a single visitor's replayed history. Payload stays Json so the
 *  server-fn return type remains serializable. */
export interface TimelineEvent {
  id: number;
  type: string;
  payload: Record<string, Json | undefined>;
  decisionId: string | null;
  createdAt: string;
}

/** Cap a single visitor's replay — far above any real session count. */
const TIMELINE_LIMIT = 500;

/** Strip query string + hash from a referrer URL — click-through links
 *  routinely carry emails/tokens in the query, which the dashboard must not
 *  transmit. Non-URL referrers pass through truncated. */
function cleanReferrer(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw.slice(0, 200);
  }
}

/** What the timeline endpoint may transmit per event type. Conversion payloads
 *  are owner-supplied free-form meta — only the numeric `value` passes. */
function sanitizeTimelinePayload(
  type: string,
  payload: Record<string, Json | undefined>,
): Record<string, Json | undefined> {
  if (type === "conversion") {
    return typeof payload.value === "number" ? { value: payload.value } : {};
  }
  if (typeof payload.referrer === "string") {
    return { ...payload, referrer: cleanReferrer(payload.referrer) };
  }
  return payload;
}

/**
 * Fetch one identified visitor's event history for a site so the dashboard can
 * replay exactly what they did. Takes the NEWEST events (a heavy visitor's
 * history must not silently drop recent activity), returned oldest-first for
 * display; `id` breaks ties for events sharing a timestamp. Queries by
 * (site, visitor_hash) directly instead of reusing the site-wide event pull.
 * Auth-gated + ownership-checked like every dashboard read.
 */
export const getVisitorTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      visitorHash: z.string().min(1).max(256),
    }),
  )
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; events: TimelineEvent[] }> => {
      const { site, visitorHash } = data;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
        return { ok: false, events: [] };
      }
      const { data: rows, error } = await supabaseAdmin
        .from("angel_events")
        .select("id,type,payload,decision_id,created_at")
        .eq("site", site)
        .eq("visitor_hash", visitorHash)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(TIMELINE_LIMIT);
      if (error) {
        console.warn(`[angel] visitor timeline unavailable: ${error.message}`);
        return { ok: false, events: [] };
      }
      return {
        ok: true,
        events: (rows ?? [])
          .reverse()
          .map((r) => ({
            id: r.id,
            type: r.type,
            payload: sanitizeTimelinePayload(
              r.type,
              (r.payload as Record<string, Json | undefined>) ?? {},
            ),
            decisionId: r.decision_id,
            createdAt: r.created_at,
          })),
      };
    },
  );

/**
 * Set a site's consent mode (owner attestation). Writing 'attested' records the
 * owner's confirmation that they have a lawful basis / visitor consent to run
 * Angel in full; 'anonymous' reverts to storage-free operation. The snippet
 * reads this via /api/adaptive/consent-config. Best-effort but surfaces failure
 * so the UI can report it — this is a legally meaningful action.
 */
export const setConsentMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      mode: z.enum(["anonymous", "attested"]),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; mode: ConsentMode }> => {
    const { site, mode } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false, mode };
    }
    // Ensure the row exists (a site may not be registered until its snippet
    // first runs), then set the mode. Upsert on the unique slug.
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .upsert({ slug: site, consent_mode: mode }, { onConflict: "slug" });
    if (error) {
      console.warn(`[angel] setConsentMode failed: ${error.message}`);
      return { ok: false, mode };
    }
    // Zero-config measurement: attesting turns the control group on if the
    // owner never touched it (0). An explicitly chosen value is left alone.
    if (mode === "attested") {
      await supabaseAdmin
        .from("angel_sites")
        .update({ holdout_pct: DEFAULT_HOLDOUT_PCT })
        .eq("slug", site)
        .eq("holdout_pct", 0);
    }
    return { ok: true, mode };
  });

/**
 * Set a site's measurement config: holdout % and what counts as a conversion.
 * Dashboard-driven so the install tag never needs editing — the snippet picks
 * these up via /api/adaptive/consent-config (tag attributes still win as
 * explicit overrides). Empty strings clear a value.
 */
export const setMeasurementConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      holdoutPct: z.number().int().min(0).max(100),
      conversionUrl: z.string().trim().max(500).optional(),
      conversionSelector: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { site, holdoutPct, conversionUrl, conversionSelector } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false };
    }
    const { error } = await supabaseAdmin.from("angel_sites").upsert(
      {
        slug: site,
        holdout_pct: holdoutPct,
        conversion_url: conversionUrl || null,
        conversion_selector: conversionSelector || null,
        // An owner-set goal has no harvested label — clear it so click
        // detection never falls back to text belonging to the OLD goal.
        conversion_text: null,
        // ...and no judged kind either: the raw override bypasses the judge,
        // so goal-kind-conditioned rules must fall back to neutral defaults.
        conversion_kind: null,
        // An explicit save is the owner's choice — never auto-overwritten again.
        conversion_source: conversionSelector || conversionUrl ? "owner" : null,
      },
      { onConflict: "slug" },
    );
    if (error) {
      console.warn(`[angel] setMeasurementConfig failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  });

/**
 * Fas 4 master-toggle: slå på/av per-segment-servering för en sajt (ägarbeslut
 * 2026-07-12 — aktivering är en manuell dashboard-toggle). AV som standard.
 * OBS: decide-vägen läser inte flaggan ännu — toggeln styr ingenting live förrän
 * inkopplingen (steg 3) byggs; den landar först så att kontrollen finns FÖRE
 * förmågan. Bara sajtens ägare/admin får kalla den.
 */
export const setServingEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { site, enabled } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false };
    }
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .update({ serving_enabled: enabled })
      .eq("slug", site);
    if (error) {
      console.warn(`[angel] setServingEnabled failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  });

/**
 * Confirm a proposed goal candidate as the site's ACTIVE conversion goal. This
 * is the "commit" half of propose→commit: it records the owner's goal
 * (conversion_source='owner') and — unlike a raw owner override — keeps the
 * harvested label (conversion_text) so click detection can fall back to it. The
 * engine only highlights/measures this goal once the site enables adaptations
 * (angel_sites.adaptations_enabled); under observe-first that flag is off by
 * default, so confirming a goal alone changes nothing visible. Only the site's
 * owner/admin may call it.
 */
export const confirmGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      site: z.string().min(1),
      selector: z.string().trim().min(1).max(500),
      text: z.string().trim().max(300).optional(),
      url: z.string().trim().max(500).optional(),
      /** The confirmed candidate's judged GoalKind — WHAT converting means.
       *  Persisted so the runtime engine can condition on it (goal-aware
       *  clarify_cta etc.) instead of assuming SaaS demo/trial. */
      kind: z.enum(GOAL_KINDS as [string, ...string[]]).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { site, selector, text, url, kind } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, site))) {
      return { ok: false };
    }
    const { error } = await supabaseAdmin.from("angel_sites").upsert(
      {
        slug: site,
        conversion_selector: selector,
        conversion_text: text || null,
        conversion_url: url || null,
        conversion_kind: kind || null,
        conversion_source: "owner",
      },
      { onConflict: "slug" },
    );
    if (error) {
      console.warn(`[angel] confirmGoal failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true };
  });

/** Verify an account password against Supabase Auth, server-side. Returns
 *  'ok' | 'password' (wrong credentials) | 'error' (rate limit / infra). The
 *  returned session is discarded — this is a yes/no check only. */
async function verifyPassword(email: string, password: string): Promise<"ok" | "password" | "error"> {
  const url = process.env.SUPABASE_URL;
  const apikey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !apikey) return "error";
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return "ok";
    return res.status === 400 ? "password" : "error";
  } catch (err) {
    console.warn(`[angel] password verification unavailable:`, err);
    return "error";
  }
}

/**
 * Generate (or regenerate) a site's ingest key and return it. Rotating
 * invalidates the previous key, so the site's snippet tag must be updated with
 * the new value or its writes will be rejected. Because that can silently stop
 * a live site's data, a valid session is NOT enough: the caller's account
 * password is re-verified HERE, server-side — a client-side check could be
 * bypassed by anyone holding the session token.
 */
export const rotateIngestKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ site: z.string().min(1), password: z.string().min(1) }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; reason?: "auth" | "password" | "error"; key: string | null }> => {
      const ctx = context as unknown as AuthCtx;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      if (!(await ownsSite(supabaseAdmin, ctx, data.site))) {
        return { ok: false, reason: "auth", key: null };
      }
      const email = ctx.claims?.email;
      if (!email) return { ok: false, reason: "password", key: null };
      const verdict = await verifyPassword(email, data.password);
      if (verdict !== "ok") return { ok: false, reason: verdict, key: null };

      const key = genKey();
      const { error } = await supabaseAdmin
        .from("angel_sites")
        .upsert({ slug: data.site, ingest_key: key }, { onConflict: "slug" });
      if (error) {
        console.warn(`[angel] rotateIngestKey failed: ${error.message}`);
        return { ok: false, reason: "error", key: null };
      }
      return { ok: true, key };
    },
  );

/**
 * Create (or claim) a site and make the caller its owner. A brand-new slug is
 * inserted with a fresh ingest key; an existing but unowned slug (auto-
 * registered when a snippet first ran) is claimed; a slug already owned by
 * someone else is refused. Returns the slug + its ingest key so the dashboard
 * can render the install snippet. Auth-gated.
 */
export const createSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      slug: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9._-]*$/i, "letters, digits, . _ - only"),
      name: z.string().trim().max(120).optional(),
      domain: z.string().trim().max(200).optional(),
    }),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; reason?: string; slug?: string; ingestKey?: string }> => {
      const ctx = context as unknown as AuthCtx;
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const slug = data.slug.toLowerCase();

      // Refuse a slug already owned by a DIFFERENT user.
      const { data: members } = await supabaseAdmin
        .from("angel_site_members")
        .select("user_id")
        .eq("site_slug", slug);
      const ownedByOther = (members ?? []).some(
        (m: { user_id: string }) => m.user_id !== ctx.userId,
      );
      if (ownedByOther && !isAdminEmail(ctx.claims?.email)) {
        return { ok: false, reason: "taken" };
      }

      // Ensure the row exists (create-if-absent, never clobber name/domain) and
      // has a key.
      const { data: existing } = await supabaseAdmin
        .from("angel_sites")
        .select("ingest_key")
        .eq("slug", slug)
        .maybeSingle();
      let key = existing?.ingest_key ?? null;
      if (!existing) {
        key = genKey();
        const { error } = await supabaseAdmin
          .from("angel_sites")
          .insert({
            slug,
            name: data.name ?? null,
            domain: data.domain ?? null,
            ingest_key: key,
            // Consent-by-default: a new site starts ANONYMOUS (the DB default —
            // no persistent visitor id, no behavioural events) and with no
            // holdout, per docs/consent-gate.md ("never assume consent") and
            // GDPR's opt-in default. The owner flips the existing dashboard
            // attestation toggle when they have a lawful basis — setConsentMode
            // then auto-enables the DEFAULT_HOLDOUT_PCT control group, so
            // measurement is still zero-config from the moment collection is
            // actually allowed. The signup checkbox alone is not a lawful basis
            // for the VISITORS of a site the account hasn't attested.
          });
        if (error) {
          console.warn(`[angel] createSite insert failed: ${error.message}`);
          return { ok: false, reason: "error" };
        }
      }
      // Claiming an existing unkeyed site must NOT auto-generate a key: the
      // site's live tag has no data-key, so keying here would silently 403
      // every request from the running install. Locking writes is an explicit,
      // password-gated action in Settings instead.

      // Claim ownership (idempotent).
      const { error: memErr } = await supabaseAdmin
        .from("angel_site_members")
        .upsert({ user_id: ctx.userId, site_slug: slug }, { onConflict: "user_id,site_slug" });
      if (memErr) {
        console.warn(`[angel] createSite membership failed: ${memErr.message}`);
        return { ok: false, reason: "error" };
      }
      return { ok: true, slug, ingestKey: key ?? undefined };
    },
  );
