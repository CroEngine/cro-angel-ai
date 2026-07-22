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

// ── Structural + proof section typing (ADR-001 step 3) ───────────────────────
// Ported from the lab's assembleInventory (src/adaptive-lab/inventory.ts): the
// heading classifier alone leaves most sections generic `section`, because a
// heading is marketing copy ("consider yourself limitless" tells you nothing).
// The lab types a section from its DOM STRUCTURE instead. Here we're on the
// frozen-HTML string (no live DOM), so the same cues are read by regex on the
// section's own HTML slice — robust for the literal-tag ones (video/table/
// details) and for proof strips whose heading has no magic word.

const TRUSTED_BY_RE = new RegExp(`(?:${TRUSTED_BY_LEADINS_SRC})`, "i");
const SOCIAL_COUNT_RE = new RegExp(
  `\\d[\\d\\s,.]*\\+?\\s*(?:paying |happy |active |n[öo]jda )?(?:${SOCIAL_PROOF_NOUNS_SRC})`,
  "i",
);

/** Proof carried by a section's BODY, not its heading — generalises the heading-
 *  based logos/testimonials so a strip titled "Loved by teams that ship" is still
 *  found. Mirrors the lab's proofType precedence (logos before stats). Returns
 *  the proof type to promote a GENERIC section to, or null. */
function proofFromBody(body: string): "logos" | "stats" | null {
  const flat = stripTags(body);
  if (TRUSTED_BY_RE.test(flat)) return "logos"; // "trusted by / used by / as seen in …"
  if (SOCIAL_COUNT_RE.test(flat)) return "stats"; // "500,000+ customers", "80 billion events"
  return null;
}

/** Name a still-generic section from its STRUCTURE (literal tags in its slice).
 *  Only the drift-robust, tag-based cues the lab reads via querySelector are
 *  ported to regex; card-grid / short-CTA heuristics are left to the heading
 *  classifier (fragile to reconstruct from a string). Returns a type or null. */
function structuralType(body: string, heading: string): string | null {
  if (
    /<video[\s/>]/i.test(body) ||
    /<iframe[^>]+(?:youtube|youtu\.be|vimeo|wistia|loom)/i.test(body)
  )
    return "video";
  const detailsCount = (body.match(/<details[\s/>]/gi) || []).length;
  if (
    detailsCount >= 2 ||
    /class=["'][^"']*(?:accordion|faq)/i.test(body) ||
    /data-accordion/i.test(body)
  )
    return "faq";
  const trCount = (body.match(/<tr[\s/>]/gi) || []).length;
  if (/<table[\s/>]/i.test(body) && trCount >= 3) return "comparison";
  const imgCount = (body.match(/<img[\s/>]/gi) || []).length;
  if (imgCount >= 6 && /integrat|works with|connect (?:your|to)|\bapps?\b/i.test(heading))
    return "integrations";
  return null;
}

/** current heading-type + section body → refined type. Proof (logos/stats) and
 *  structure only ever FILL a generic section — a heading-assigned type
 *  (pricing/testimonials/comparison/…) is never clobbered. */
function refineType(
  current: string,
  body: string,
  heading: string,
): { type: string; containsTrustSignals: boolean } {
  const generic = current === "section" || current === "content";
  const proof = proofFromBody(body);
  let type = current;
  if (proof && generic) type = proof;
  if ((type === "section" || type === "content") && body) {
    const st = structuralType(body, heading);
    if (st) type = st;
  }
  return { type, containsTrustSignals: proof !== null };
}

function extractSections(html: string): RedesignContentModel["sections"] {
  const main = mainRegion(html);
  const heads: {
    level: number;
    text: string;
    headStart: number;
    bodyStart: number;
    body?: string;
  }[] = [];
  const re = /<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(main))) {
    const text = stripTags(m[2]);
    if (text)
      heads.push({ level: Number(m[1][1]), text, headStart: m.index, bodyStart: re.lastIndex });
  }
  // Each section's body = the HTML from the end of its heading to the start of
  // the next heading, computed in DOCUMENT order (before the hero reshuffle
  // below, so adjacency is real). The body drives structural/proof typing.
  for (let i = 0; i < heads.length; i++) {
    heads[i].body = main.slice(
      heads[i].bodyStart,
      i + 1 < heads.length ? heads[i + 1].headStart : main.length,
    );
  }
  // The hero leads. If <main> has the h1, move it to front; if the h1 lives
  // OUTSIDE <main> (a header hero), prepend it so the hero isn't lost — while the
  // h2 sections stay scoped to <main> to avoid nav/footer noise.
  const docH1 = primaryH1(html);
  const mainH1Idx = heads.findIndex((h) => h.level === 1);
  if (mainH1Idx > 0) heads.unshift(heads.splice(mainH1Idx, 1)[0]);
  else if (mainH1Idx < 0 && docH1)
    heads.unshift({ level: 1, text: docH1, headStart: -1, bodyStart: -1, body: "" });
  const heroPresent = heads.some((h) => h.level === 1);

  return heads.map((h, i) => {
    const headingType = classify(h.text, heroPresent && i === 0);
    // The hero is never re-typed from its body (it legitimately wraps media/proof).
    const { type, containsTrustSignals } =
      headingType === "hero"
        ? { type: "hero", containsTrustSignals: false }
        : refineType(headingType, h.body || "", h.text);
    return {
      id: `sec-${i + 1}-${type}`,
      type,
      position: i + 1,
      heading: h.text.slice(0, 120),
      aboveFold: type === "hero", // honest approximation w/o a render: only the hero is above the fold
      visualWeight: type === "hero" ? 85 : Math.max(20, 60 - i * 4),
      containsTrustSignals,
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
    order++;
    const attrVal = (name: string): string => {
      const a = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
      return a ? (a[1] ?? a[2] ?? "") : "";
    };
    // Cover-/ikonlänkar (Teamtailor-fyndet 2026-07-18): ett TOMT ankare med
    // namnet i aria-label ÄR sidans riktiga CTA — den synliga texten bor i en
    // aria-hidden syskon-div. Tillgänglighetsnamnet är lika ordagrant som
    // innehållet; utan det ser briefen 0 CTA:er på cover-link-sajter.
    const t = stripTags(m[3]) || stripTags(attrVal("aria-label"));
    if (!t || t.length > 32 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
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

/** Element vars textinnehåll kan bära en prisutsaga. */
const PRICE_LEAF_TAGS = "p|li|td|th|h2|h3|h4|span|strong|b|div|dt|dd";

/** Inline-taggar som får förekomma INUTI en utsaga utan att bryta ordagrannheten
 *  — riktiga prissidor delar ofta frasen i spans (<span>$14</span><span>/month</span>,
 *  plausible-fyndet 2026-07-18). Blocknivå-taggar bryter fortfarande: en
 *  sammansättning över sektionsgränser vore inte längre EN utsaga från sidan. */
const PRICE_INLINE_TAGS = "(?:span|b|strong|em|i|u|sup|sub|small|abbr|br)";

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

/** Källsidans citerbara innehåll: prisutsagor när de finns, annars sidans EGEN
 *  huvudutsaga (offert-fallbacken, ägarbeslut 2026-07-18: "vi visar exakt som
 *  dem gör" — en offert-sajts svar på prisfrågan ÄR t.ex. "Låt oss ge dig en
 *  offert"). kind låter prompten förklara skillnaden för designern. */
export interface QuotableContent {
  kind: "price" | "answer";
  snippets: PriceSnippet[];
}

/** Extract verbatim price-like statements from a page's HTML. Every entry is the
 *  literal text of one leaf element — never assembled, never paraphrased. */
export function extractPriceSnippets(html: string): PriceSnippet[] {
  const region = mainRegion(html);
  const collected: PriceSnippet[] = [];
  const seen = new Set<string>();
  // Innehållet får bära inline-markup (frasen "<span>$14</span><span>/month</span>"
  // ÄR en utsaga) men aldrig blocknivå-taggar — bakreferensen + inline-vitlistan
  // gör att en div aldrig kan sluka en annan div och producera en trunkerad
  // "utsaga" som inte ordagrant står på sidan.
  const content = `(?:[^<]|<${PRICE_INLINE_TAGS}\\b[^>]*/?>|</${PRICE_INLINE_TAGS}>)`;
  const re = new RegExp(`<(${PRICE_LEAF_TAGS})\\b[^>]*>(${content}{3,360}?)</\\1>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(region)) && collected.length < 24) {
    const text = stripTags(m[2]);
    if (text.length < 3 || text.length > 140 || !PRICE_RE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push({ text, tag: m[1].toLowerCase() });
  }
  // Föredra den FULLASTE utsagan: "$14" ensamt erbjuds inte när "$14 /month"
  // också fångades — delsträngar av en annan post faller bort.
  const out: PriceSnippet[] = [];
  for (const s of [...collected].sort((a, b) => b.text.length - a.text.length)) {
    if (out.some((k) => k.text.toLowerCase().includes(s.text.toLowerCase()))) continue;
    out.push(s);
  }
  return out.slice(0, 8);
}

/** Källsidans HUVUDUTSAGA — h1:an, annars första census-h2:an. Offert-
 *  fallbackens citat: ordagrant sidans eget svar när den inte publicerar
 *  belopp. null när sidan saknar användbar rubrik (⇒ inget att citera,
 *  aldrig-hitta-på-regeln vinner). */
export function extractQuoteAnswer(html: string): PriceSnippet | null {
  const h1 = primaryH1(html);
  if (h1 && h1.length >= 3 && h1.length <= 140) return { text: h1, tag: "h1" };
  const main = mainRegion(html);
  const m = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(main);
  const t = m ? stripTags(m[1]) : "";
  return t.length >= 3 && t.length <= 140 ? { text: t, tag: "h2" } : null;
}

/** Prisutsagor om de finns, annars offert-svaret. EN läsning för detect,
 *  verify och nattens drift-svep — whitelisten kan inte glida isär. */
export function extractQuotables(html: string): QuotableContent {
  const prices = extractPriceSnippets(html);
  if (prices.length > 0) return { kind: "price", snippets: prices };
  const answer = extractQuoteAnswer(html);
  return { kind: "answer", snippets: answer ? [answer] : [] };
}

/** Stil-donatorn (ägarbeslut 2026-07-18, alternativ D): det insatta blocket
 *  klär sig i LANDNINGSSIDANS egen mest använda länkklass — sajtens stilmall
 *  bestämmer utseendet, aldrig vår. Deterministiskt: flest förekomster vinner,
 *  först-i-dokumentet vid lika. null ⇒ blocket serveras i grundtypografin.
 *  Grindarna + ägarens FÖRE/EFTER-bild verifierar resultatet per variant. */
export function extractLinkStyleDonor(html: string): string | null {
  const region = mainRegion(html);
  const counts = new Map<string, number>();
  const order: string[] = [];
  const re = /<a\b[^>]*\bclass\s*=\s*"([^"]{1,120})"[^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) {
    const cls = m[1].trim();
    const text = stripTags(m[2]);
    // Bara TEXT-länkar är donatorer — tomma/ikon-länkar och långa kort ratas.
    if (!cls || !text || text.length > 60) continue;
    if (!counts.has(cls)) order.push(cls);
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 1; // kräver ≥2 förekomster — en engångsklass är ingen "stil"
  for (const cls of order) {
    const n = counts.get(cls)!;
    if (n > bestN) {
      bestN = n;
      best = cls;
    }
  }
  return best;
}
