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

// Curation — keep only content that's actually reusable for CRO, drop page
// "chrome" (cookie banners, rating widgets, nav/menu/pagination, bare numbers).
// Without this the inventory fills with junk and clarify_cta could set a site's
// CTA to "Accept all cookies". Conservative by design: only unambiguous chrome
// is dropped, so real conversion CTAs are never lost.
const CHROME_TEXT_RX: RegExp[] = [
  /^\d+([.,]\d+)?$/, // bare numbers ("0", "2", "3")
  /^[★☆⭐\s]+$/, // star glyphs
  /\b\d+\s*(?:stjärn\w*|stars?)\b/i, // "1 stjärnor", "5 stars"
  /\b(?:cookies?|consent|samtycke)\b/i, // cookie/consent
  // "Accept all" / "Acceptera alla" / "Reject all" / "Godkänn alla" … — the
  // trailing `a?` covers the Swedish "alla" which has no \b after "all".
  /\b(?:accept(?:era)?\s+alla?|reject\s+alla?|allow\s+alla?|deny\s+alla?|only\s+necessary|endast\s+nödvändiga|godkänn\s+alla?|neka\s+alla?|tillåt\s+alla?|avvisa\s+alla?|manage\s+(?:cookies|preferences))\b/i,
  /^(?:logga\s?(?:in|ut)|log\s?(?:in|out)|sign\s?(?:in|out)|login|logout)$/i,
  /^(?:öppna\s+meny|open\s+menu|meny|menu|stäng|close|sök|search|skriv\s+ut|print|dela(?:\s+med\s+dig)?|share)$/i,
  /^(?:läs\s+mer|read\s+more|visa\s+mer|show\s+more|mer\s+info(?:rmation)?(?:\s*&\s*öppettider)?)$/i,
  /^(?:«|»|‹|›|<|>|\.{2,}|prev(?:ious)?|next|föregående|nästa|tillbaka|back|hem|home)$/i,
  // bare social-platform links (a real CTA is "Follow us on Instagram", not "Instagram")
  /^(?:instagram|facebook|twitter|x|linkedin|tiktok|youtube|pinterest|snapchat|whatsapp|telegram|threads|reddit)$/i,
  // listing sort/filter controls (forum / blog / catalog chrome, not conversions).
  // Unicode-aware so Nordic letters in "flest röster" / "mest lästa" match.
  /^(?:popul[äa]rt?|popular|senaste|latest|nyast?|newest|äldst[ae]?|oldest|trending|topp(?:listan|en)?|top|genom\s+tiderna|all\s*time|(?:mest|flest)\s+[\p{L}\s]+|sortera|sort(?:\s+by)?|filtrera|filter|visa\s+alla|show\s+all|se\s+alla|view\s+all|alla\s+[\p{L}\s]+)$/iu,
];

/** True when a label is page chrome, not reusable CRO content. */
export function isChromeText(text: string | undefined | null): boolean {
  const t = (text ?? "").trim();
  if (t.length < 2) return true;
  return CHROME_TEXT_RX.some((rx) => rx.test(t));
}

/** True when a string looks like two DOM text nodes scraped together — a
 *  sentence-ending punctuation glued straight onto a capitalised word with no
 *  space (e.g. "Toppen-produkt.Forum", "varför?Forum"). These are card/post
 *  titles bleeding a trailing category label; the text is unreliable as copy.
 *  Deliberately narrow: a lowercase word, then sentence punctuation, then a
 *  capitalised word — so "YouTube"/"iPhone" (no punctuation) and "U.S. Bank"
 *  (abbreviation, no lowercase run before the dot) are spared. */
export function looksConcatenated(text: string | undefined | null): boolean {
  return /\p{Ll}{2,}[.!?]\p{Lu}\p{Ll}/u.test((text ?? "").trim());
}

/** A CTA label longer than this is almost never a button — it's a scraped
 *  banner / sentence (e.g. "DESCUENTAZOS ¡HASTA 40% OFF! Ver ofertas"). */
export const MAX_CTA_LABEL_LEN = 40;

/** Normalise a label for dedup: trim + lowercase + collapse whitespace. */
export function normalizeLabel(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Keep a CTA only if it looks like a genuine conversion/engagement action —
 *  not nav, footer, an icon button, chrome copy, or an over-long banner blob. */
export function isReusableCta(cta: {
  text?: string;
  section?: string;
  category?: string;
}): boolean {
  if (!cta?.text || isChromeText(cta.text)) return false;
  if (cta.text.trim().length > MAX_CTA_LABEL_LEN) return false; // banner / sentence, not a label
  if (cta.section === "nav" || cta.section === "footer") return false;
  if (cta.category === "nav_item" || cta.category === "icon_button") return false;
  return true;
}

/** Most CTAs to keep per page, taken by prominence. Bounds the long tail of
 *  list/link "CTAs" on ANY language — the structural backstop that doesn't rely
 *  on knowing chrome words in that language. */
export const MAX_CTAS = 8;

/**
 * Language-agnostic prominence score: how much this reads like a real primary
 * action, from signals the audit already computed (visual weight, above-fold,
 * category, intent) — no text/wordlists. A page's most prominent actions score
 * highest; a wall of low-weight list links scores low and falls out of top-K.
 */
export function ctaScore(cta: {
  visualWeight?: number;
  aboveFold?: boolean;
  category?: string;
  intent?: string;
  competingActions?: number;
}): number {
  let s = typeof cta.visualWeight === "number" ? cta.visualWeight : 0;
  if (cta.aboveFold) s += 20;
  if (cta.category === "cta_primary") s += 30;
  else if (cta.category === "form_submit") s += 25;
  else if (cta.category === "cta_secondary") s += 12;
  if (cta.intent === "conversion") s += 15;
  // A CTA sitting among many sibling actions is usually one link in a list/nav.
  if (typeof cta.competingActions === "number" && cta.competingActions > 8) s -= 15;
  return s;
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

/** A repeated uniform strip needs at least this many members to be collapsed. */
const STRIP_MIN = 4;
/** Members of a strip are "short-labelled" up to this length. */
const STRIP_SHORT_LABEL = 18;

/**
 * In-place: collapse uniform sibling strips to their single most-prominent
 * member. A strip = ≥ STRIP_MIN CTAs that share a section AND a near-identical
 * size AND are mostly short-labelled (nav tabs / category chips / logo rows).
 * Conservative by design — only the extras are dropped, never a whole section.
 */
function collapseUniformStrips(cands: { cta: CTAEntity; score: number }[]): void {
  const groups = new Map<string, { cta: CTAEntity; score: number }[]>();
  for (const c of cands) {
    const r = c.cta.rect;
    const wb = r ? Math.round((r.w ?? 0) / 8) : 0;
    const hb = r ? Math.round((r.h ?? 0) / 8) : 0;
    const key = `${c.cta.section ?? ""}|${wb}x${hb}`;
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
    }
    g.push(c);
  }
  const suppressed = new Set<{ cta: CTAEntity; score: number }>();
  for (const members of groups.values()) {
    if (members.length < STRIP_MIN) continue;
    const short = members.filter(
      (m) => normalizeLabel(m.cta.text ?? "").length <= STRIP_SHORT_LABEL,
    ).length;
    if (short < members.length * 0.7) continue; // not a short-label strip
    members.sort((a, b) => b.score - a.score);
    for (const m of members.slice(1)) suppressed.add(m);
  }
  if (suppressed.size === 0) return;
  for (let i = cands.length - 1; i >= 0; i--) {
    if (suppressed.has(cands[i])) cands.splice(i, 1);
  }
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

  // Collect reusable CTAs, then keep only the most prominent MAX_CTAS. The
  // top-K cut is language-agnostic: it bounds the long tail of list/link
  // "CTAs" even when no chrome wordlist matches (non-EN/SV pages).
  const ctaCandidates: { cta: CTAEntity; score: number }[] = [];
  for (const cta of (audit.ctas ?? []) as CTAEntity[]) {
    if (!cta?.text) continue;
    textPool.push(cta.text); // keep for microcopy scan even if we drop the CTA
    if (!isReusableCta(cta)) continue; // curate: skip nav / footer / chrome
    ctaCandidates.push({ cta, score: ctaScore(cta) });
  }
  // Collapse uniform sibling strips (nav / category / logo rows): CTAs sharing a
  // section + near-identical size + short labels are almost always a repeated
  // list, not distinct actions ("Women · Men · Kids", "OpenAI · Figma · Ramp").
  // Keep only the most prominent of each strip — conservative: a real CTA row
  // never loses more than its extras, and a whole section is never emptied.
  collapseUniformStrips(ctaCandidates);

  ctaCandidates.sort((a, b) => b.score - a.score);
  // Dedup by label text (keep the highest-scoring instance): the same CTA often
  // repeats across cards with different selectors ("Read the customer story" ×5).
  const seenLabels = new Set<string>();
  const dedupedCtas = ctaCandidates.filter(({ cta }) => {
    const key = normalizeLabel(cta.text);
    if (seenLabels.has(key)) return false;
    seenLabels.add(key);
    return true;
  });
  for (const { cta } of dedupedCtas.slice(0, MAX_CTAS)) {
    b.add(
      "cta",
      ctaItem(cta.text, cta.selector, {
        elementIntent: cta.intent,
        category: cta.category,
        section: cta.section, // kept for the engine to reason about placement
        aboveFold: String(cta.aboveFold),
      }),
    );
  }

  if (
    audit.hero?.headline &&
    !isChromeText(audit.hero.headline) &&
    !looksConcatenated(audit.hero.headline)
  ) {
    b.add("headline", { text: audit.hero.headline });
    textPool.push(audit.hero.headline);
  }
  if (audit.hero?.primaryCtaText && !isChromeText(audit.hero.primaryCtaText)) {
    b.add("cta", ctaItem(audit.hero.primaryCtaText, undefined, { source: "hero" }));
    textPool.push(audit.hero.primaryCtaText);
  }
  for (const h1 of audit.headings?.h1Texts ?? []) {
    if (h1 && !isChromeText(h1) && !looksConcatenated(h1)) b.add("headline", { text: h1 });
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
    // Keep the section as a target, but only reuse its heading as copy when it
    // reads like real copy — not a card/post title bleed. A bad heading leaves
    // a presence-only item (selector) the snippet can still reveal / move.
    const heading =
      section.heading && !isChromeText(section.heading) && !looksConcatenated(section.heading)
        ? section.heading
        : undefined;
    b.add(slot, {
      text: heading,
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
