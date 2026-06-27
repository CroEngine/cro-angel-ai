// Angel Adaptive — content inventory access (blueprint Step 2).
//
// In production the crawler (scripts/freeze-* + src/lib/tests) builds a
// ContentInventory per site and persists it. For the end-to-end thin slice we
// ship a hand-authored inventory for the bundled demo site so the whole loop —
// snippet -> decide -> patterns -> events — can run without the crawler or a
// populated database. `loadInventory` is the single seam to swap in real,
// DB-backed inventory later.

import type { ContentInventory, InventoryItem, InventorySlot } from "./types";

/**
 * Inventory for the bundled demo landing page (`/demo`). Every item maps to a
 * `[data-angel-slot]` element on that page. CTA variants are tagged with an
 * `intent` so the engine can pick the published label that best fits a visitor.
 */
const DEMO_INVENTORY: ContentInventory = {
  site: "demo",
  slots: {
    cta: [
      {
        id: "cta-demo",
        slot: "cta",
        text: "Book a demo",
        selector: '[data-angel-slot="cta"]',
        meta: { intent: "demo" },
      },
      {
        id: "cta-trial",
        slot: "cta",
        text: "Start Free Trial",
        selector: '[data-angel-slot="cta"]',
        meta: { intent: "trial" },
      },
      {
        id: "cta-contact",
        slot: "cta",
        text: "Contact Sales",
        selector: '[data-angel-slot="cta"]',
        meta: { intent: "sales" },
      },
    ],
    microcopy: [
      {
        id: "mc-nocc",
        slot: "microcopy",
        text: "No credit card required",
        meta: { kind: "no_credit_card" },
      },
      { id: "mc-setup", slot: "microcopy", text: "2 minute setup", meta: { kind: "setup_time" } },
      {
        id: "mc-continue",
        slot: "microcopy",
        text: "Continue where you left off",
        meta: { kind: "continuity" },
      },
      { id: "mc-cancel", slot: "microcopy", text: "Cancel anytime", meta: { kind: "guarantee" } },
    ],
    customer_logos: [
      { id: "logos", slot: "customer_logos", selector: '[data-angel-slot="customer_logos"]' },
    ],
    testimonial: [{ id: "t1", slot: "testimonial", selector: '[data-angel-slot="testimonial"]' }],
    trust_badge: [
      { id: "trust", slot: "trust_badge", selector: '[data-angel-slot="trust_badge"]' },
    ],
    guarantee: [{ id: "guarantee", slot: "guarantee", selector: '[data-angel-slot="guarantee"]' }],
    faq: [{ id: "faq", slot: "faq", selector: '[data-angel-slot="faq"]' }],
    hero: [{ id: "hero", slot: "hero", selector: '[data-angel-slot="hero"]' }],
    pricing: [{ id: "pricing", slot: "pricing", selector: '[data-angel-slot="pricing"]' }],
    case_study: [{ id: "case", slot: "case_study", selector: '[data-angel-slot="case_study"]' }],
    security: [{ id: "security", slot: "security", selector: '[data-angel-slot="security"]' }],
  },
};

const EMPTY_INVENTORY = (site: string): ContentInventory => ({ site, slots: {} });

/**
 * Resolve a site's content inventory. Today: the demo fixture, or an empty
 * inventory for unknown sites (the engine then only applies content-free
 * patterns — never inventing copy). Tomorrow: a DB/corpus read keyed by site.
 */
export function loadInventory(site: string): ContentInventory {
  if (site === "demo") return DEMO_INVENTORY;
  return EMPTY_INVENTORY(site);
}

/** First inventory item for a slot, or null. */
export function firstItem(inventory: ContentInventory, slot: InventorySlot): InventoryItem | null {
  return inventory.slots[slot]?.[0] ?? null;
}

/** Find an inventory item in a slot matching a meta predicate, else the first. */
export function pickItem(
  inventory: ContentInventory,
  slot: InventorySlot,
  match?: (item: InventoryItem) => boolean,
): InventoryItem | null {
  const items = inventory.slots[slot];
  if (!items || items.length === 0) return null;
  if (match) {
    const found = items.find(match);
    if (found) return found;
  }
  return items[0];
}
