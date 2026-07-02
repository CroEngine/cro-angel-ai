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
import { aggregate, type DashboardMetrics, type DashEvent, type InventoryEntry } from "./aggregate";

// ---- tenancy helpers (server-only) ------------------------------------------

/** Emails allowed to see/administer every site (comma-separated env). */
function isAdminEmail(email: unknown): boolean {
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
  /** Per-site write key gating the ingest endpoints. null = unkeyed. */
  ingestKey: string | null;
}

const DEFAULT_SITE_CONFIG: SiteConfigView = {
  consentMode: "anonymous",
  holdoutPct: 0,
  conversionUrl: null,
  conversionSelector: null,
  ingestKey: null,
};

export interface DashboardResponse {
  site: string;
  sites: SiteRef[];
  dbAvailable: boolean;
  generatedAt: string;
  metrics: DashboardMetrics;
  /** Defaults to the anonymous, measurement-off config when unavailable. */
  siteConfig: SiteConfigView;
}

// Seeded baseline — shown in the site picker when the DB can't be reached
// (e.g. local dev without a service-role key).
const FALLBACK_SITES: SiteRef[] = [
  { slug: "demo", name: "Demo", domain: null },
  { slug: "hubspot", name: "HubSpot", domain: "hubspot.com" },
];

const EVENT_LIMIT = 5000;

export const getDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ site: z.string().min(1).default("demo") }))
  .handler(async ({ data, context }): Promise<DashboardResponse> => {
    const { site } = data;
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
          "slug,name,domain,consent_mode,holdout_pct,conversion_url,conversion_selector,ingest_key",
        )
        .order("slug");
      const rows = siteRows ?? [];

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
        const { data: eventRows } = await supabaseAdmin
          .from("angel_events")
          .select("type,payload,visitor_hash,decision_id,created_at")
          .eq("site", site)
          .order("created_at", { ascending: false })
          .limit(EVENT_LIMIT);
        const { data: invRows } = await supabaseAdmin
          .from("angel_content_inventory")
          .select("slot,item_id,text,selector,meta")
          .eq("site_slug", site);

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
              ingest_key?: string | null;
            }
          | undefined;
        if (current) {
          siteConfig = {
            consentMode: current.consent_mode === "attested" ? "attested" : "anonymous",
            holdoutPct: typeof current.holdout_pct === "number" ? current.holdout_pct : 0,
            conversionUrl: current.conversion_url ?? null,
            conversionSelector: current.conversion_selector ?? null,
            ingestKey: current.ingest_key ?? null,
          };
        }
      }

      return {
        site,
        sites,
        dbAvailable: true,
        generatedAt,
        metrics: aggregate(events, inventory),
        siteConfig,
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
      };
    }
  });

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
 * Generate (or regenerate) a site's ingest key and return it. Rotating
 * invalidates the previous key, so the site's snippet tag must be updated with
 * the new value or its writes will be rejected. Auth-gated.
 */
export const rotateIngestKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ site: z.string().min(1) }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; key: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(await ownsSite(supabaseAdmin, context as unknown as AuthCtx, data.site))) {
      return { ok: false, key: null };
    }
    const key = genKey();
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .upsert({ slug: data.site, ingest_key: key }, { onConflict: "slug" });
    if (error) {
      console.warn(`[angel] rotateIngestKey failed: ${error.message}`);
      return { ok: false, key: null };
    }
    return { ok: true, key };
  });

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
          .insert({ slug, name: data.name ?? null, domain: data.domain ?? null, ingest_key: key });
        if (error) {
          console.warn(`[angel] createSite insert failed: ${error.message}`);
          return { ok: false, reason: "error" };
        }
      } else if (!key) {
        key = genKey();
        await supabaseAdmin.from("angel_sites").update({ ingest_key: key }).eq("slug", slug);
      }

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
