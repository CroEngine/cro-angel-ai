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
import { scrubPath } from "./harvest/sanitize";
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
    if (typeof raw.path === "string") payload.path = scrubPath(raw.path);
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
      if (cfg) return { ...cfg, mode: "anonymous", holdoutPct: 0, ingestKey: null };
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
      "consent_mode,holdout_pct,conversion_url,conversion_selector,conversion_text,conversion_kind,ingest_key,layout_patterns_enabled",
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
  };
}

/**
 * Gate a write to the public ingest endpoints (decide / events / inventory).
 * Returns true if the write is allowed:
 *   - site has no key set (NULL) → allowed (unkeyed / auto-registration path),
 *   - site has a key → allowed only if `providedKey` matches it exactly.
 * Fail-open on an infra error, consistent with the best-effort persistence
 * ethos (a DB hiccup that hides the key would also fail the write itself).
 * Never throws.
 */
export async function siteWriteAllowed(
  slug: string,
  providedKey: string | null | undefined,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("angel_sites")
      .select("ingest_key")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return true; // transient read failure → don't block legit traffic
    const key = data?.ingest_key ?? null;
    if (!key) return true; // unkeyed site
    return typeof providedKey === "string" && providedKey.length > 0 && providedKey === key;
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
