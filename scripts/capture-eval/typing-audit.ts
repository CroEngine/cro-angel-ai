#!/usr/bin/env bun
// Typnings-REVISION (precisionsfynd 2026-07-24, ägaren: "analysera med LLM så vi
// inte missar något"). typing-precision.ts räknade bara HUR MÅNGA bevis-sektioner
// som föll bort — inte om de var RIKTIGA. HelloFresh ("Why millions love
// HelloFresh", rubrik ÖVER en scroll-karusell av recensioner) visade att
// åtstramningen tog bort ÄKTA testimonials, inte bara brus.
//
// Denna revision kör den RIKTIGA extractContentModel över hela korpusen och
// bifogar varje sektions KROPPSSIGNALER + ett rensat utdrag, så en människa/LLM
// kan döma sanningsvärdet. Tre högar skrivs:
//   - regressions.json : var evidens FÖRE, generisk EFTER (mina bortfall)
//   - falsePositives.json: typad bevis EFTER men kroppen bär inget bevis
//   - missed.json      : generisk men kroppen bär STARKT bevis (recall-lucka)
//
//   bun run scripts/capture-eval/typing-audit.ts
//
// Zero credits, offline: läser frusna korpusar på disk, ingen render, ingen LLM-API.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";

const CORPORA = ["fleet-e2e", "capture-corpus"];
const EVIDENCE = new Set(["testimonials", "pricing", "faq", "logos", "comparison", "stats"]);

// ── delade rensare ───────────────────────────────────────────────────────────
const stripDataUris = (s: string) => s.replace(/data:[^"')\s]+/gi, "");
const stripTags = (s: string) =>
  stripDataUris(s)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// ── kroppsslicing SPEGLAR extractSections (bara för läsbart utdrag + signaler) ──
function mainRegion(html: string): string {
  const m = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  return m ? m[1] : html;
}
function sliceBodies(html: string): { heading: string; body: string }[] {
  const main = mainRegion(html);
  const heads: { text: string; headStart: number; bodyStart: number }[] = [];
  const re = /<(h[12])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(main))) {
    const text = stripTags(m[2]);
    if (text) heads.push({ text, headStart: m.index, bodyStart: re.lastIndex });
  }
  const footerIdx = main.search(/<footer\b/i);
  const bodyEnd = footerIdx >= 0 ? footerIdx : main.length;
  return heads.map((h, i) => ({
    heading: h.text,
    body: main.slice(h.bodyStart, i + 1 < heads.length ? heads[i + 1].headStart : Math.max(h.bodyStart, bodyEnd)),
  }));
}

// ── kroppssignaler: vad ETT MÄNSKLIGT ÖGA skulle kalla bevis ───────────────────
interface Signals {
  images: number;
  blockquotes: number;
  starGlyphs: number;
  quotePairs: number; // "…" par av citattecken
  reviewTokens: number; // review|rating|testimonial|trustpilot|g2|capterra|verified
  proofPlatforms: number; // trustpilot|g2|capterra|clutch|app store|google
  details: number;
  priceHits: number; // $/€/£N, N/mo, per month
  socialCount: number; // "12,000 customers"
  bodyLen: number;
}
function signals(body: string): Signals {
  const flat = stripTags(body);
  const count = (re: RegExp, s: string) => (s.match(re) || []).length;
  return {
    images: count(/<img[\s/>]/gi, body),
    blockquotes: count(/<blockquote[\s/>]/gi, body),
    starGlyphs: count(/[★☆⭐✩✪✰]/g, flat),
    quotePairs: count(/[""].{6,180}?[""]/g, flat) + count(/[""].{6,180}?[""]/g, flat),
    reviewTokens: count(/\b(reviews?|ratings?|testimonials?|verified buyer|verified customer)\b/gi, flat),
    proofPlatforms: count(/\b(trustpilot|g2|capterra|clutch|getapp|app store|play store|product hunt)\b/gi, flat),
    details: count(/<details[\s/>]/gi, body),
    priceHits:
      count(/[$€£]\s?\d/g, flat) +
      count(/\b\d[\d,. ]*\s?\/\s?(?:mo|month|yr|year|m[åa]n)\b/gi, flat) +
      count(/\bper\s+(?:month|user|seat|m[åa]nad)\b/gi, flat),
    socialCount: count(
      /\b\d[\d,. ]*\+?\s+(?:customers|users|companies|teams|businesses|members|kunder|f[öo]retag)\b/gi,
      flat,
    ),
    bodyLen: flat.length,
  };
}

function excerpt(body: string, n = 500): string {
  return stripTags(body).slice(0, n);
}

// ── ladda alla sektioner tvärs korpusen ────────────────────────────────────────
interface Sec {
  site: string;
  corpus: string;
  heading: string;
  type: string;
  sig: Signals;
  excerpt: string;
}
const all: Sec[] = [];
const bySiteHeading = new Map<string, Sec>();

for (const corpus of CORPORA) {
  if (!existsSync(corpus)) continue;
  for (const site of readdirSync(corpus)) {
    const f = join(corpus, site, "frozen.html");
    if (!existsSync(f)) continue;
    let html: string;
    try {
      html = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    let model;
    try {
      model = extractContentModel(html);
    } catch (e) {
      console.error(`[skip] ${corpus}/${site}: ${(e as Error).message}`);
      continue;
    }
    const bodies = new Map(sliceBodies(html).map((b) => [b.heading.slice(0, 120).trim().toLowerCase(), b.body]));
    for (const s of model.sections) {
      const body = bodies.get(s.heading.trim().toLowerCase()) ?? "";
      const rec: Sec = { site, corpus, heading: s.heading, type: s.type, sig: signals(body), excerpt: excerpt(body) };
      all.push(rec);
      bySiteHeading.set(`${site}::${s.heading.trim().toLowerCase()}`, rec);
    }
  }
}

console.log(`[audit] ${all.length} sections across ${new Set(all.map((s) => s.site)).size} sites`);

// ── 1. REGRESSIONER: evidens FÖRE, generisk EFTER ──────────────────────────────
// Kräver de valfria typing-precision-dumparna; saknas de (färsk checkout) hoppas
// regressions-högen tyst — de andra två högarna räknas ändå ur den levande koden.
type Row = { site: string; type: string; heading: string };
const readRows = (p: string): Row[] => {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Row[];
  } catch {
    return [];
  }
};
const before = readRows("capture-eval/typing-before.json");
const after = readRows("capture-eval/typing-after.json");
const afterKey = new Set(after.map((r) => `${r.site}::${r.heading.trim().toLowerCase()}`));
const regressions = before
  .filter((r) => !afterKey.has(`${r.site}::${r.heading.trim().toLowerCase()}`))
  .map((r) => {
    const rec = bySiteHeading.get(`${r.site}::${r.heading.trim().toLowerCase()}`);
    return {
      site: r.site,
      heading: r.heading,
      wasType: r.type,
      nowType: rec?.type ?? "(not found)",
      sig: rec?.sig,
      excerpt: rec?.excerpt,
    };
  });

// ── 2. FALSKA POSITIVA: typad bevis EFTER, men kroppen bär inget bevis ─────────
const bodyProof = (s: Signals) =>
  s.blockquotes >= 1 ||
  s.starGlyphs >= 3 ||
  s.quotePairs >= 2 ||
  s.reviewTokens >= 2 ||
  s.proofPlatforms >= 1 ||
  s.priceHits >= 2 ||
  s.socialCount >= 1 ||
  s.details >= 2 ||
  s.images >= 8; // stor bild-kropp = kan vara bild-renderad testimonials/logos
const falsePositives = all
  .filter((s) => EVIDENCE.has(s.type) && !bodyProof(s.sig))
  .map((s) => ({ site: s.site, heading: s.heading, type: s.type, sig: s.sig, excerpt: s.excerpt }));

// ── 3. MISSADE: generisk typ men kroppen bär STARKT bevis ──────────────────────
const generic = (t: string) => t === "section" || t === "content" || t === "features";
const strongProof = (s: Signals) =>
  s.blockquotes >= 2 ||
  s.starGlyphs >= 4 ||
  s.quotePairs >= 3 ||
  s.reviewTokens >= 3 ||
  s.proofPlatforms >= 2 ||
  s.priceHits >= 3;
const missed = all
  .filter((s) => generic(s.type) && strongProof(s.sig))
  .map((s) => ({ site: s.site, heading: s.heading, type: s.type, sig: s.sig, excerpt: s.excerpt }));

// kompakt HELA-korpus-dump (utan utdrag) för tröskel-precisionssvep
writeFileSync(
  "capture-eval/audit-all.json",
  JSON.stringify(all.map((s) => ({ site: s.site, heading: s.heading, type: s.type, sig: s.sig })), null, 0),
);
writeFileSync("capture-eval/audit-regressions.json", JSON.stringify(regressions, null, 1));
writeFileSync("capture-eval/audit-false-positives.json", JSON.stringify(falsePositives, null, 1));
writeFileSync("capture-eval/audit-missed.json", JSON.stringify(missed, null, 1));

console.log(`[1] regressions (evidence→generic): ${regressions.length}  → capture-eval/audit-regressions.json`);
console.log(`[2] false positives (typed evidence, no body proof): ${falsePositives.length}  → capture-eval/audit-false-positives.json`);
console.log(`[3] missed (generic, strong body proof): ${missed.length}  → capture-eval/audit-missed.json`);

// snabb konsolöversikt av regressionerna (mina bortfall) sorterade på bild-tunga först
console.log("\n=== REGRESSIONS by body signal (image-heavy = likely image-rendered testimonials) ===");
for (const r of [...regressions].sort((a, b) => (b.sig?.images ?? 0) - (a.sig?.images ?? 0)).slice(0, 25)) {
  const s = r.sig;
  const tag = s
    ? `img${s.images} bq${s.blockquotes} star${s.starGlyphs} q${s.quotePairs} rev${s.reviewTokens} plat${s.proofPlatforms} price${s.priceHits} cnt${s.socialCount} len${s.bodyLen}`
    : "(no body)";
  console.log(`  ${r.wasType.padEnd(12)} ${r.site.padEnd(16)} ${JSON.stringify(r.heading).slice(0, 60).padEnd(62)} ${tag}`);
}
