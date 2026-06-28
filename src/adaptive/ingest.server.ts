// Angel Adaptive — crawler → inventory ingest (server only).
//
// Bridges the live crawler to the content inventory: take a PageAuditData
// produced by a crawl (full, with selectors), map it to a ContentInventory, and
// persist it for the site. This is the "live-crawler → saveInventory" path; the
// crawl itself runs in src/lib/tests (Browserbase/Stagehand), and run.functions
// calls ingestAudit when a run is started with an `ingestSite`.
//
// Best-effort: registration/persistence no-op without SUPABASE_SERVICE_ROLE_KEY,
// but the mapping always runs so callers can see what was extracted.

import { mapAuditToInventory } from "./crawler-inventory";
import { registerSite, saveInventory } from "./persistence.server";
import type { PageAuditData } from "@/lib/tests/schema";

export interface IngestResult {
  site: string;
  /** Inventory items the mapper produced from the audit. */
  items: number;
  /** Rows actually persisted (0 if the store is unavailable). */
  saved: number;
  /** Whether the site row was registered. */
  registered: boolean;
}

export async function ingestAudit(
  site: string,
  audit: Partial<PageAuditData>,
  meta: { domain?: string | null; name?: string | null } = {},
): Promise<IngestResult> {
  const inventory = mapAuditToInventory(audit, site);
  const items = Object.values(inventory.slots).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  const registered = await registerSite(site, meta);
  const saved = await saveInventory(inventory);

  return { site, items, saved, registered };
}
