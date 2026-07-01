// Angel Adaptive — map crawler output into a ContentInventory (blueprint Step 2).
//
// The crawler (src/lib/tests) produces a rich PageAuditData per page. The
// persisted corpus golden.json is a *reduced* form of that (selectors stripped,
// entity arrays normalized). Both are real, so we provide two pure mappers:
//
//   mapAuditToInventory(audit)  — canonical: full live crawler output, WITH
//                                  selectors. This is what production persists.
//   mapGoldenToInventory(golden)— corpus adapter: the reduced golden snapshot.
//                                  Text slots (cta/headline/microcopy) are
//                                  recovered; reveal/move_up slots are recorded
//                                  as "present" but without selectors (golden
//                                  strips them — live crawler output keeps them).
//
// Both are pure functions over plain objects, so they are tested directly
// against the real corpus and synthetic audits.

import type {
  CTAEntity,
  PageAuditData,
  PageSection,
  SectionType,
  TrustSignal,
  TrustSignalType,
} from "@/lib/tests/schema";
import type { ContentInventory, InventoryItem, InventorySlot } from "./types";

// Cap per slot: high enough to keep long testimonial/feature/CTA lists whole,
// bounded so a pathological page can't produce unbounded inventory.
const MAX_PER_SLOT = 24;

/**
 * The tag name of a selector's terminal element (e.g. "a:nth-of-type(2) > button"
 * → "button"). Stored as a locator hint so re-resolution by text can also match
 * on element type — narrowing false positives when a selector drifts. Returns
 * undefined for id/class-only terminals with no leading tag.
 */
export function terminalTag(selector: string | undefined): string | undefined {
  if (!selector) return undefined;
  const last = selector.split(/[>\s+~]+/).filter(Boolean).pop() ?? "";
  const m = last.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
  return m ? m[1].toLowerCase() : undefined;
}

/** Derive the CTA *intent* the engine keys on (demo/trial/sales) from a label. */
export function classifyCtaIntent(text: string): "demo" | "trial" | "sales" {
  const t = text.toLowerCase();
  if (/\bdemo\b|book a|request a|get a demo|see it in action/.test(t)) return "demo";
  if (/contact|talk to|sales|enterprise|get in touch/.test(t)) return "sales";
  return "trial"; // free / start / sign up / get started / try
}

/** Published reassurance phrases worth re-surfacing, keyed by microcopy kind. */
const MICROCOPY_PATTERNS: { kind: string; rx: RegExp }[] = [
  { kind: "no_credit_card", rx: /no credit card( required)?/i },
  { kind: "setup_time", rx: /\b\d+[- ]?(?:min|minute)s?\b[^.]*\bsetup\b|set up in[^.]*\bmin/i },
  { kind: "continuity", rx: /continue where you left off/i },
  { kind: "guarantee", rx: /money[- ]back|cancel anytime|satisfaction guarantee/i },
];

/** Pull published microcopy out of a pool of on-page texts. */
export function extractMicrocopy(texts: string[]): InventoryItem[] {
  const out: InventoryItem[] = [];
  const seen = new Set<string>();
  for (const raw of texts) {
    const text = (raw ?? "").trim();
    if (!text || text.length > 80) continue;
    for (const { kind, rx } of MICROCOPY_PATTERNS) {
      if (seen.has(kind)) continue;
      if (rx.test(text)) {
        seen.add(kind);
        out.push({ id: `microcopy-${kind}`, slot: "microcopy", text, meta: { kind } });
      }
    }
  }
  return out;
}

const TRUST_SLOT: Partial<Record<TrustSignalType, InventorySlot>> = {
  testimonial: "testimonial",
  review_rating: "trust_badge",
  stars: "trust_badge",
  stars_aggregate: "trust_badge",
  trusted_by: "customer_logos",
  customer_logos: "customer_logos",
  review_badges: "trust_badge",
  certification: "trust_badge",
  guarantee: "guarantee",
  secure_payment: "security",
  press_mention: "trust_badge",
  social_proof_count: "trust_badge",
};

const SECTION_SLOT: Partial<Record<SectionType, InventorySlot>> = {
  hero: "hero",
  logos: "customer_logos",
  features: "feature",
  benefits: "feature",
  testimonials: "testimonial",
  reviews: "testimonial",
  pricing: "pricing",
  faq: "faq",
};

/** Accumulates items per slot with dedup (by text|selector) and a per-slot cap. */
class InventoryBuilder {
  private slots = new Map<InventorySlot, InventoryItem[]>();
  private seen = new Map<InventorySlot, Set<string>>();

  add(slot: InventorySlot, item: Omit<InventoryItem, "id" | "slot"> & { id?: string }): void {
    const list = this.slots.get(slot) ?? [];
    if (list.length >= MAX_PER_SLOT) return;
    // Anchor on text|selector; presence-only items (neither) dedup on their id.
    const hasAnchor = Boolean(item.text || item.selector);
    const key = hasAnchor ? `${item.text ?? ""}|${item.selector ?? ""}` : `#${item.id ?? ""}`;
    if (key === "#") return; // nothing identifies this item at all
    const seen = this.seen.get(slot) ?? new Set<string>();
    if (seen.has(key)) return;
    seen.add(key);
    this.seen.set(slot, seen);
    // Stash the terminal element tag as an extra locator hint (see terminalTag).
    const tag = terminalTag(item.selector);
    const meta = tag ? { ...(item.meta ?? {}), tag } : item.meta;
    list.push({
      id: item.id ?? `${slot}-${list.length}`,
      slot,
      text: item.text,
      selector: item.selector,
      meta,
    });
    this.slots.set(slot, list);
  }

  build(site: string): ContentInventory {
    const slots: ContentInventory["slots"] = {};
    for (const [slot, items] of this.slots) slots[slot] = items;
    return { site, slots };
  }
}

function ctaItem(text: string, selector: string | undefined, extraMeta: Record<string, string>) {
  return {
    text,
    selector,
    meta: { intent: classifyCtaIntent(text), ...extraMeta },
  };
}

/**
 * Canonical mapper: full live crawler output → ContentInventory, preserving the
 * selectors the snippet needs to target real DOM. Defensive against missing
 * fields so partial audits don't throw.
 */
export function mapAuditToInventory(
  audit: Partial<PageAuditData>,
  site = audit.url ?? "site",
): ContentInventory {
  const b = new InventoryBuilder();
  const textPool: string[] = [];

  for (const cta of (audit.ctas ?? []) as CTAEntity[]) {
    if (!cta?.text) continue;
    textPool.push(cta.text);
    b.add(
      "cta",
      ctaItem(cta.text, cta.selector, {
        elementIntent: cta.intent,
        category: cta.category,
        aboveFold: String(cta.aboveFold),
      }),
    );
  }

  if (audit.hero?.headline) {
    b.add("headline", { text: audit.hero.headline });
    textPool.push(audit.hero.headline);
  }
  if (audit.hero?.primaryCtaText) {
    b.add("cta", ctaItem(audit.hero.primaryCtaText, undefined, { source: "hero" }));
    textPool.push(audit.hero.primaryCtaText);
  }
  for (const h1 of audit.headings?.h1Texts ?? []) {
    if (h1) b.add("headline", { text: h1 });
  }

  for (const ts of (audit.trustSignals ?? []) as TrustSignal[]) {
    if (!ts?.type) continue;
    if (ts.text) textPool.push(ts.text);
    const slot = TRUST_SLOT[ts.type];
    if (!slot) continue;
    const meta: Record<string, string> = { trustType: ts.type };
    if (ts.personName) meta.personName = ts.personName;
    if (ts.company) meta.company = ts.company;
    if (typeof ts.logoCount === "number") meta.logoCount = String(ts.logoCount);
    b.add(slot, { text: ts.text, selector: ts.selector, meta });
  }

  for (const section of (audit.sections ?? []) as PageSection[]) {
    const slot = SECTION_SLOT[section.type];
    if (!slot) continue;
    b.add(slot, {
      text: section.heading || undefined,
      selector: section.selector,
      meta: { sectionType: section.type, position: String(section.position) },
    });
  }

  for (const mc of extractMicrocopy(textPool)) b.add("microcopy", mc);

  return b.build(site);
}

// ---- corpus (reduced golden) adapter ---------------------------------------

interface GoldenElement {
  text?: string;
  category?: string;
  intent?: string;
}
interface GoldenShape {
  collect?: { elements?: GoldenElement[] };
  pageAudit?: {
    hero?: { headline?: string; primaryCtaText?: string };
    headings?: { h1?: string[]; h1Texts?: string[] };
    trustSummary?: { byType?: Record<string, number> };
    sectionOrder?: string[];
  };
}

const CTA_CATEGORIES = new Set(["cta_primary", "cta_secondary", "form_submit"]);

/**
 * Corpus adapter: the reduced golden snapshot → ContentInventory. Recovers the
 * text slots (CTA labels, headlines, microcopy) from `collect.elements` and
 * `pageAudit`, and records reveal/reorder slots as present (golden strips the
 * selectors those ops need — the live crawler keeps them, see mapAuditToInventory).
 */
export function mapGoldenToInventory(golden: unknown, site: string): ContentInventory {
  const g = (golden ?? {}) as GoldenShape;
  const b = new InventoryBuilder();
  const pa = g.pageAudit ?? {};
  const elements = g.collect?.elements ?? [];
  const textPool: string[] = [];

  for (const el of elements) {
    const text = (el.text ?? "").trim();
    if (text) textPool.push(text);
    const isCta = (el.category && CTA_CATEGORIES.has(el.category)) || el.intent === "conversion";
    if (isCta && text && text.length <= 60) {
      b.add("cta", ctaItem(text, undefined, { category: el.category ?? "", source: "collect" }));
    }
  }

  if (pa.hero?.headline) {
    b.add("headline", { text: pa.hero.headline });
    b.add("hero", { text: pa.hero.headline, meta: { source: "hero" } });
    textPool.push(pa.hero.headline);
  }
  if (pa.hero?.primaryCtaText) {
    b.add("cta", ctaItem(pa.hero.primaryCtaText, undefined, { source: "hero" }));
    textPool.push(pa.hero.primaryCtaText);
  }
  for (const h1 of pa.headings?.h1 ?? pa.headings?.h1Texts ?? []) {
    if (h1) b.add("headline", { text: h1 });
  }

  // Trust slots: golden only carries counts per type, not text/selectors.
  for (const [type, count] of Object.entries(pa.trustSummary?.byType ?? {})) {
    if (!count) continue;
    const slot = TRUST_SLOT[type as TrustSignalType];
    if (slot)
      b.add(slot, {
        id: `${slot}-present`,
        meta: { trustType: type, count: String(count), present: "true" },
      });
  }

  // Section presence (order is meaningful but selectors are stripped here).
  for (const type of pa.sectionOrder ?? []) {
    const slot = SECTION_SLOT[type as SectionType];
    if (slot) b.add(slot, { id: `${slot}-present`, meta: { sectionType: type, present: "true" } });
  }

  for (const mc of extractMicrocopy(textPool)) b.add("microcopy", mc);

  return b.build(site);
}
