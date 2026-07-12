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

import type { RedesignContentModel } from "./context";

const stripTags = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Isolate the primary content region so nav/footer headings don't masquerade as
 *  sections. Falls back to the whole document if there is no <main>. */
function mainRegion(html: string): string {
  const m = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  return m ? m[1] : html;
}

/** Classify a section from its heading text — deterministic keyword mapping onto
 *  the section vocabulary the preview gates understand (hero/features/…/footer). */
function classify(heading: string, isFirst: boolean): string {
  const h = heading.toLowerCase();
  if (isFirst) return "hero";
  if (/(pricing|plans?|\/mo|per month|traffic based|growth)/.test(h)) return "pricing";
  if (/(love|❤|people|testimonial|review|say about|customers think)/.test(h)) return "testimonials";
  if (/(trusted|companies|logos|as seen|featured in)/.test(h)) return "logos";
  if (/(why|benefit|feature|how it works|what you get|simple|lightweight|no need)/.test(h))
    return "features";
  if (/(compare|vs\b|ditch|switch|alternative|migrate)/.test(h)) return "comparison";
  if (/(ready|start|try|get started|sign up|free trial|today)/.test(h)) return "cta";
  if (/(faq|question|frequently)/.test(h)) return "faq";
  if (/(follow|footer|©|copyright|all rights)/.test(h)) return "footer";
  return "section";
}

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

/** Detect CTAs from anchor/button text that reads like a conversion action.
 *  Scans the WHOLE document: the primary CTA often sits in the header/hero above
 *  <main> (e.g. Basecamp's "Try Basecamp free"). Deduped by text. */
function extractCtas(html: string, seen = new Set<string>()): RedesignContentModel["ctas"] {
  const ctas: RedesignContentModel["ctas"] = [];
  const re = /<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(html))) {
    const t = stripTags(m[2]);
    order++;
    if (!t || t.length > 32 || seen.has(t.toLowerCase())) continue;
    // \bbook\b so "book a demo" matches but "handbook" / "Books we've written" don't.
    if (!/(free trial|start|sign up|get started|try |demo|register|buy|subscribe|\bbook\b)/i.test(t))
      continue;
    seen.add(t.toLowerCase());
    const intent = /(demo|tour|learn|watch)/i.test(t) ? "explore" : "conversion";
    ctas.push({ text: t, intent, aboveFold: order < 12 }); // first handful ~ above fold
  }
  return ctas;
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
  const patterns: { type: string; re: RegExp }[] = [
    { type: "social_proof_count", re: /(\d[\d,.]*\+?\s*(?:paying |happy |active )?(?:customers|companies|users|subscribers|businesses|sites|websites))/i },
    { type: "trusted_by", re: /(trusted by [^.<]{3,70})/i },
    { type: "independence", re: /(independent[,\s][^.<]{3,70})/i },
    { type: "compliance", re: /((?:GDPR|CCPA|PECR)[^.<]{0,40}(?:compliant|consent|ready))/i },
  ];
  for (const p of patterns) {
    const m = p.re.exec(flat);
    if (m) signals.push({ type: p.type, text: tidy(flat, m).slice(0, 90), aboveFold: false, section: "body" });
  }
  return signals;
}

function extractHero(sections: RedesignContentModel["sections"], html: string): RedesignContentModel["hero"] {
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
