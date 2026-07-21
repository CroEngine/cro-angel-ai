// Angel Adaptive — content inventory access (blueprint Step 2).
//
// This module is the pure, client-safe surface: the hand-authored demo
// inventory and small helpers. Resolving a real site's inventory (DB → corpus →
// demo → empty) is server-only and lives in inventory.server.ts; the crawler →
// inventory mapping lives in crawler-inventory.ts.

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
      // cancel_anytime är en EGEN kind sedan våg 8:s kind-split (guarantee =
      // pengarna-tillbaka-löften) — show_cancel_anytime konsumerar denna.
      { id: "mc-cancel", slot: "microcopy", text: "Cancel anytime", meta: { kind: "cancel_anytime" } },
      // Våg 8/S3: publicerad betaltrygghet — gör show_payment_security synlig
      // på /demo (badge vid målet).
      { id: "mc-paysec", slot: "microcopy", text: "Secure checkout", meta: { kind: "payment_security" } },
    ],
    customer_logos: [
      { id: "logos", slot: "customer_logos", selector: '[data-angel-slot="customer_logos"]' },
    ],
    testimonial: [{ id: "t1", slot: "testimonial", selector: '[data-angel-slot="testimonial"]' }],
    trust_badge: [
      // text + trustType gör show_rating_near_goal (S2) demonstrerbar på
      // /demo — det strikta predikatet kräver betygstyp + sifferform.
      {
        id: "trust",
        slot: "trust_badge",
        selector: '[data-angel-slot="trust_badge"]',
        text: "4.8 · 2,138 reviews",
        meta: { trustType: "stars_aggregate" },
      },
    ],
    guarantee: [{ id: "guarantee", slot: "guarantee", selector: '[data-angel-slot="guarantee"]' }],
    faq: [{ id: "faq", slot: "faq", selector: '[data-angel-slot="faq"]' }],
    hero: [{ id: "hero", slot: "hero", selector: '[data-angel-slot="hero"]' }],
    pricing: [{ id: "pricing", slot: "pricing", selector: '[data-angel-slot="pricing"]' }],
    case_study: [{ id: "case", slot: "case_study", selector: '[data-angel-slot="case_study"]' }],
    security: [{ id: "security", slot: "security", selector: '[data-angel-slot="security"]' }],
  },
};

/** An inventory with no content — the engine then applies only content-free patterns. */
export function emptyInventory(site: string): ContentInventory {
  return { site, slots: {} };
}

/** The hand-authored REFERENCE inventory. /demo är borttagen (sandboxen är
 *  den enda visuella verifieringsytan) — detta är numera enbart testernas
 *  rika fixture (decide.test.ts m.fl.); ingen runtime-väg serverar den. */
export function getDemoInventory(): ContentInventory {
  return DEMO_INVENTORY;
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
