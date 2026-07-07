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
import { emptyInventory } from "./inventory";
import { loadInventoryRows, sandboxRealSlug } from "./persistence.server";
import type { ContentInventory } from "./types";

function hasAnyItems(inventory: ContentInventory): boolean {
  return Object.values(inventory.slots).some((items) => items && items.length > 0);
}

export async function resolveInventory(site: string, path = "/"): Promise<ContentInventory> {
  // 0. Sandbox-spegel av en redan skördad sajt: läs den RIKTIGA sajtens
  // inventory så förhandsgranskningen adapterar som kundens sida gör (utan
  // det deklinerar allt innehållsberoende med no_inventory_for_slot fast
  // skörden finns). Skörd från spegeln skrivs fortsatt under sandbox-slugen —
  // spegel-DOM får aldrig förorena kundens inventory.
  const real = sandboxRealSlug(site);
  if (real) {
    const fromRealDb = await loadInventoryRows(real, path);
    if (fromRealDb && hasAnyItems(fromRealDb)) return fromRealDb;
  }

  // 1. Crawler-persisted inventory in the database, scoped to this page.
  const fromDb = await loadInventoryRows(site, path);
  if (fromDb && hasAnyItems(fromDb)) return fromDb;

  // 2. A real captured corpus snapshot bundled in the repo.
  for (const slug of real ? [real, site] : [site]) {
    if (!hasGolden(slug)) continue;
    try {
      const inv = mapGoldenToInventory(await loadGolden(slug), site);
      if (hasAnyItems(inv)) return inv;
    } catch (err) {
      console.warn(`[angel] corpus inventory for "${slug}" unavailable:`, err);
    }
  }

  // 3. Ingen skörd, ingen corpus → tomt inventory (decide declinar ärligt).
  // Demo-fixturen serveras inte längre här — /demo är borttagen och
  // getDemoInventory lever kvar enbart som testernas referens-fixture.
  return emptyInventory(site);
}
