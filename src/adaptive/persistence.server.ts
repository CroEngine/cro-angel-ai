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
): Promise<void> {
  await logEvents(site, null, [
    {
      type: "adaptation_shown",
      decisionId,
      payload: {
        patterns,
        trafficSource: context.trafficSource,
        device: context.device,
        isReturning: context.isReturning,
      },
    },
  ]);
}

// ---- content inventory ------------------------------------------------------

type InventoryRow = {
  site_slug: string;
  slot: string;
  item_id: string;
  text: string | null;
  selector: string | null;
  meta: Json;
};

/**
 * Persist a site's content inventory (upsert on (site_slug, item_id)). This is
 * what the crawler pipeline calls after mapping its audit. Returns the number of
 * rows written, or 0 if the store is unavailable. Never throws.
 */
export async function saveInventory(inventory: ContentInventory): Promise<number> {
  const rows: InventoryRow[] = [];
  for (const [slot, items] of Object.entries(inventory.slots)) {
    for (const item of (items ?? []) as InventoryItem[]) {
      rows.push({
        site_slug: inventory.site,
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
    const { error } = await supabaseAdmin.from("angel_content_inventory").upsert(rows, {
      onConflict: "site_slug,item_id",
    });
    if (error) {
      console.warn(`[angel] inventory persistence skipped: ${error.message}`);
      return 0;
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
export async function loadInventoryRows(site: string): Promise<ContentInventory | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("angel_content_inventory")
      .select("slot,item_id,text,selector,meta")
      .eq("site_slug", site);
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
