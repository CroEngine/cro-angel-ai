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

// PROMOTION regexes — deliberately TIGHTER than the shared trust vocabulary
// (granskningsfynd 2026-07-22): promotion re-TYPES a whole section and drives
// the granska-site reorder demo + the LLM's [proof] tag, so a prose false
// positive is expensive. The loosest lead-ins ("used by", "loved by", "joined
// by", "älskas av") are everyday prose ("a tool used by developers") — they
// stay in extractTrustSignals' softer signal list but never promote a section.
const TRUSTED_BY_PROMOTE_RE = /(?:trusted by|anv[äa]nds av|valt av|f[öo]rtrodda av)\s/i;
// Count-promotion: the number must sit DIRECTLY before the noun (whitespace
// only — "Since 2019, customers…" has ", " and must not match) and a bare
// 19xx/20xx year is never a proof count ("since 2019 customers have…").
// Structured thousands groups (`12,500` / `12 000`) instead of the old
// `[\d\s,.]*` free-run — that adjacent-quantifier shape backtracked O(L²) on
// digit-heavy failing inputs, and this now runs per section slice.
const SOCIAL_COUNT_PROMOTE_RE = new RegExp(
  // (?<![\d,.]) — talet får inte börja MITT i ett längre tal ("[2]019" spärrad
  // av årsvakten ⇒ motorn får inte bara kliva in ett steg och matcha "019").
  `(?<![\\d,.])(?:\\d{1,3}(?:[ ,.]\\d{3})+|(?!(?:19|20)\\d{2}\\b)\\d+)\\+?\\s+` +
    `(?:paying |happy |active |n[öo]jda )?(?:${SOCIAL_PROOF_NOUNS_SRC})`,
  "i",
);

/** Proof carried by a section's BODY, not its heading — generalises the heading-
 *  based logos/testimonials so a strip titled "Loved by teams that ship" is still
 *  found via its count/leadin. Mirrors the lab's proofType precedence (logos
 *  before stats). Returns the proof type to promote a GENERIC section to, or
 *  null. */
function proofFromBody(body: string): "logos" | "stats" | null {
  const flat = stripTags(body);
  if (TRUSTED_BY_PROMOTE_RE.test(flat)) return "logos"; // "trusted by …" wall
  if (SOCIAL_COUNT_PROMOTE_RE.test(flat)) return "stats"; // "500,000+ customers"
  return null;
}

/** Does any class="…" attribute in the slice carry a TOKEN matching rx?
 *  Token-level, not substring (granskningsfynd 2026-07-22): a prose link class
 *  like "faq-teaser-link" must never type a whole section. Bounded scan. */
function hasComponentClass(body: string, rx: RegExp): boolean {
  const attr = /class=["']([^"']{0,300})["']/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = attr.exec(body)) && scanned < 400) {
    scanned++;
    for (const token of m[1].split(/\s+/)) if (rx.test(token)) return true;
  }
  return false;
}

/** Structural facts read ONCE from a section's body slice — literal tag counts
 *  and component-class flags, never the marketing-slogan heading (83% of generic
 *  headings are un-typeable slogans — capture-eval 2026-07-24). Computed in one
 *  place so every threshold the typer below leans on is visible together. */
interface BodyFacts {
  videoEmbed: boolean;
  details: number;
  faqQuestions: number;
  accordion: boolean;
  tableRows: number;
  images: number;
  integrationsClass: boolean;
  signupForm: boolean;
  featureGridClass: boolean;
  subHeadings: number;
  iconListItems: number;
  blockquotes: number;
  starGlyphs: number;
}

function readBodyFacts(body: string): BodyFacts {
  const count = (re: RegExp) => (body.match(re) || []).length;
  const cls = (rx: RegExp) => hasComponentClass(body, rx);
  return {
    // Video-värdar HOST-förankrade ("loom" som substräng träffar bloomberg.com).
    videoEmbed:
      /<video[\s/>]/i.test(body) ||
      /<iframe[^>]+(?:youtube|youtu\.be|vimeo|wistia|(?:\.|\/\/)loom\.)/i.test(body),
    details: count(/<details[\s/>]/gi),
    // Ett <summary> som är en FRÅGA (innehåller "?") — skiljer en riktig FAQ från
    // en <details>-baserad feature-tab/flik-widget (precisionsfynd 2026-07-24:
    // monday-fliken och vantas testimonial-i-<details> feltypades faq → fel lyftmål).
    faqQuestions: count(/<summary\b[^>]*>(?:(?!<\/summary>)[\s\S])*?\?(?:(?!<\/summary>)[\s\S])*?<\/summary>/gi),
    accordion: cls(/^(?:accordion|faq)(?:s|[_-]\w+)?$/i) || /data-accordion/i.test(body),
    tableRows: count(/<tr[\s/>]/gi),
    images: count(/<img[\s/>]/gi),
    integrationsClass: cls(/^(?:integrations?|integrate)(?:[_-]\w+)?$/i),
    signupForm:
      /<form[\s>]/i.test(body) &&
      (/<input[^>]+type=["']?email/i.test(body) ||
        cls(/^(?:signup|subscribe|newsletter|waitlist)(?:[_-]\w+)?$/i)),
    featureGridClass: cls(/^(?:features?|feature[_-]?grid|cards?|card[_-]?grid|benefits?)(?:[_-]\w+)?$/i),
    subHeadings: count(/<h[34][\s>]/gi),
    iconListItems: count(/<li\b[^>]*>(?:(?!<\/li>)[\s\S]){0,400}?<(?:svg|img)\b/gi),
    // Semantiska bevis-taggar (LLM-revision 2026-07-24). <blockquote> är den
    // ENDA precisa testimonials-strukturen — en vägg av citat (resend 39,
    // zendesk 11, ro 8, zapier 4). Stjärnglyfer ≥4 = ett ifyllt betyg (todoist
    // "337 000+ ★★★★★ reviews"). Båda är golv-hårda tröskeln över en 210-sajts
    // korpusmätning: enda icke-testimonials-träffen på blockquote var linears
    // "Changelog" (bq3) → tröskeln 4 utesluter den.
    blockquotes: count(/<blockquote[\s/>]/gi),
    starGlyphs: (body.match(/[★⭐✩✪✰]/g) || []).length,
  };
}

/** Type a still-generic section from its STRUCTURE. Ordered MOST-SPECIFIC →
 *  broadest; first match wins. Precision over recall — a wrong type misleads the
 *  designer brief and the lift-target pick worse than an honest "section", so
 *  each cue demands a strong structural signal. The evidence types
 *  (pricing/testimonials/logos/comparison) are the ones that matter most: they
 *  become lift targets and [proof] markers when the heading slogan missed them. */
function structuralType(body: string, heading: string): string | null {
  const b = readBodyFacts(body);
  // Integrations är det ENDA fallet där rubriken är en pålitlig STRUKTUR-etikett
  // ("Integrations" / "Works with your tools"), inte en slogan — men bara som
  // avsikts-signal, alltid grindad av logga-rutnätet (≥6 bilder). Intent läses
  // BARA ur rubriken: att skanna kroppen efter "works"/"apps" felträffade
  // feature-sektioner (asana) i 210-sajtssvepet — övriga typer läser aldrig
  // rubriken alls.
  const integrationIntent = /integrat|works with|connect (?:your|to)|\bapps?\b/i.test(heading);
  // Reliable, tag-anchored cues only (semantic tags / a real table / a form).
  if (b.videoEmbed) return "video";
  // Riktig accordion-KLASS räcker; en <details>-baserad widget måste dessutom
  // bära minst en FRÅGA (annars är det en feature-flik, inte en FAQ).
  if (b.accordion || (b.details >= 2 && b.faqQuestions >= 1)) return "faq";
  if (b.tableRows >= 3) return "comparison";
  // Testimonials via SEMANTISKA bevis-taggar (LLM-revision 2026-07-24) — inte de
  // lösa text/klass-signaler som drogs i d18f89d. En vägg av <blockquote> (≥4)
  // eller ett ifyllt stjärnbetyg (≥4 glyfer) ÄR strukturellt socialt bevis och
  // felträffar inte prosa: enda icke-testimonials-blockquote-träffen på 1902
  // sektioner var en changelog (bq3), utesluten av tröskeln. Fångar väggar vars
  // rubrik är en slogan ("Beyond expectations" resend, "3,000,000+" ro,
  // "Built for businesses of all sizes" zendesk).
  if (b.blockquotes >= 4 || b.starGlyphs >= 4) return "testimonials";
  if (b.integrationsClass || (b.images >= 6 && integrationIntent)) return "integrations";
  if (b.signupForm) return "cta";
  // features is a NON-evidence label (never a lift target), so an approximate
  // multi-item signal is acceptable where a wrong evidence type would not be.
  if (b.featureGridClass || b.subHeadings >= 3 || b.iconListItems >= 3) return "features";
  // Structural testimonials is ONLY the semantic-tag cues above (blockquote≥4 /
  // star≥4). Deliberately STILL NO structural pricing / logos, and NO loose
  // testimonials text/class cues: the 210-site scan (2026-07-24) showed the
  // price-count and class-token cues false-positive on incidental markup
  // ("What's the ROI on better work?" → pricing; a stray "reviews"/"brands"
  // token → testimonials/logos). Those are EVIDENCE types, so a wrong one becomes
  // a fake lift target — worse than an honest "section". Real pricing/logos
  // sections are still typed by their heading (classifySectionHeading) and by
  // proofFromBody's "trusted by"/count text.
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
  // Rubrik-buret bevis FLAGGAR bara (om-typar ALDRIG): "9,300+ customers trust
  // Front" i en RUBRIK är riktigt bevis för [proof]-taggen och granskas
  // måltavleval, men en feature-rubrik som råkar nämna ett antal är inte
  // strukturellt en bevis-strip — så rubrikträffen rör aldrig typen, bara
  // flaggan (fleet-E2E 2026-07-23: 10 av 43 "None"-sajter bar bevis i en rubrik
  // som kroppsskannern missade). Typerna hålls golden-stabila.
  const containsTrustSignals = proof !== null || proofFromBody(heading) !== null;
  return { type, containsTrustSignals };
}

/** Collect each h1/h2 heading in <main> with its BODY slice — the HTML from the
 *  end of its heading to the start of the next heading, in DOCUMENT order. The
 *  last section's slice stops at the first <footer> (granskningsfynd 2026-07-22:
 *  without <main> the region is the whole doc, so an unbounded last slice sweeps
 *  the footer's badges/accordions/"Join 50,000 subscribers" and mistypes as
 *  proof/faq/stats). Shared by extractSections (typing) and sectionBodyExcerpts
 *  (the LLM ceiling's prompt) so the two never slice differently. */
function collectSectionBodies(html: string): { level: number; text: string; body: string }[] {
  const main = mainRegion(html);
  const heads: { level: number; text: string; headStart: number; bodyStart: number }[] = [];
  const re = /<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(main))) {
    const text = stripTags(m[2]);
    if (text) heads.push({ level: Number(m[1][1]), text, headStart: m.index, bodyStart: re.lastIndex });
  }
  const footerIdx = main.search(/<footer\b/i);
  const bodyEnd = footerIdx >= 0 ? footerIdx : main.length;
  return heads.map((h, i) => ({
    level: h.level,
    text: h.text,
    body: main.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].headStart : Math.max(h.bodyStart, bodyEnd)),
  }));
}

/** Per-section body excerpt for the LLM section-typer (server-side ceiling). Same
 *  slices as extractSections, flattened to readable text with IMAGE ALT surfaced
 *  (image-rendered testimonials carry their copy in alt) and data-URIs dropped,
 *  capped for a cheap prompt. Deduped by heading like the section model, so the
 *  excerpts align 1:1 with RedesignContentModel.sections by heading. */
export function sectionBodyExcerpts(html: string, cap = 600): { heading: string; excerpt: string }[] {
  const seen = new Set<string>();
  const out: { heading: string; excerpt: string }[] = [];
  for (const h of collectSectionBodies(html)) {
    const heading = h.text.slice(0, 120);
    const key = heading.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // <style>/<script>-INNEHÅLL bort först (stripTags tar taggen men lämnar CSS/JS-
    // texten kvar → brex/plaid/mongodb gav ren CSS till prompten, rapportfynd
    // 2026-07-24). Sedan lyft <img alt> (delimiter-backreferens \1 så en apostrof
    // INUTI en dubbelciterad alt inte kapar texten), sist data-URIer bort.
    const cleaned = h.body
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/data:[^"')\s]+/gi, " ");
    const withAlt = cleaned.replace(/<img\b[^>]*?\balt=(["'])([\s\S]*?)\1[^>]*?>/gi, " $2 ");
    const flat = stripTags(withAlt);
    out.push({ heading, excerpt: flat.slice(0, cap) });
  }
  return out;
}

function extractSections(html: string): RedesignContentModel["sections"] {
  const heads: { level: number; text: string; body: string }[] = collectSectionBodies(html);
  // The hero leads. If <main> has the h1, move it to front; if the h1 lives
  // OUTSIDE <main> (a header hero), prepend it so the hero isn't lost — while the
  // h2 sections stay scoped to <main> to avoid nav/footer noise.
  const docH1 = primaryH1(html);
  const mainH1Idx = heads.findIndex((h) => h.level === 1);
  if (mainH1Idx > 0) heads.unshift(heads.splice(mainH1Idx, 1)[0]);
  else if (mainH1Idx < 0 && docH1) heads.unshift({ level: 1, text: docH1, body: "" });
  const heroPresent = heads.some((h) => h.level === 1);

  const built = heads.map((h, i) => {
    const headingType = classify(h.text, heroPresent && i === 0);
    // The hero is never re-TYPED from its body (it legitimately wraps media/
    // proof) — but its proof FLAG is still computed (granskningsfynd 2026-07-22):
    // "Trusted by 10,000 teams" in the hero is real proof the designer brief
    // must see, or the LLM redundantly moves other proof up beside it.
    const { type, containsTrustSignals } =
      headingType === "hero"
        ? {
            type: "hero",
            // Hjälten flaggas från BÅDE rubrik och kropp ("Join 150,000+
            // businesses" bor ofta i själva hjälterubriken) — men om-typas aldrig.
            containsTrustSignals: proofFromBody(`${h.text || ""} ${h.body || ""}`) !== null,
          }
        : refineType(headingType, h.body || "", h.text);
    return {
      type,
      heading: h.text.slice(0, 120),
      aboveFold: type === "hero", // honest approximation w/o a render: only the hero is above the fold
      containsTrustSignals,
    };
  });
  // Dedup EXAKTA rubrikdubbletter (kapaciteten "fånga vad besökaren SER", steg 1):
  // responsiva teman renderar mobil- OCH desktop-kopior av samma rubrik i DOM:en,
  // men besökaren ser EN. Den synliga-DOM-serialiseringen uppströms tar bort
  // display:none-kopiorna; detta fångar resten (synliga exakta dubbletter). Behåll
  // FÖRSTA förekomsten i dokumentordning; id/position/visualWeight sätts efter
  // dedup så modellen är sammanhängande. (monday: 16 → 11 riktiga sektioner.)
  const seen = new Set<string>();
  return built
    .filter((s) => {
      const key = s.heading.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s, i) => ({
      id: `sec-${i + 1}-${s.type}`,
      type: s.type,
      position: i + 1,
      heading: s.heading,
      aboveFold: s.aboveFold,
      visualWeight: s.type === "hero" ? 85 : Math.max(20, 60 - i * 4),
      containsTrustSignals: s.containsTrustSignals,
    }));
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
    // Garanti/pengarna-tillbaka (portad + åtstramad från lab-detektorn,
    // detectors.generated.ts): fyndet "Inga förtroendesignaler" var OSANT på
    // sidor vars starkaste bevis ÄR en garanti (activecampaign: "…or get your
    // money back"). Kräver kontext (money-back / N-day / satisfaction / warranty
    // / garanti / öppet köp) så ett löst "no guarantee that…" aldrig fångas.
    {
      type: "guarantee",
      re: /((?:\d+[- ]?(?:day|dagars?)\s+)?money[- ]?back(?:\s+guarantee)?|satisfaction guarantee|\d+[- ]?(?:day|dagars?)\s+guarantee|[öo]ppet k[öo]p|n[öo]jd[- ]?kund\w*|\bwarranty\b|\bgaranti\b)/i,
    },
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
