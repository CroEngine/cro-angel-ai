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

/**
 * CTA *role*: is this element about acquiring a customer at all? Some intents
 * are NEVER conversion content regardless of site — support, login, legal,
 * search, socials, weak nav ("read more"). Items keep being harvested (the
 * dashboard shows them, labelled) but the engine never uses them and goal
 * detection never picks them. Text rules are EN+SV; the href rules are
 * language-independent (web paths follow English conventions surprisingly
 * often) — full language coverage is the LLM-labelling step (planned).
 */
export type CtaRole = "acquisition" | "support" | "auth" | "nav" | "legal" | "search" | "social";

const ROLE_RULES: { role: Exclude<CtaRole, "acquisition">; text?: RegExp; href?: RegExp }[] = [
  {
    role: "support",
    text: /\b(hj[äa]lp|help( ?cent(er|re))?|support|kundtj[äa]nst|kundservice|vanliga fr[åa]gor|faq)\b/i,
    href: /\/(help|support|faq|kundservice|kundtjanst|hjalp)([/?#]|$)/i,
  },
  {
    role: "auth",
    text: /\b(logga in|log ?in|sign ?in|inloggning|mina sidor|mitt konto|my account)\b/i,
    // Keep in agreement with AUTH_PATH_RX in context.ts (the page-type side of
    // the same taxonomy) — drift guard in goal-taxonomy.test.ts. "logga-in"/
    // "inloggning" added: the Swedish pilot's login paths weren't covered.
    href: /\/(log-?in|logga-?in|inloggning|sign-?in|auth|account\/log-?in|mina-sidor)([/?#]|$)/i,
  },
  {
    role: "legal",
    // Consent/cookie buttons ("Jag godkänner", "Acceptera alla", "Accept all")
    // are utility chrome, never a conversion goal — exclude them so they can't
    // be proposed as a candidate even when the harvester's cookie filter misses.
    text: /\b(villkor|anv[äa]ndarvillkor|integritet(spolicy)?|privacy( policy)?|terms|cookie[sr]?|gdpr|jag godk[äa]nner|godk[äa]nn(er)? alla|acceptera( alla)?|accept all|allow all|till[åa]t alla)\b/i,
    href: /\/(terms|privacy|legal|villkor|integritet|cookie)/i,
  },
  {
    role: "search",
    text: /^(s[öo]k|search)$/i,
    href: /\/search([/?#]|$)/i,
  },
  {
    role: "social",
    text: /^(facebook|instagram|twitter|x|linkedin|youtube|tiktok)$/i,
    href: /(facebook|instagram|twitter|linkedin|youtube|tiktok)\.com|(^|\.)x\.com/i,
  },
  {
    role: "nav",
    text: /^(l[äa]s mer|mer info(rmation)?|learn more|read more|see more|visa (mer|alla)|tillbaka|back|hem|home)$/i,
  },
];

export function classifyCtaRole(text: string, href?: string): CtaRole {
  const t = (text ?? "").trim();
  const h = (href ?? "").trim();
  for (const rule of ROLE_RULES) {
    if (rule.text && rule.text.test(t)) return rule.role;
    if (rule.href && h && rule.href.test(h)) return rule.role;
  }
  return "acquisition";
}

/** Below this confidence an LLM label is advisory only (shown as uncertain,
 *  never acted on). */
export const LLM_CONFIDENCE_FLOOR = 0.7;

/**
 * Resolve an item's effective role from both label sources. Precedence:
 *   1. The deterministic rule verdict (text/href) is a FLOOR — when it says
 *      support/auth/…, no LLM label can promote the item back to acquisition
 *      (bounds prompt-injection via page content to "stays excluded").
 *   2. A confident LLM label may DEMOTE an item the rules missed
 *      (e.g. "Hilfe" with no tell-tale href).
 *   3. Otherwise acquisition — including legacy rows with no labels at all.
 */
export function resolveRole(item: { meta?: Record<string, string> }): CtaRole {
  const m = item.meta ?? {};
  if (m.role && m.role !== "acquisition") return m.role as CtaRole;
  const conf = Number(m.llmConfidence ?? "0");
  if (m.llmRole && m.llmRole !== "acquisition" && conf >= LLM_CONFIDENCE_FLOOR) {
    return m.llmRole === "other" ? "nav" : (m.llmRole as CtaRole);
  }
  return "acquisition";
}

/** True when an inventory item may be used for conversion work (goal pick,
 *  pattern content). Items without any label (legacy harvests) pass. */
export function isAcquisition(item: { meta?: Record<string, string> }): boolean {
  return resolveRole(item) === "acquisition";
}

/** Derive the CTA *intent* the engine keys on (demo/trial/sales) from a label.
 *  EN + SV — the pilot market is Swedish; extend per market. */
export function classifyCtaIntent(text: string): "demo" | "trial" | "sales" {
  const t = text.toLowerCase();
  if (/\bdemo\b|book a|request a|get a demo|see it in action|boka (en )?demo|visning/.test(t))
    return "demo";
  if (/contact|talk to|sales|enterprise|get in touch|kontakt|offert|prata med/.test(t))
    return "sales";
  return "trial"; // free / start / sign up / prova / kom igång / skapa konto
}

/** Published reassurance phrases worth re-surfacing, keyed by microcopy kind.
 *  EN + SV variants per kind. */
const MICROCOPY_PATTERNS: { kind: string; rx: RegExp }[] = [
  { kind: "no_credit_card", rx: /no credit card( required)?|(inget|utan) (kredit)?kort/i },
  {
    kind: "setup_time",
    rx: /\b\d+[- ]?(?:min|minute)s?\b[^.]*\bsetup\b|set up in[^.]*\bmin|klart? p[åa] \d+ min|ig[åa]ng p[åa] \d+/i,
  },
  { kind: "continuity", rx: /continue where you left off|forts[äa]tt d[äa]r du (var|slutade)/i },
  {
    kind: "guarantee",
    rx: /money[- ]back|cancel anytime|satisfaction guarantee|pengarna tillbaka|avsluta n[äa]r som helst|ingen bindningstid/i,
  },
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

// NOTE: features/benefits sections are deliberately NOT mapped — no pattern
// consumes a "feature" slot, so harvesting it was storage for nothing (audit).
const SECTION_SLOT: Partial<Record<SectionType, InventorySlot>> = {
  hero: "hero",
  logos: "customer_logos",
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

function ctaItem(
  text: string,
  selector: string | undefined,
  extraMeta: Record<string, string>,
  href?: string,
) {
  return {
    text,
    selector,
    meta: {
      intent: classifyCtaIntent(text),
      role: classifyCtaRole(text, href),
      // Kept for the labeller's change-detection cache and transparency.
      ...(href ? { href: href.slice(0, 200) } : {}),
      ...extraMeta,
    },
  };
}

/**
 * Multiplicity IS prominence for a repeated ACTION strip: on a booking
 * marketplace's service page, 16 identical row-level "Boka" buttons are the
 * page's dominant action even though each button alone is small
 * (cta_secondary, below fold) — scored singly, the collapsed rep falls out of
 * MAX_CTAS/MAX_GOAL_CANDIDATES under one-off chrome primaries ("Fler bilder",
 * "Lägg till i favoriter"). Aggregate the strip's visual weight, bounded so a
 * huge list can't drown the hero CTA chain entirely. Conversion-intent only:
 * nav/category chips and logo rows keep their single-member score.
 *
 * SHARED by curateCtas (strip collapse) and rankGoalCandidates (goal floor) —
 * the bonus must not get lost between curation and goal ranking, or the goal
 * floor re-buries exactly the CTA the collapse just surfaced.
 */
export function stripAggregateBonus(
  intent: string | undefined,
  visualWeight: number,
  variantCount: number,
): number {
  if (intent !== "conversion" || variantCount <= 1) return 0;
  return Math.min(variantCount - 1, 11) * visualWeight;
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
    // Keep the most-prominent member, but stamp it with the strip's size + a few
    // sibling labels so goal judgment still sees "1 of an N-item grid" (a strong
    // comparison-portal / category-funnel signal) even though the rest are dropped.
    const rep = members[0].cta;
    rep.variantCount = members.length;
    rep.variantSample = members
      .slice(1)
      .map((m) => (m.cta.text ?? "").trim())
      .filter((t) => t && t !== (rep.text ?? "").trim())
      .slice(0, 4);
    members[0].score += stripAggregateBonus(
      rep.intent,
      typeof rep.visualWeight === "number" ? rep.visualWeight : 0,
      members.length,
    );
    for (const m of members.slice(1)) suppressed.add(m);
  }
  if (suppressed.size === 0) return;
  for (let i = cands.length - 1; i >= 0; i--) {
    if (suppressed.has(cands[i])) cands.splice(i, 1);
  }
}

/**
 * The CTA curation pipeline, as one explicit sequence:
 *   filter (chrome / nav / footer / icon / banner)
 *   → score (language-free prominence)
 *   → collapse uniform sibling strips (nav / category / logo rows)
 *   → rank by prominence
 *   → dedup by label
 *   → cap to the top MAX_CTAS.
 * Pure and order-preserving; returns the curated CTAs most-prominent-first.
 */
export function curateCtas(raw: CTAEntity[]): CTAEntity[] {
  const candidates = (raw ?? [])
    .filter((c) => Boolean(c?.text) && isReusableCta(c))
    .map((cta) => ({ cta, score: ctaScore(cta) }));

  collapseUniformStrips(candidates);
  candidates.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const deduped = candidates.filter(({ cta }) => {
    const key = normalizeLabel(cta.text ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, MAX_CTAS).map((c) => c.cta);
}

// Zero-config goal detection: which harvested CTA is most likely the site's
// conversion goal. Ordered strongest-signal first; the FIRST regex with a match
// wins, ties broken by curation order (already prominence-scored). EN + SV.
const GOAL_RX: RegExp[] = [
  /skapa konto|sign ?up|register|registrera|bli medlem|create (an )?account|join/i,
  /köp|beställ|add to (cart|basket|bag)|lägg i varukorg|buy|checkout|till kassan/i,
  /boka|book (a )?|schedule|reservera/i,
  /prova|trial|get started|kom igång|starta|start free/i,
  /kontakt|offert|contact|get a quote|demo/i,
];

/**
 * Pick the best conversion-goal candidate from an inventory's CTAs, or null if
 * none look like a goal. Pure and deterministic — used to auto-fill a site's
 * conversion goal so the owner only has to CONFIRM, not configure.
 */
/** Fixed goal ranking — the LLM labels intent, but the ORDER is ours. */
const INTENT_PRIORITY = ["signup", "purchase", "booking", "trial", "quote", "contact"] as const;

export function pickGoalCta(
  inventory: ContentInventory,
): { selector: string; text: string } | null {
  // Support/login/legal/nav items can never be the conversion goal, no matter
  // how well their label happens to match a goal word in some language.
  // elementIntent "navigation" likaså: en in-page-flik ("Bilder"/"Betyg") är
  // harvestad som CTA men är sidnavigering — aldrig ett konverteringsmål.
  const ctas = (inventory.slots.cta ?? []).filter(
    (c) => c.selector && c.text && isAcquisition(c) && c.meta?.elementIntent !== "navigation",
  );

  // LLM-labelled pass first: works in ANY language ("Konto erstellen" carries
  // llmIntent=signup). The intent ranking stays deterministic and ours.
  for (const intent of INTENT_PRIORITY) {
    const hit = ctas.find(
      (c) =>
        c.meta?.llmIntent === intent &&
        Number(c.meta?.llmConfidence ?? "0") >= LLM_CONFIDENCE_FLOOR,
    );
    if (hit) return { selector: hit.selector as string, text: hit.text as string };
  }

  // Deterministic EN+SV word rules — always available, no key required.
  for (const rx of GOAL_RX) {
    const hit = ctas.find((c) => rx.test(c.text as string));
    if (hit) return { selector: hit.selector as string, text: hit.text as string };
  }
  return null;
}

// ---- goal KIND + ranked candidates (the "propose" side) ---------------------
//
// A site's goal is not always a SaaS signup. `GoalKind` widens what a conversion
// can be so the proposal fits any business — a comparison portal's real goal is
// starting a comparison / an affiliate outbound click, not "create account".
// The kind is a language-independent-first classification (href/structure), with
// EN+SV text as backup; the holistic LLM judge (goal-judge.server.ts) refines it
// and ranks, but this is the deterministic floor + no-key fallback.

export type GoalKind =
  | "signup"
  | "purchase"
  | "booking"
  | "trial"
  | "quote"
  | "contact"
  | "lead"
  | "outbound"
  | "start_flow"
  | "subscribe"
  | "download"
  | "donate";

export const GOAL_KINDS: GoalKind[] = [
  "signup",
  "purchase",
  "booking",
  "trial",
  "quote",
  "contact",
  "lead",
  "outbound",
  "start_flow",
  "subscribe",
  "download",
  "donate",
];

export interface GoalCandidate {
  selector: string;
  text: string;
  href?: string;
  kind: GoalKind;
  /** 1 = primary; higher = weaker. */
  rank: number;
  /** 0..1 — the judge's confidence; rule-derived candidates use a fixed floor. */
  confidence: number;
  /** Where the kind/ranking came from. */
  source: "rule" | "llm";
}

/** Registrable-ish host compare: strip a leading www. and lowercase. Good enough
 *  to tell "same site" from "affiliate/partner domain" for goal classification. */
function normHost(h: string): string {
  return h.replace(/^www\./i, "").toLowerCase();
}

/** Same registrable domain — SUBDOMAINS are the same site, not an outbound
 *  affiliate handoff. Breddfixturerna 2026-07-06 gav två felklassningar av
 *  samma klass: insamling.unicef.se (unicef.se) och buy-guide.fortnox.se
 *  (fortnox.se) → outbound i stället för start_flow. Heuristik: sista två
 *  labels ("unicef.se"). Medvetet enkel — eTLD-fall som example.co.uk läser
 *  "co.uk" och blir för generösa, men falsk-SAMMA kräver att båda hosts delar
 *  eTLD-svansen, vilket i praktiken är samma organisations domäner; riktiga
 *  affiliate-handoffs (partner.example → annan huvuddomän) fångas fortfarande. */
function sameRegistrableDomain(a: string, b: string): boolean {
  const tail = (h: string) => normHost(h).split(".").slice(-2).join(".");
  return tail(a) === tail(b);
}

/** Resolve an href's host against the site domain; null when relative/unknown. */
function hrefHost(href: string | undefined, siteDomain: string | null): string | null {
  if (!href) return null;
  try {
    const base = siteDomain ? `https://${siteDomain}` : "https://x.invalid";
    return normHost(new URL(href, base).hostname);
  } catch {
    return null;
  }
}

// Vocabulary provenance: the non-obvious terms below were mined from a
// 107-site homepage harvest across goal archetypes (e-com, booking, lead-gen,
// comparison, nonprofit, media, SaaS, bank, telecom, energy) — evidence with
// per-label site counts in corpus/vocab-harvest-2026-07-06.json. Inclusion
// bar: >= 2 independent sites and no plausible non-goal reading.
const KIND_TEXT: { kind: GoalKind; rx: RegExp }[] = [
  // "teckna" = sign an insurance/utility/telecom contract — that vertical's
  // purchase ("Teckna elavtal", "Få pris och teckna"). \b keeps "Tecknade
  // serier" (comics) out. "handla nu/online" and "shoppa …" are e-com CTAs;
  // bare "handla"/"så handlar du" stays unmatched (nav/how-to).
  { kind: "purchase", rx: /\b(k[öo]p|best[äa]ll|add to (cart|basket|bag)|l[äa]gg i (varu|kund)?korg(en)?|buy|checkout|till kassan|shoppa|handla (nu|online|h[äa]r)|teckna)\b/i },
  // "jämför …" = a comparison portal's funnel entry — its real goal. Ordered
  // above signup so "Jämför och byt elavtal" reads as the comparison start.
  { kind: "start_flow", rx: /\b(j[äa]mf[öo]r)\b/i },
  // "bli kund"/"öppna konto" (banks), "anmäl dig" (courses/newsletters —
  // "anmäl skada" is a support action and must NOT match), "byt till oss/
  // elavtal/…" = switch-provider signup (utilities/insurance/telecom).
  // NOTE: JS \b is ASCII-only — it never fires next to å/ä/ö, so "Öppna konto"
  // gets its own entry with an explicit left boundary instead of \b.
  { kind: "signup", rx: /(?:^|[^a-zåäö0-9])[öo]ppna( ett)? konto\b/i },
  { kind: "signup", rx: /\b(skapa konto|sign ?up|register|registrera|bli medlem|create (an )?account|join|bli (privat|f[öo]retags)?kund|anm[äa]l dig|byt (till oss|elavtal|elbolag|f[öo]rs[äa]kring|bank))\b/i },
  { kind: "booking", rx: /\b(boka|book|schedule|reservera|boka tid)\b/i },
  { kind: "trial", rx: /\b(prova|trial|get started|kom ig[åa]ng|start free|starta gratis)\b/i },
  // Nonprofit money actions: månadsgivare/swisha en gåva/skänk pengar/stöd oss
  // are the sector's standard donate CTAs (rodakorset, cancerfonden, unicef…).
  // "ge en [katastrof|företags|minnes]gåva" — sammansatta gåvo-ord är sektorns
  // standard (unicef katastrofgåva, rodakorset företagsgåva, MSF minnesgåva;
  // breddfixturerna 2026-07-06). De tre bevisade sammansättningarna gäller
  // också FRISTÅENDE ("Företagsgåva" som meny-CTA, unicef) — explicit vänster-
  // boundary eftersom JS \b inte fungerar intill å/ä/ö. Bare "gåva" är
  // medvetet OTÄCKT (e-handelns "Köp gåva" fångas av purchase-regeln före,
  // men "Gåvokort"/"gåvor" ska inte bli donate). \b efter "gåva" landar på
  // ASCII-'a' och funkar.
  { kind: "donate", rx: /\b(donate|donera|ge en (?:[a-zåäö]+)?g[åa]va|sk[äa]nk (en|pengar|aktie|din)|bidra|give now|(bli )?m[åa]nadsgivare|swisha (en |din )?g[åa]va|st[öo]d oss)\b|(?:^|[^a-zåäö0-9])(?:katastrof|f[öo]retags|minnes)g[åa]va\b/i },
  // "räkna (på/ut)" = bank & insurance price calculators — the quote motion.
  // The på/ut tail is optional so the trailing \b lands after "räkna"'s ASCII
  // "a" (JS \b never matches next to å — see the signup note above).
  { kind: "quote", rx: /\b(offert|f[åa] (en )?offert|get a quote|request a quote|pris(f[öo]rslag)?|r[äa]kna( p[åa]| ut)?)\b/i },
  // "ansök (om …)" = loan/school applications, the lead-gen conversion for
  // banks and education. Boundary keeps "så ansöker du" (how-to) out.
  { kind: "lead", rx: /\b(vi ringer upp|ring mig|bli uppringd|get a callback|request a call|boka (ett )?samtal|kontakta mig|ans[öo]k(an)?)\b/i },
  { kind: "contact", rx: /\b(kontakta oss|contact( sales| us)?|kontakt|talk to sales)\b/i },
  // Harvest falsification: every "följ …" label on 107 sites was a social
  // link ("Följ oss på Instagram") — "följ" is OUT of the subscribe rule.
  // "prenumerant" ("Bli prenumerant", news paywalls) is in.
  { kind: "subscribe", rx: /\b(prenumer(era|ant)|subscribe|newsletter|nyhetsbrev)\b/i },
  // "App Store"/"Google Play"-knappar sitter ofta bakom tracker-domäner
  // (tibber → onelink.me, bokadirekt → smart.link) som annars läses som
  // outbound — textregeln körs FÖRE offdomän-fallbacken och vinner därför.
  { kind: "download", rx: /\b(ladda ne[dr]|download|h[äa]mta appen|get the app|install|app ?store|google play)\b/i },
];

const KIND_HREF: { kind: GoalKind; rx: RegExp }[] = [
  { kind: "purchase", rx: /\/(checkout|cart|kassa|varukorg|order|betala)([/?#]|$)/i },
  { kind: "signup", rx: /\/(sign-?up|signup|register|registrera|skapa-konto|join|create-account)([/?#]|$)/i },
  { kind: "booking", rx: /\/(book|boka|schedule|reservera|appointment)([/?#]|$)/i },
  { kind: "trial", rx: /\/(trial|free-trial|prova|kom-igang|get-started)([/?#]|$)/i },
  { kind: "quote", rx: /\/(quote|offert|pris|get-a-quote)([/?#]|$)/i },
  { kind: "contact", rx: /\/(contact|kontakt|sales)([/?#]|$)/i },
  { kind: "donate", rx: /\/(donate|donera|bidra|give|gava|stod-oss|support-us)([/?#]|$)/i },
  { kind: "download", rx: /(apps\.apple\.com|play\.google\.com|\/(download|ladda-ner))/i },
];

/**
 * Best-effort language-independent-first classification of what CONVERTING via
 * this CTA means. Priority: hard structural signals (form/tel/mailto/off-domain)
 * → href path → text. Falls back to `start_flow` for a prominent same-site
 * acquisition link OR a category-grid tile (a funnel entry, e.g. a comparison
 * portal's "Bilförsäkring" or a booking portal's "Frisör"/"Massage"), and
 * `signup` for a bare button with no other signal.
 *
 * `variantCount` is the "1 of N near-identical siblings" grid signal from
 * collapseUniformStrips — the same signal the holistic LLM judge uses to read
 * a category/funnel (goal-judge.server.ts). Without it a booking marketplace's
 * href-less service tiles fell through to the bare-button `signup` default.
 */
export function classifyGoalKind(
  text: string,
  href: string | undefined,
  siteDomain: string | null,
  inForm = false,
  variantCount = 0,
): GoalKind {
  const h = (href ?? "").trim();
  if (/^tel:/i.test(h) || inForm) return "lead";
  if (/^mailto:/i.test(h)) return "contact";

  const host = hrefHost(h, siteDomain);
  const isAbsolute = /^https?:\/\//i.test(h);
  // Subdomäner är samma sajt (insamling.unicef.se, buy-guide.fortnox.se) —
  // registrerbar-domän-jämförelse, inte exakt host. Se sameRegistrableDomain.
  const offDomain =
    isAbsolute &&
    host !== null &&
    siteDomain !== null &&
    !sameRegistrableDomain(host, siteDomain);

  for (const { kind, rx } of KIND_HREF) if (h && rx.test(h)) return kind;
  const t = (text ?? "").trim();
  for (const { kind, rx } of KIND_TEXT) if (rx.test(t)) return kind;

  // An off-domain link with no other signal reads as an affiliate/partner
  // handoff — the conversion for comparison/lead-gen sites.
  if (offDomain) return "outbound";
  // A same-site link that survived acquisition filtering but matched no verb is
  // most likely a funnel/category entry.
  if (h && /^(\/|https?:)/i.test(h)) return "start_flow";
  // A prominent tile that is one of N near-identical siblings (a category grid
  // / funnel of options) is a funnel entry even without an href — the booking-
  // /comparison-portal case. Verb-bearing labels ("Skapa konto") already
  // returned above, so this only catches the residual no-verb bucket.
  if (variantCount > 1) return "start_flow";
  return "signup";
}

/**
 * Deterministic ranked candidate list — the no-LLM floor the judge builds on.
 * Acquisition CTAs only, scored by the language-independent prominence score,
 * each tagged with a GoalKind. Pure; stable order (score desc, then original
 * order). `MAX_GOAL_CANDIDATES` keeps the dashboard list human.
 */
export const MAX_GOAL_CANDIDATES = 6;

export function rankGoalCandidates(
  inventory: ContentInventory,
  siteDomain: string | null,
): GoalCandidate[] {
  // Navigation-intent (in-page-flikar, meny-poster) är aldrig målkandidater —
  // samma spärr som pickGoalCta. Roll-filtret (isAcquisition) ser dem inte:
  // en flik har acquisition-roll per text/href men navigations-INTENT.
  const ctas = (inventory.slots.cta ?? []).filter(
    (c) => c.selector && c.text && isAcquisition(c) && c.meta?.elementIntent !== "navigation",
  );
  const scored = ctas.map((c, i) => ({
    c,
    i,
    score:
      ctaScore({
        visualWeight: Number(c.meta?.visualWeight ?? "0") || undefined,
        aboveFold: c.meta?.aboveFold === "true",
        category: c.meta?.category,
        intent: c.meta?.elementIntent,
        competingActions: Number(c.meta?.competingActions ?? "0") || undefined,
      }) +
      // Collapsed-strip multiplicity — same aggregate as curateCtas, see
      // stripAggregateBonus.
      stripAggregateBonus(
        c.meta?.elementIntent,
        Number(c.meta?.visualWeight ?? "0") || 0,
        Number(c.meta?.variantCount ?? "0") || 0,
      ),
  }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, MAX_GOAL_CANDIDATES).map((s, idx) => ({
    selector: s.c.selector as string,
    text: s.c.text as string,
    ...(s.c.meta?.href ? { href: s.c.meta.href } : {}),
    // inForm (A2): a harvested in-form submit classifies as lead, not as a
    // bare "signup" button — so a hero newsletter form can't masquerade as
    // the site's signup goal in the no-LLM floor.
    // variantCount (C): a category-grid tile reads as start_flow, not signup —
    // a booking/comparison portal's href-less funnel entries.
    kind: classifyGoalKind(
      s.c.text as string,
      s.c.meta?.href,
      siteDomain,
      s.c.meta?.inForm === "true",
      Number(s.c.meta?.variantCount ?? "0") || 0,
    ),
    rank: idx + 1,
    confidence: 0.5,
    source: "rule" as const,
  }));
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

  const rawCtas = (audit.ctas ?? []) as CTAEntity[];
  // Keep every raw label for the microcopy scan, even ones curation drops.
  for (const cta of rawCtas) if (cta?.text) textPool.push(cta.text);
  // Curate → most-prominent CTAs, deduped and capped (see curateCtas).
  for (const cta of curateCtas(rawCtas)) {
    b.add(
      "cta",
      ctaItem(
        cta.text,
        cta.selector,
        {
          elementIntent: cta.intent,
          category: cta.category,
          section: cta.section, // kept for the engine to reason about placement
          aboveFold: String(cta.aboveFold),
          // Prominence inputs for rankGoalCandidates' ctaScore call — it has
          // always read these meta keys, but the mapper never supplied them,
          // so the goal floor ranked on category/fold bonuses alone and a
          // small-but-dominant action lost to any one-off primary.
          ...(typeof cta.visualWeight === "number"
            ? { visualWeight: String(cta.visualWeight) }
            : {}),
          ...(typeof cta.competingActions === "number"
            ? { competingActions: String(cta.competingActions) }
            : {}),
          // Form context for goal-kind classification (A2): a submit inside a
          // form is a lead/subscribe motion, not a bare "signup" button.
          ...(cta.nearestFormDistance === 0 ? { inForm: "true" } : {}),
          // Collapsed-strip context for goal judgment (see collapseUniformStrips).
          ...(cta.variantCount && cta.variantCount > 1
            ? { variantCount: String(cta.variantCount) }
            : {}),
          ...(cta.variantSample && cta.variantSample.length
            ? { variantSample: cta.variantSample.join(" · ").slice(0, 200) }
            : {}),
        },
        cta.href,
      ),
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

  const inventory = b.build(site);
  // Provenance: everything this mapper produces came off the live page, i.e.
  // was VISIBLE when harvested/crawled. decide() reads this to refuse
  // reveal/condense on such items — you cannot "reveal" what visitors already
  // see, and the no-op exposure would pollute measurement.
  for (const items of Object.values(inventory.slots)) {
    for (const item of items ?? []) item.meta = { source: "harvest", ...(item.meta ?? {}) };
  }
  return inventory;
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
