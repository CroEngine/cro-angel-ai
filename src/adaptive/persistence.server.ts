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

/**
 * Persist a batch of analytics events. Returns the number stored, or 0 if the
 * store is unavailable. Never throws.
 */
export async function logEvents(
  site: string,
  visitorHash: string | null,
  events: AngelEvent[],
): Promise<number> {
  if (events.length === 0) return 0;
  const rows: EventRow[] = events.map((e) => ({
    site,
    type: e.type,
    decision_id: e.decisionId ?? null,
    visitor_hash: visitorHash,
    payload: (e.payload ?? {}) as Json,
  }));

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
  await logEvents(site, meta.visitorHash ?? null, [
    {
      type: meta.withheld ? "adaptation_withheld" : "adaptation_shown",
      decisionId,
      payload: {
        patterns,
        trafficSource: context.trafficSource,
        device: context.device,
        isReturning: context.isReturning,
        country: context.country,
        browser: context.browser,
        language: context.language,
        campaign: context.campaign,
        // Raw signals kept for observability — lets us see what a visit
        // classified as "other"/"direct" actually arrived with.
        referrer: meta.referrer || null,
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
 * Record a content-inventory drift report (what changed on a site between two
 * crawls) as a single `inventory_drift` row in angel_events. Reuses the events
 * table so no schema migration is needed; the dashboard/telemetry can read it
 * back like any other event. Best-effort; never throws.
 */
export async function recordInventoryDrift(
  site: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("angel_events").insert({
      site,
      type: "inventory_drift",
      decision_id: null,
      visitor_hash: null,
      payload: payload as Json,
    });
    if (error) {
      console.warn(`[angel] drift record skipped: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[angel] drift record unavailable:`, err);
    return false;
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
}

const DEFAULT_SITE_CONFIG: SiteConfig = {
  mode: "anonymous",
  holdoutPct: 0,
  conversionUrl: null,
  conversionSelector: null,
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
    const { data, error } = await supabaseAdmin
      .from("angel_sites")
      .select("consent_mode,holdout_pct,conversion_url,conversion_selector")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return DEFAULT_SITE_CONFIG;
    const pct = typeof data.holdout_pct === "number" ? data.holdout_pct : 0;
    return {
      mode: data.consent_mode === "attested" ? "attested" : "anonymous",
      holdoutPct: Math.max(0, Math.min(100, pct)),
      conversionUrl: data.conversion_url ?? null,
      conversionSelector: data.conversion_selector ?? null,
    };
  } catch (err) {
    console.warn(`[angel] site-config read unavailable:`, err);
    return DEFAULT_SITE_CONFIG;
  }
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
