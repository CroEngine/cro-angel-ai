// Angel Adaptive — best-effort event + inventory persistence (server only).
//
// The schema lives in supabase/migrations/*_adaptive_core.sql and is applied to
// our Supabase project; the angel_* tables are reflected in the generated
// `Database` types, so the admin client below is fully typed. To regenerate
// after schema changes: `supabase gen types typescript`. See supabase/README.md.
//
// Every write is best-effort: if the service-role key (SUPABASE_SERVICE_ROLE_KEY)
// is missing or the request fails, we log and continue. The adaptive loop
// (snippet -> decide -> patterns) never depends on persistence succeeding.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { templateOf } from "@/lib/page-template";
import { hostMatchesDomain, normalizeDomain, originVerdict } from "./domain";
import { cleanText, scrubPath, stripQueryHash } from "./harvest/sanitize";
import type { GoalJudgment } from "./goal-judge.server";
import type {
  AngelEvent,
  ContentInventory,
  InventoryItem,
  InventorySlot,
  VisitorContext,
} from "./types";

type EventRow = {
  site: string;
  type: string;
  decision_id: string | null;
  visitor_hash: string | null;
  payload: Json;
};

/** Admin sandbox previews run under `sandbox--<host>` slugs. They must adapt
 *  (that's the preview) but write NO analytics events — otherwise a preview
 *  would seed adaptation_shown rows that show up as measurement noise. Inventory
 *  and site registration still persist (decide reads them back); only the event
 *  log is suppressed. This is the single choke point for angel_events writes. */
export const isSandboxSlug = (slug: string): boolean => slug.startsWith("sandbox--");

/** Den RIKTIGA sajt-slugen bakom en sandbox-spegel (`sandbox--www.kund.se` →
 *  `kund.se`), eller null för vanliga slugs. Sandboxen LÄSER kundens config +
 *  inventory när sajten är konfigurerad — annars visar förhandsgranskningen av
 *  en fullt konfigurerad kund noll adaptationer (levande fynd: glutenforum i
 *  sandboxen deklinerade allt med no_goal_configured fast sajten har mål och
 *  skördat inventory). Skrivvägarna påverkas inte: event-loggen är avstängd
 *  för sandbox-slugs och skörd skrivs under sandbox-slugen. */
export const sandboxRealSlug = (slug: string): string | null =>
  isSandboxSlug(slug) ? slug.slice("sandbox--".length).replace(/^www\./, "") || null : null;

/**
 * Persist a batch of analytics events. Returns the number stored, or 0 if the
 * store is unavailable. Never throws.
 *
 * sessionId (anonymt, per flik) binder samman en besökares resa och sparas i
 * varje events payload (payload->>'sessionId') så nivå-2-rollupen kan gruppera
 * utan en schemaändring. De fritext-bärande journey-fälten (ref/path) PII-
 * skrubbas här — det enda skrivstället för event-loggen (dubbelt skydd mot
 * klientens längd-cap).
 */
/** Pure: AngelEvent[] → EventRow[] with the privacy boundary applied (PII-scrub
 *  the free-text journey fields, attach the anonymous session id). Exported for
 *  testing; the DB write below is the only caller in production. */
export function buildEventRows(
  site: string,
  visitorHash: string | null,
  events: AngelEvent[],
  sessionId?: string | null,
): EventRow[] {
  const sid = typeof sessionId === "string" && sessionId ? sessionId.slice(0, 80) : null;
  return events.map((e) => {
    const raw = (e.payload ?? {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = { ...raw };
    // PII-skrubba de fritext-bärande journey-fälten (elementets referens /
    // sidväg): e-post + långa siffror + UUID + långa opaka tokens (reset-
    // token/order-id i en path-segment eller personaliserad knapptext) —
    // scrubPath är serverns integritetsgräns, utöver klientens längd-cap.
    if (typeof raw.ref === "string") payload.ref = scrubPath(raw.ref);
    // Sidvägen är sidIDENTITET: query/hash bort FÖRE skrubben (?fbclid m.fl.
    // fragmenterade rollupen till en "sida" per klick-id — pilotfynd 2026-07-17).
    if (typeof raw.path === "string") payload.path = scrubPath(stripQueryHash(raw.path)) || "/";
    // Söktermen (site_search) är användarskriven fritext — cleanText redakterar
    // mejl + långa siffror och kapar längden. Serverns gräns utöver snippetens
    // egna vakter (bara kvalade sökfält, bara skickade termer).
    if (typeof raw.term === "string") payload.term = cleanText(raw.term).slice(0, 80);
    // Sektions-synligheten (section_engagement): sections är rubrik-keyade
    // aggregat — sidans EGEN publika copy, men rubriker kan bära inbäddad
    // PII på illa byggda sidor, så cleanText-skrubben gäller även här.
    // Hård cap (24 poster; h≤120, n 1-9, d 0-600000ms) — servern litar
    // aldrig på klientens storleksdisciplin.
    // Icke-array (förfalskad via publika track: en PII-bärande STRÄNG skulle
    // annars överleva {...raw}-spreaden ordagrant) ⇒ fältet släpps helt.
    if ("sections" in raw && !Array.isArray(raw.sections)) delete payload.sections;
    if (Array.isArray(raw.sections)) {
      payload.sections = raw.sections.slice(0, 24).flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const o = s as Record<string, unknown>;
        if (typeof o.h !== "string" || !o.h.trim()) return [];
        const n = typeof o.n === "number" && Number.isFinite(o.n) ? o.n : 1;
        const d = typeof o.d === "number" && Number.isFinite(o.d) ? o.d : 0;
        return [
          {
            h: cleanText(o.h).slice(0, 120),
            n: Math.max(1, Math.min(9, Math.round(n))),
            d: Math.max(0, Math.min(600000, Math.round(d))),
          },
        ];
      });
    }
    if (sid) payload.sessionId = sid;
    return {
      site,
      type: e.type,
      decision_id: e.decisionId ?? null,
      visitor_hash: visitorHash,
      payload: payload as Json,
    };
  });
}

export async function logEvents(
  site: string,
  visitorHash: string | null,
  events: AngelEvent[],
  sessionId?: string | null,
): Promise<number> {
  if (events.length === 0) return 0;
  // Sandbox previews never write to the event log — see isSandboxSlug.
  if (isSandboxSlug(site)) return 0;
  const rows: EventRow[] = buildEventRows(site, visitorHash, events, sessionId);

  try {
    const { error } = await supabaseAdmin.from("angel_events").insert(rows);
    if (error) {
      console.warn(`[angel] event persistence skipped: ${error.message}`);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn(`[angel] event persistence unavailable:`, err);
    return 0;
  }
}

/** Strip query string + hash before persisting a referrer — click-through URLs
 *  routinely carry emails/tokens in the query (newsletters, reset links), and
 *  origin+path is all observability needs. Non-URL referrers pass truncated. */
function cleanReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw.slice(0, 200);
  }
}

/** What one adaptation concretely did — persisted on the exposure event so the
 *  dashboard can show exactly what changed (or was withheld) for a visitor. */
export interface AdaptationChange {
  pattern: string;
  op: string;
  target: string;
  anchorText?: string;
  value?: string;
  reason?: string;
}

const trimChange = (c: AdaptationChange): AdaptationChange => ({
  pattern: c.pattern,
  op: c.op,
  target: (c.target ?? "").slice(0, 200),
  ...(c.anchorText ? { anchorText: c.anchorText.slice(0, 120) } : {}),
  ...(c.value ? { value: c.value.slice(0, 120) } : {}),
  ...(c.reason ? { reason: c.reason.slice(0, 160) } : {}),
});

/**
 * Record that a decision was made and which adaptations it produced. Stored as a
 * single `decision` event so the dashboard can reconstruct "Live Adaptations"
 * without a second table. Best-effort.
 */
/** Räkna upp en "other websites"-referrerdomän (sajt × domän × dag). Bara
 *  domänen, aldrig URL:er eller besökarkoppling — och fire-safe: ett DB-fel
 *  får aldrig röra decide-svaret. (Ägarbeslut 2026-07-26: samla nu, visa
 *  senare — datat går inte att backfilla.) */
export async function bumpReferrerDomain(site: string, domain: string): Promise<void> {
  try {
    await supabaseAdmin.rpc("angel_bump_referrer_domain", { p_site: site, p_domain: domain });
  } catch (err) {
    console.warn(`[angel] referrer-domain bump failed:`, err);
  }
}

/** Topp-domänerna bakom "other websites" — TRÖSKELGRINDAD (ägarens brus-
 *  princip): under minTotal summerade besök returneras tom lista och
 *  dashboarden visar ingenting alls. Aldrig throw. */
export async function loadTopReferrerDomains(
  site: string,
  minTotal = 20,
  limit = 8,
): Promise<{ domain: string; visits: number }[]> {
  try {
    const { data, error } = await supabaseAdmin.rpc("angel_referrer_domains_top", {
      p_site: site,
      p_limit: limit,
    });
    if (error || !Array.isArray(data)) return [];
    const rows = data
      .map((r) => ({ domain: String(r.domain ?? ""), visits: Number(r.visits) || 0 }))
      .filter((r) => r.domain && r.visits > 0);
    const total = rows.reduce((a, r) => a + r.visits, 0);
    return total >= minTotal ? rows : [];
  } catch {
    return [];
  }
}

export async function logDecision(
  site: string,
  decisionId: string,
  context: VisitorContext,
  patterns: string[],
  meta: {
    referrer?: string | null;
    userAgent?: string | null;
    visitorHash?: string | null;
    withheld?: boolean;
    consent?: string | null;
    /** The concrete changes behind `patterns` — same for both arms, so the
     *  control rows record what WOULD have been shown. */
    changes?: AdaptationChange[];
  } = {},
): Promise<void> {
  // Register the site (create-if-absent) so it appears in the dashboard's site
  // picker as soon as its snippet runs — no manual seeding needed.
  let domain: string | null = null;
  try {
    domain = new URL(context.url).hostname || null;
  } catch {
    /* non-fatal */
  }
  await registerSite(site, { domain });

  // Stamp the exposure with the visitorHash so a later conversion (same
  // visitorHash) can be attributed to these patterns. `withheld` marks the
  // control bucket — same payload, so adapted vs control are directly comparable.
  // Page path (no query/hash) so the dashboard can replay/preview the visit.
  let path: string | null = null;
  try {
    path = new URL(context.url).pathname || "/";
  } catch {
    /* non-fatal */
  }

  await logEvents(site, meta.visitorHash ?? null, [
    {
      type: meta.withheld ? "adaptation_withheld" : "adaptation_shown",
      decisionId,
      payload: {
        patterns,
        // What each pattern concretely did — capped and trimmed; jsonb payload.
        changes: (meta.changes ?? []).slice(0, 10).map(trimChange) as unknown as Json,
        path,
        trafficSource: context.trafficSource,
        device: context.device,
        isReturning: context.isReturning,
        viewedPricing: context.viewedPricing,
        country: context.country,
        browser: context.browser,
        language: context.language,
        campaign: context.campaign,
        // Referrer kept for observability (what did an "other"/"direct" visit
        // actually arrive with?) — query/hash stripped, never stored.
        referrer: cleanReferrer(meta.referrer),
        ua: (meta.userAgent ?? "").slice(0, 256) || null,
        // Consent basis used for this exposure — auditability.
        consent: meta.consent ?? null,
      },
    },
  ]);
}

// ---- content inventory ------------------------------------------------------

type InventoryRow = {
  site_slug: string;
  path: string;
  slot: string;
  item_id: string;
  text: string | null;
  selector: string | null;
  meta: Json;
};

/**
 * Persist a page's content inventory (upsert on (site_slug, path, item_id)).
 * `path` scopes the inventory to one page so different pages under a domain
 * don't overwrite each other (defaults to the homepage). Returns the number of
 * rows written, or 0 if the store is unavailable. Never throws.
 */
export async function saveInventory(inventory: ContentInventory, path = "/"): Promise<number> {
  const rows: InventoryRow[] = [];
  for (const [slot, items] of Object.entries(inventory.slots)) {
    for (const item of (items ?? []) as InventoryItem[]) {
      rows.push({
        site_slug: inventory.site,
        path,
        slot,
        item_id: item.id,
        text: item.text ?? null,
        selector: item.selector ?? null,
        meta: (item.meta ?? {}) as Json,
      });
    }
  }
  if (rows.length === 0) return 0;

  try {
    await registerSite(inventory.site);
    const { error } = await supabaseAdmin.from("angel_content_inventory").upsert(rows, {
      onConflict: "site_slug,path,item_id",
    });
    if (error) {
      console.warn(`[angel] inventory persistence skipped: ${error.message}`);
      return 0;
    }

    // Reflect the latest crawl of THIS page: drop rows for items no longer
    // present so the stored inventory is this crawl's snapshot (not a stale
    // union). Scoped to (site_slug, path). Done AFTER a successful upsert so a
    // failed write never wipes the existing inventory. Best-effort.
    const newIds = new Set(rows.map((r) => r.item_id));
    const { data: existing } = await supabaseAdmin
      .from("angel_content_inventory")
      .select("item_id")
      .eq("site_slug", inventory.site)
      .eq("path", path);
    const stale = (existing ?? [])
      .map((r: { item_id: string }) => r.item_id)
      .filter((id: string) => !newIds.has(id));
    if (stale.length > 0) {
      const { error: delError } = await supabaseAdmin
        .from("angel_content_inventory")
        .delete()
        .eq("site_slug", inventory.site)
        .eq("path", path)
        .in("item_id", stale);
      if (delError) {
        console.warn(`[angel] inventory stale-cleanup skipped: ${delError.message}`);
      }
    }

    return rows.length;
  } catch (err) {
    console.warn(`[angel] inventory persistence unavailable:`, err);
    return 0;
  }
}

/**
 * Read a site's persisted inventory back into a ContentInventory, or null when
 * the store is unavailable or has no rows for the site. Never throws.
 */
export async function loadInventoryRows(
  site: string,
  path = "/",
): Promise<ContentInventory | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("angel_content_inventory")
      .select("slot,item_id,text,selector,meta")
      .eq("site_slug", site)
      .eq("path", path);
    if (error || !data || data.length === 0) return null;

    const slots: ContentInventory["slots"] = {};
    for (const raw of data) {
      const slot = raw.slot as InventorySlot;
      if (!slot || !raw.item_id) continue;
      const item: InventoryItem = {
        id: raw.item_id,
        slot,
        text: raw.text ?? undefined,
        selector: raw.selector ?? undefined,
        meta: (raw.meta as Record<string, string> | null) ?? undefined,
      };
      (slots[slot] ??= []).push(item);
    }
    return { site, slots };
  } catch (err) {
    console.warn(`[angel] inventory read unavailable:`, err);
    return null;
  }
}

export interface SiteConfig {
  mode: "anonymous" | "attested";
  holdoutPct: number;
  conversionUrl: string | null;
  conversionSelector: string | null;
  /** The goal's visible label — click-detection fallback when the CSS selector
   *  doesn't resolve on a page. */
  conversionText: string | null;
  /** WHAT converting means (GoalKind), persisted when the owner confirms a
   *  judged candidate. null on raw owner overrides and legacy rows. */
  conversionKind: string | null;
  /** Per-site write key; SERVER-ONLY — never include it in a public response. */
  ingestKey: string | null;
  /** Nivå 3 (layout-mönster) kräver uttrycklig opt-in per sajt — v1-produkten
   *  är nivå 1–2 (relevans med minsta möjliga ingrepp). Default false. */
  layoutPatternsEnabled: boolean;
  /** Observe-first (croengine-vision.md): false (default) → Angel gör INGA
   *  synliga ändringar, bara observerar. Opt-in per sajt slår på apply-vägen. */
  adaptationsEnabled: boolean;
  /** Fas 4 master-switch (fas4-per-segment-serving.md): false (default) → inga
   *  per-segment-varianter serveras, oavsett variantstatus. Manuell dashboard-
   *  toggle (ägarbeslut 2026-07-12). */
  servingEnabled: boolean;
  /** Fas 4 steg 3: andel (1–50 %) av segment-matchade besökare som får
   *  variant-armen; resten är kontrollarm. Ägarbeslut 2026-07-12: manuell ramp
   *  5 → 10 → 25 → 50, aldrig 50/50 från start. Läses bara när
   *  servingEnabled=true. */
  rampPct: number;
  /** Betalstatus (synkas av Stripe-webhooken): exempt/none/trialing/active/
   *  past_due/canceled. Serving kräver exempt|trialing|active — observation
   *  gate:as ALDRIG av betalning. */
  billingStatus: string;
  /** Sajtens registrerade domän (normaliserad). null = legacy/labb. */
  domain: string | null;
  /** Stämplas av första domän-bevisade snippet-signalen (Origin matchar).
   *  Serving av varianter kräver stämpeln när en domän är registrerad —
   *  nyckeln i publika HTML:en bevisar inget, trafiken från rätt domän gör. */
  domainVerifiedAt: string | null;
}

const DEFAULT_SITE_CONFIG: SiteConfig = {
  mode: "anonymous",
  holdoutPct: 0,
  conversionUrl: null,
  conversionSelector: null,
  conversionText: null,
  conversionKind: null,
  ingestKey: null,
  layoutPatternsEnabled: false,
  adaptationsEnabled: false,
  servingEnabled: false,
  rampPct: 5,
  billingStatus: "exempt",
  domain: null,
  domainVerifiedAt: null,
};

/**
 * Read a site's owner-set config by slug: consent mode plus measurement config
 * (holdout %, conversion goal). 'attested' means the owner confirmed a lawful
 * basis in the dashboard, so the snippet may run at a consented baseline
 * (GPC/DNT still opt out per-visitor client-side). Anything unexpected or
 * unavailable degrades to the anonymous, measurement-off default. Never throws.
 */
export async function loadSiteConfig(slug: string): Promise<SiteConfig> {
  try {
    // Sandbox-spegel av en KONFIGURERAD sajt: läs kundens config så förhands-
    // granskningen visar det riktiga beteendet (mål → emphasize/badge/sticky,
    // layout-opt-in). Mät-/nyckelsemantiken följer INTE med: previews kör
    // anonymt, utan hold-out (adminen ska aldrig hamna i kontrollarmen av sin
    // egen förhandsgranskning) och utan ingest-nyckelkrav (spegelsnippeten har
    // ingen nyckel; sandbox-slugs skriver ändå inga events).
    const real = sandboxRealSlug(slug);
    if (real) {
      const cfg = await fetchSiteConfigRow(real);
      // Previews måste visa apply-vägen även om den riktiga sajten är i observe-
      // läge (adaptations_enabled=false) — annars kan ägaren aldrig förhands-
      // granska en adaptation innan hen slår på den. Spegeln tvingar därför på
      // adaptationsEnabled; det syns bara i sandboxen, aldrig live.
      if (cfg)
        return {
          ...cfg,
          mode: "anonymous",
          holdoutPct: 0,
          ingestKey: null,
          adaptationsEnabled: true,
        };
    }
    return (await fetchSiteConfigRow(slug)) ?? DEFAULT_SITE_CONFIG;
  } catch (err) {
    console.warn(`[angel] site-config read unavailable:`, err);
    return DEFAULT_SITE_CONFIG;
  }
}

/** One angel_sites row → SiteConfig, or null when the slug has no row. */
async function fetchSiteConfigRow(slug: string): Promise<SiteConfig | null> {
  const { data, error } = await supabaseAdmin
    .from("angel_sites")
    .select(
      "consent_mode,holdout_pct,conversion_url,conversion_selector,conversion_text,conversion_kind,ingest_key,layout_patterns_enabled,adaptations_enabled,serving_enabled,ramp_pct,domain,domain_verified_at,billing_status",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  const pct = typeof data.holdout_pct === "number" ? data.holdout_pct : 0;
  return {
    mode: data.consent_mode === "attested" ? "attested" : "anonymous",
    holdoutPct: Math.max(0, Math.min(100, pct)),
    conversionUrl: data.conversion_url ?? null,
    conversionSelector: data.conversion_selector ?? null,
    conversionText: data.conversion_text ?? null,
    conversionKind: data.conversion_kind ?? null,
    ingestKey: data.ingest_key ?? null,
    layoutPatternsEnabled: data.layout_patterns_enabled === true,
    adaptationsEnabled: data.adaptations_enabled === true,
    servingEnabled: data.serving_enabled === true,
    rampPct: typeof data.ramp_pct === "number" ? data.ramp_pct : 5,
    billingStatus: typeof data.billing_status === "string" ? data.billing_status : "exempt",
    domain: data.domain ?? null,
    domainVerifiedAt: data.domain_verified_at ?? null,
  };
}

/**
 * Fas 4: läs de varianter som FÅR serveras för (site, path) — status serving/
 * winner — i den form matchVariant (redesign/serve.ts) konsumerar. Servering är
 * dessutom master-gatad av SiteConfig.servingEnabled; den kontrollen gör
 * ANROPAREN (decide-vägen, när den kopplas in) så att detta förblir en ren
 * läsning. Best-effort: fel → tom lista, aldrig throw.
 */
export async function loadServableVariants(
  site: string,
  path: string,
): Promise<import("./redesign/serve").ServableVariant[]> {
  try {
    // Mall-nivå (2026-07-26): en variant kan bära ett mall-mönster ("/blogg/*")
    // som path-värde. Kandidaterna är exakt två deterministiska nycklar — sidan
    // och dess mall — så uppslaget förblir indexvänligt (ingen LIKE-skanning).
    // matchVariant gör själva valet (exakt sida vinner över mall).
    const tpl = templateOf(path);
    const pathKeys = tpl ? [path, tpl] : [path];
    const { data, error } = await supabaseAdmin
      .from("angel_variants")
      .select("id,site,path,segment_key,status,ops,serve_ops,required_cohorts")
      .eq("site", site)
      .in("path", pathKeys)
      .in("status", ["serving", "winner"])
      // Maskinellt serveringsstopp (drift-svepet, slice 3): en hållen variant
      // serveras aldrig — men ägarens status står orörd och förhandsvisningen
      // (loadPreviewVariant) ser den fortfarande.
      .is("held_reason", null);
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id,
      site: r.site,
      path: r.path,
      segmentKey: r.segment_key,
      status: r.status as import("./redesign/serve").VariantStatus,
      ops: (Array.isArray(r.ops) ? r.ops : []) as unknown as import("./redesign/generate").RedesignOp[],
      serveOps: (Array.isArray(r.serve_ops)
        ? r.serve_ops
        : []) as unknown as import("./redesign/serve").ServeOp[],
      requiredCohorts: Array.isArray(r.required_cohorts)
        ? (r.required_cohorts as unknown[]).filter((c): c is string => typeof c === "string")
        : undefined,
    }));
  } catch (err) {
    console.warn(`[angel] variant read unavailable:`, err);
    return [];
  }
}

/**
 * Sandbox-spegelns "se live": läs EN specifik variant för förhandsvisning.
 * Två villkor, båda hårda:
 *   1. Varianten finns och är i ett tittbart tillstånd (verified — det ägaren
 *      granskar FÖRE godkännande — eller serving/winner).
 *   2. Variantens sajt ÄGER den speglade domänen (mirrorHost) — annars kunde
 *      vilken sida som helst med snippeten begära ut en annan kunds serve-ops
 *      genom att gissa variant-id:n. Id:t är ett UUID, men vi gissar inte.
 * Best-effort: fel/mismatch → null (spegeln visar sidan som vanligt).
 */
export async function loadPreviewVariant(
  variantId: string,
  mirrorHost: string,
): Promise<{
  id: string;
  segmentKey: string;
  serveOps: import("./redesign/serve").ServeOp[];
} | null> {
  try {
    const { data: v, error } = await supabaseAdmin
      .from("angel_variants")
      .select("id,site,segment_key,status,serve_ops")
      .eq("id", variantId)
      .in("status", ["verified", "serving", "winner"])
      .maybeSingle();
    if (error || !v) return null;
    const { data: siteRow } = await supabaseAdmin
      .from("angel_sites")
      .select("domain")
      .eq("slug", v.site)
      .maybeSingle();
    const domain = normalizeDomain(siteRow?.domain ?? null);
    const host = normalizeDomain(mirrorHost);
    if (!domain || !host || !hostMatchesDomain(host, domain)) return null;
    return {
      id: v.id,
      segmentKey: v.segment_key,
      serveOps: (Array.isArray(v.serve_ops)
        ? v.serve_ops
        : []) as unknown as import("./redesign/serve").ServeOp[],
    };
  } catch (err) {
    console.warn(`[angel] preview-variant read unavailable:`, err);
    return null;
  }
}

/**
 * Gate a write to the public ingest endpoints (decide / events / inventory).
 * Two independent checks:
 *   1. Nyckeln (identifierar): keyed site → providedKey must match exactly;
 *      unkeyed → allowed (legacy/auto-registration path).
 *   2. Domänen (bevisar): a registered domain + a MISMATCHING Origin/Referer
 *      → denied (the key sits in the site's public HTML — anyone has it; the
 *      browser's Origin is the thing an attacker can't fake). Absent headers
 *      allow but never PROVE; the first genuinely matching request stamps
 *      domain_verified_at and fires the day-0 "installed" notification.
 * Fail-open on infra errors, consistent with the best-effort persistence
 * ethos. Never throws.
 */
export async function siteWriteAllowed(
  slug: string,
  providedKey: string | null | undefined,
  req?: { origin?: string | null; referer?: string | null },
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("angel_sites")
      .select("ingest_key,domain,domain_verified_at")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return true; // transient read failure → don't block legit traffic
    const key = data?.ingest_key ?? null;
    if (key && !(typeof providedKey === "string" && providedKey.length > 0 && providedKey === key)) {
      return false;
    }
    const verdict = originVerdict(data?.domain ?? null, req?.origin ?? null, req?.referer ?? null);
    if (!verdict.allowed) return false;
    if (verdict.proved && data && !data.domain_verified_at) {
      // Första domän-bevisade signalen: stämpla + dag-0-mejlet. Fire-and-forget
      // — verifieringen får aldrig kosta latens eller fel i ingest-vägen.
      void (async () => {
        try {
          await supabaseAdmin
            .from("angel_sites")
            .update({ domain_verified_at: new Date().toISOString() })
            .eq("slug", slug)
            .is("domain_verified_at", null);
          const { notifyInstalled } = await import("./notify.server");
          await notifyInstalled(slug, data.domain as string);
        } catch (err) {
          console.warn(`[angel] domänstämpel/notis föll (${slug}):`, err);
        }
      })();
    }
    return true;
  } catch (err) {
    console.warn(`[angel] site-key check unavailable:`, err);
    return true;
  }
}

/**
 * Store the harvest's ranked goal PROPOSAL (goal-judge output). Overwrites the
 * goal_candidates column each harvest; it never touches conversion_selector /
 * conversion_source — the goal only goes live when the owner confirms one
 * candidate (confirmGoal). Best-effort; never throws.
 */
export async function storeGoalCandidates(slug: string, judgment: GoalJudgment): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from("angel_sites")
      .update({ goal_candidates: judgment as unknown as Json })
      .eq("slug", slug);
    if (error) {
      console.warn(`[angel] goal-candidates store skipped: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[angel] goal-candidates store unavailable:`, err);
    return false;
  }
}

/** Read the previously-stored judgment (for the ingest cache). Never throws. */
export async function loadGoalCandidates(slug: string): Promise<GoalJudgment | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("angel_sites")
      .select("goal_candidates")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data?.goal_candidates) return null;
    return data.goal_candidates as unknown as GoalJudgment;
  } catch {
    return null;
  }
}

/**
 * Register (upsert) a site in angel_sites by slug. Best-effort; returns whether
 * the row was written. Called by saveInventory and the crawler ingest path.
 */
export async function registerSite(
  slug: string,
  opts: { domain?: string | null; name?: string | null } = {},
): Promise<boolean> {
  try {
    // Create-if-absent: never overwrite an existing row's name/domain.
    const { error } = await supabaseAdmin.from("angel_sites").upsert(
      { slug, domain: opts.domain ?? null, name: opts.name ?? null },
      {
        onConflict: "slug",
        ignoreDuplicates: true,
      },
    );
    if (error) {
      console.warn(`[angel] site registration skipped: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[angel] site registration unavailable:`, err);
    return false;
  }
}
