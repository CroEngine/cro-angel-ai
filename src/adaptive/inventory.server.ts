// Angel Adaptive — server-side inventory resolution (blueprint Step 2).
//
// Resolves the content inventory for a site, in priority order:
//   1. Database (angel_content_inventory) — the crawler's persisted output.
//   2. Corpus golden snapshot — real captured sites bundled in the repo.
//   3. The demo fixture (site === "demo").
//   4. An empty inventory — the engine then applies only content-free patterns,
//      never inventing copy.
//
// Server-only (imports the corpus bundle + Supabase). The pure pieces it uses
// — mappers and the demo fixture — live in client-safe modules.

import { hasGolden, loadGolden } from "@/lib/corpus-bundle";
import { mapGoldenToInventory } from "./crawler-inventory";
import { emptyInventory, getDemoInventory } from "./inventory";
import { loadInventoryRows } from "./persistence.server";
import type { ContentInventory } from "./types";

function hasAnyItems(inventory: ContentInventory): boolean {
  return Object.values(inventory.slots).some((items) => items && items.length > 0);
}

export async function resolveInventory(site: string): Promise<ContentInventory> {
  // 1. Crawler-persisted inventory in the database.
  const fromDb = await loadInventoryRows(site);
  if (fromDb && hasAnyItems(fromDb)) return fromDb;

  // 2. A real captured corpus snapshot bundled in the repo.
  if (hasGolden(site)) {
    try {
      const inv = mapGoldenToInventory(await loadGolden(site), site);
      if (hasAnyItems(inv)) return inv;
    } catch (err) {
      console.warn(`[angel] corpus inventory for "${site}" unavailable:`, err);
    }
  }

  // 3 & 4. Demo fixture, else empty.
  if (site === "demo") return getDemoInventory();
  return emptyInventory(site);
}
