// Angel Adaptive — crawler → inventory ingest (server only).
//
// Bridges the live crawler to the content inventory: take a PageAuditData
// produced by a crawl (full, with selectors), map it to a ContentInventory,
// detect what changed since the last crawl, and persist both. This is the
// "live-crawler → saveInventory" path; the crawl itself runs in src/lib/tests
// (Browserbase/Stagehand), and the test-run stream calls ingestAudit when a run
// is started with an `ingestSite`.
//
// Best-effort: registration/persistence no-op without SUPABASE_SERVICE_ROLE_KEY,
// but the mapping + drift diff always run so callers can see what was extracted
// and what changed.

import { mapAuditToInventory } from "./crawler-inventory";
import { diffInventory } from "./inventory-drift";
import { loadInventoryRows, registerSite, saveInventory } from "./persistence.server";
import type { PageAuditData } from "@/lib/tests/schema";

export interface IngestDriftSummary {
  /** false on the first crawl — no baseline to compare against. */
  hasBaseline: boolean;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface IngestResult {
  site: string;
  /** Inventory items the mapper produced from the audit. */
  items: number;
  /** Rows actually persisted (0 if the store is unavailable). */
  saved: number;
  /** Whether the site row was registered. */
  registered: boolean;
  /** What changed since the previous stored crawl. */
  drift: IngestDriftSummary;
}

export async function ingestAudit(
  site: string,
  audit: Partial<PageAuditData>,
  meta: { domain?: string | null; name?: string | null; path?: string | null } = {},
): Promise<IngestResult> {
  // Per-page: scope inventory + drift to this page's path (defaults to homepage).
  const path = meta.path && meta.path.length > 0 ? meta.path : "/";
  const inventory = mapAuditToInventory(audit, site);
  const items = Object.values(inventory.slots).reduce((n, arr) => n + (arr?.length ?? 0), 0);

  // Read the previously-stored snapshot for THIS page BEFORE saveInventory
  // overwrites it, so we can diff this crawl against the last one.
  const prev = await loadInventoryRows(site, path);
  const drift = diffInventory(prev, inventory);

  const registered = await registerSite(site, meta);
  const saved = await saveInventory(inventory, path);

  // NOTE: drift is returned to the caller (surfaced live in the crawl/harvest
  // responses) but no longer persisted as inventory_drift events — the audit
  // found that sink was write-only: nothing ever read it back from the DB.

  return {
    site,
    items,
    saved,
    registered,
    drift: { hasBaseline: drift.hasBaseline, ...drift.counts },
  };
}
