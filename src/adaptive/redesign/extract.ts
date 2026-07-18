// Fas 3 — HTML → RedesignContentModel loader.
//
// Given a page's real (frozen) HTML, derive the EXISTING content model — sections
// in document order, CTAs, trust signals, hero — that the assembler reasons over.
// This closes the "loader gap": before this, only the demo hand-built a content
// model; now the redesign chain can start from a real page's markup.
//
// It INVENTS NOTHING. Every section is a heading literally in the markup; every
// CTA / trust signal is text literally on the page (surfaced as a real substring).
// That is exactly the "don't invent" boundary the redesign guardrails enforce
// downstream — enforced here at the source.
//
// SCOPE (honest): a dependency-free parser over server-rendered markup. It reads
// what is in the delivered HTML, so it is faithful for SSR / static pages. A
// JS-shell SPA whose content mounts client-side needs the render/harvest path
// first (freeze.server.ts) — feed this the frozen post-render markup, not the
// empty shell. The richer harvest audit can supersede the regexes later; the
// CONTRACT (sections/CTAs/trust signals off the real DOM, never fabricated) holds.
//
// Pure + framework-free.

import { classifyIntentShared } from "../../lib/tests/scripts/shared/intent";
import { SOCIAL_PROOF_NOUNS_SRC, TRUSTED_BY_LEADINS_SRC, classifySectionHeading } from "./vocab";

import type { RedesignContentModel } from "./context";

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    // Numeriska entiteter — många riktiga sajter kodar åäö som &#xE5;/&#229;.
    // Utan avkodning matchar varken vokabulären ("Tr&#xE4;ningsklubb") eller
    // DOM-lokatorerna (DOM:ens textContent är alltid avkodad).
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const cp = parseInt(h, 16);
      return cp >= 32 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    })
    .replace(/&#(\d+);/g, (_, d: string) => {
      const cp = Number(d);
      return cp >= 32 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
    })
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Isolate the primary content region so nav/footer headings don't masquerade as
 *  sections. Falls back to the whole document if there is no <main>. */
function mainRegion(html: string): string {
  const m = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  return m ? m[1] : html;
}

// Sektionsklassificeringen bor i den delade vokabulären (vocab.ts, task #90)
// — EN+SV, samma typlista som granska-sitens bevis-sektioner. Var tidigare
// engelsk-bara här: svenska sajter fick "section" på allt och briefen blev blind.
const classify = classifySectionHeading;

/** Extract top-level sections from the h1/h2 headings in document order. h3s are
 *  treated as sub-content of the current section (not their own sections) so the
 *  model mirrors the page's real block structure rather than every subheading.
 *  The hero exists only when the page has a real h1 — we never fabricate one for a
 *  page that is a bare list of h2 sections. */
/** The document's primary headline text (first h1 anywhere), or null. Sourced
 *  from the WHOLE document because the hero h1 very often lives in a <header>
 *  ABOVE <main> (e.g. Basecamp) — scoping it to <main> would drop it. */
function primaryH1(html: string): string | null {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = m ? stripTags(m[1]) : "";
  return t || null;
}

function extractSections(html: string): RedesignContentModel["sections"] {
  const main = mainRegion(html);
  const heads: { level: number; text: string }[] = [];
  const re = /<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(main))) {
    const text = stripTags(m[2]);
    if (text) heads.push({ level: Number(m[1][1]), text });
  }
  // The hero leads. If <main> has the h1, move it to front; if the h1 lives
  // OUTSIDE <main> (a header hero), prepend it so the hero isn't lost — while the
  // h2 sections stay scoped to <main> to avoid nav/footer noise.
  const docH1 = primaryH1(html);
  const mainH1Idx = heads.findIndex((h) => h.level === 1);
  if (mainH1Idx > 0) heads.unshift(heads.splice(mainH1Idx, 1)[0]);
  else if (mainH1Idx < 0 && docH1) heads.unshift({ level: 1, text: docH1 });
  const heroPresent = heads.some((h) => h.level === 1);

  return heads.map((h, i) => {
    const type = classify(h.text, heroPresent && i === 0);
    return {
      id: `sec-${i + 1}-${type}`,
      type,
      position: i + 1,
      heading: h.text.slice(0, 120),
      aboveFold: type === "hero", // honest approximation w/o a render: only the hero is above the fold
      visualWeight: type === "hero" ? 85 : Math.max(20, 60 - i * 4),
    };
  });
}

/** A raw anchor/button candidate before intent classification — the input both
 *  the deterministic floor (extractCtas) and the any-language LLM layer
 *  (cta-llm.server.ts) work from. */
export interface CtaCandidate {
  text: string;
  href: string;
  attrText: string;
  aboveFold: boolean;
  samePageAnchor: boolean;
  /** The deterministic classifier's verdict for this candidate. */
  intent: ReturnType<typeof classifyIntentShared>;
}

/** Collect every anchor/button candidate (≤32 chars, deduped by text) with the
 *  shared classifier's deterministic verdict attached. Scans the WHOLE
 *  document: the primary CTA often sits in the header/hero above <main>
 *  (e.g. Basecamp's "Try Basecamp free").
 *  String-parser limits (honest): no form context (isFormSubmit=false) and no
 *  computed category, so the classifier's position fallback never fires here —
 *  a keyword-less primary is instead covered by the owner-goal-text union the
 *  measurement harnesses add to the hit-test list. */
export function extractCtaCandidates(html: string): CtaCandidate[] {
  const out: CtaCandidate[] = [];
  const seen = new Set<string>();
  const re = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(html))) {
    const attrs = m[2];
    const t = stripTags(m[3]);
    order++;
    if (!t || t.length > 32 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    const attrVal = (name: string): string => {
      const a = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
      return a ? (a[1] ?? a[2] ?? "") : "";
    };
    const href = attrVal("href");
    const attrText = `${attrVal("aria-label")} ${attrVal("title")}`.trim();
    out.push({
      text: t,
      href,
      attrText,
      aboveFold: order < 12, // first handful ~ above fold
      samePageAnchor: href.startsWith("#"),
      intent: classifyIntentShared(
        t,
        href,
        attrText,
        "", // no category from raw markup — the position fallback stays off
        false,
        order < 12,
        "",
        href.startsWith("#"),
      ),
    });
  }
  return out;
}

/** Detect CTAs from anchor/button text. Candidacy AND intent come from THE
 *  shared classifier (shared/intent.ts — EN+SV mined + ~30 curated major
 *  languages, the same semantics as the harvest scripts), never a private word
 *  list: the old English-only regex here found 0 CTAs on Swedish pages
 *  (breadth finding 2). Languages beyond the deterministic floor are added by
 *  the LLM layer (cta-llm.server.ts) where the chain runs server-side. */
function extractCtas(html: string): RedesignContentModel["ctas"] {
  // conversion + contact are the model's CTAs (contact IS the goal for
  // lead-gen — A1); nav/social/utility/engagement links stay out of the brief.
  return extractCtaCandidates(html)
    .filter((c) => c.intent === "conversion" || c.intent === "contact")
    .map((c) => ({ text: c.text, intent: c.intent, aboveFold: c.aboveFold }));
}

/** Trim a captured phrase that got cut mid-word: if the next source char is a word
 *  char, drop the trailing partial token so we never surface half a word. */
function tidy(flat: string, m: RegExpExecArray): string {
  let t = m[1].trim();
  const after = flat[m.index + m[0].length];
  if (after && /\w/.test(after)) t = t.replace(/\s*\S+$/, "");
  return t.trim();
}

/** Detect trust / social-proof phrases literally present in the copy. Each entry's
 *  text is a real substring of the page — never synthesized. The leading count
 *  requires a real digit so a stray "." can't masquerade as a number. */
function extractTrustSignals(html: string): RedesignContentModel["trustSignals"] {
  const flat = stripTags(html);
  const signals: RedesignContentModel["trustSignals"] = [];
  // Substantiv/inledningar ur den delade vokabulären (vocab.ts, task #90):
  // EN+SV, samma ordlista som webbläsar-harvestern. Sifferdelen tillåter
  // mellanslag som tusentalsavgränsare — "12 000 kunder" är socialt bevis.
  const patterns: { type: string; re: RegExp }[] = [
    {
      type: "social_proof_count",
      re: new RegExp(
        `(\\d[\\d\\s,.]*\\+?\\s*(?:paying |happy |active |n[öo]jda )?(?:${SOCIAL_PROOF_NOUNS_SRC}))`,
        "i",
      ),
    },
    { type: "trusted_by", re: new RegExp(`((?:${TRUSTED_BY_LEADINS_SRC})\\s[^.<]{3,70})`, "i") },
    { type: "independence", re: /((?:independent|oberoende)[,\s][^.<]{3,70})/i },
    {
      type: "compliance",
      re: /((?:GDPR|CCPA|PECR)[^.<]{0,40}(?:compliant|consent|ready|anpassa\w*|s[äa]kra\w*)|GDPR-?(?:s[äa]ker|v[äa]nlig)\w*)/i,
    },
  ];
  for (const p of patterns) {
    const m = p.re.exec(flat);
    if (m)
      signals.push({
        type: p.type,
        text: tidy(flat, m).slice(0, 90),
        aboveFold: false,
        section: "body",
      });
  }
  return signals;
}

function extractHero(
  sections: RedesignContentModel["sections"],
  html: string,
): RedesignContentModel["hero"] {
  const hero = sections.find((s) => s.type === "hero");
  if (!hero) return undefined;
  // Subheadline: the first paragraph that FOLLOWS the h1 in the WHOLE document —
  // the hero h1 may live in a header above <main>, so scoping to <main> would grab
  // an unrelated section's paragraph (or miss it entirely).
  const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/i.exec(html);
  const region = h1 ? html.slice(h1.index + h1[0].length) : html;
  const pm = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(region);
  const sub = pm ? stripTags(pm[1]) : "";
  return { headline: hero.heading, subheadline: sub ? sub.slice(0, 140) : undefined };
}

/** Parse a page's HTML into the EXISTING content model the redesign reasons over.
 *  Everything returned is literally present in the markup. */
export function extractContentModel(html: string): RedesignContentModel {
  const sections = extractSections(html);
  return {
    sections,
    trustSignals: extractTrustSignals(html),
    ctas: extractCtas(html),
    hero: extractHero(sections, html),
  };
}

// ── Prisutsagor för korssid-lyftet (task #117, ägarbeslut 2026-07-18) ─────────
// "Pris först": det ENDA innehåll som får citeras från en annan sida i v1 är
// prisliknande utsagor, och citatet måste vara ORDAGRANT. Extraktorn är därför
// hela whitelisten: bara det den hittar erbjuds designern, och validateOps
// kräver exakt matchning mot listan. En utsaga = texten i ett LÖV-element
// (inga nästlade taggar — priser bor i <p>/<li>/<td>/<span>-löv i praktiken)
// som bär ett belopp med valuta eller en per-månad/per-år-konstruktion.

/** Element vars rena textinnehåll kan bära en prisutsaga. */
const PRICE_LEAF_TAGS = "p|li|td|th|h2|h3|h4|span|strong|b|div|dt|dd";

/** Prisliknande: valutasymbol/kod intill en siffra, eller "/mån"-mönster.
 *  Kräver alltid en siffra — "gratis"/"free" ensamt är för brusigt för en
 *  ordagrann-whitelist. EN+SV, samma tvåspråkiga golv som vokabulären. */
const PRICE_RE =
  /(?:[$€£]\s?\d|\d[\d\s.,]*\s?(?:kr|:-|sek|usd|eur|kronor|dollar|euro)(?![a-z])|\d\s?\/\s?(?:m[åa]n(?:ad)?|mo(?:nth)?|yr|year|[åa]r)\b|per\s+(?:m[åa]nad|month|user|anv[äa]ndare))/i;

export interface PriceSnippet {
  /** Ordagrann text ur källsidans markup (stripTags-normaliserad). */
  text: string;
  /** Lövtaggen texten bodde i — diagnostik, inte serveringsform (serveras som <p>). */
  tag: string;
}

/** Extract verbatim price-like statements from a page's HTML. Every entry is the
 *  literal text of one leaf element — never assembled, never paraphrased. */
export function extractPriceSnippets(html: string): PriceSnippet[] {
  const region = mainRegion(html);
  const out: PriceSnippet[] = [];
  const seen = new Set<string>();
  const re = new RegExp(`<(${PRICE_LEAF_TAGS})\\b[^>]*>([^<]{3,240})</\\1>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) && out.length < 8) {
    const text = stripTags(m[2]);
    if (text.length < 3 || text.length > 140 || !PRICE_RE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, tag: m[1].toLowerCase() });
  }
  return out;
}
