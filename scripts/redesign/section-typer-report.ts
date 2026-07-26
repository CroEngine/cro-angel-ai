#!/usr/bin/env bun
// Informativ FLERPERSPEKTIV-rapport för sektionstypnings-TAKET över en bred,
// mångsidig sajtlista (e-handel, media, dev, fintech, SaaS, edu). Per sajt:
// GOLVET (extractContentModel: rubrik-vokabulär + strukturcues) → generiska
// sektioner → classifySectionsLlm (med KONFIDENS) → skulle-befordras-beslut
// (>=0.7, befordringsbar, annan typ). Skriver en läsbar rapport + ett kompakt
// JSON-block (===JSON===/===ENDJSON===) för maskinanalys av precision/recall.
//
//   ANTHROPIC_API_KEY=... bun run scripts/redesign/section-typer-report.ts
//   ...  --urls=stripe.com,notion.so   (annars den inbyggda breda listan)
//
// Statisk hämtning (gratis): SPA-skal syns som "tunna" och rapporteras ärligt —
// ett eget perspektiv (capture-readiness / var steg-2-render behövs).

import { extractContentModel, sectionBodyLookup } from "../../src/adaptive/redesign/extract";
import { classifySectionsLlm } from "../../src/adaptive/redesign/section-llm.server";

const GENERIC = new Set(["section", "content", "features"]);
const PROMOTABLE = new Set([
  "testimonials",
  "pricing",
  "logos",
  "stats",
  "comparison",
  "faq",
  "features",
  "cta",
  "video",
  "integrations",
]);
const EVIDENCE = new Set(["testimonials", "pricing", "logos", "stats", "comparison", "faq"]);
const FLOOR = 0.7;

// ~30 sajter tvärs kategorier. Marknadssidor SSR:ar ofta även när appen är en SPA;
// de som inte gör det syns som tunna och blir sitt eget fynd.
const DEFAULT_URLS = [
  // e-handel / DTC
  "whoop.com", "hellofresh.com", "allbirds.com", "warbyparker.com", "glossier.com",
  "casper.com", "gymshark.com", "ruggable.com", "brooklinen.com", "liquiddeath.com",
  // media
  "theverge.com", "wired.com", "bbc.com", "techcrunch.com",
  // dev / infra
  "github.com", "docker.com", "mongodb.com", "digitalocean.com",
  // fintech
  "wise.com", "brex.com", "plaid.com",
  // SaaS
  "monday.com", "hotjar.com", "pipedrive.com", "mailchimp.com", "calendly.com",
  // edu / consumer / creator
  "coursera.org", "brilliant.org", "gumroad.com",
];

const urlsArg = process.argv.find((a) => a.startsWith("--urls="))?.split("=")[1];
const URLS = urlsArg ? urlsArg.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_URLS;

interface Row {
  heading: string;
  floorType: string;
  llmType: string | null;
  conf: number;
  promote: boolean;
  excerpt: string;
}
interface SiteResult {
  url: string;
  ok: boolean;
  error?: string;
  floorCount: number;
  genericCount: number;
  rows: Row[];
}

const results: SiteResult[] = [];
for (const url of URLS) {
  const full = url.startsWith("http") ? url : `https://${url}`;
  try {
    const res = await fetch(full, {
      headers: { "user-agent": "Mozilla/5.0 (AngelAdaptive report)" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    if (!res.ok) {
      results.push({ url: full, ok: false, error: `HTTP ${res.status}`, floorCount: 0, genericCount: 0, rows: [] });
      continue;
    }
    const html = await res.text();
    const model = extractContentModel(html);
    const bodyOf = sectionBodyLookup(html);
    const generics = model.sections.filter((s) => GENERIC.has(s.type));
    const labels = await classifySectionsLlm(
      generics.map((s) => ({ heading: s.heading, body: bodyOf(s.heading) })),
    );
    const rows: Row[] = generics.map((s, i) => {
      const l = labels?.[i] ?? null;
      const conf = l?.confidence ?? 0;
      const promote = !!l && conf >= FLOOR && PROMOTABLE.has(l.type) && l.type !== s.type;
      return {
        heading: s.heading.slice(0, 62),
        floorType: s.type,
        llmType: l?.type ?? null,
        conf,
        promote,
        excerpt: (bodyOf(s.heading)).replace(/\s+/g, " ").slice(0, 130),
      };
    });
    results.push({ url: full, ok: true, floorCount: model.sections.length, genericCount: generics.length, rows });
    console.error(`[report] ${full} ok (${model.sections.length} sec, ${generics.length} generic)`);
  } catch (e) {
    results.push({ url: full, ok: false, error: (e as Error).message.slice(0, 60), floorCount: 0, genericCount: 0, rows: [] });
    console.error(`[report] ${full} FAIL ${(e as Error).message.slice(0, 60)}`);
  }
}

// ── läsbar rapport ─────────────────────────────────────────────────────────────
for (const r of results) {
  if (!r.ok) {
    console.log(`\n### ${r.url}  —  ✗ ${r.error}`);
    continue;
  }
  const proms = r.rows.filter((x) => x.promote);
  console.log(`\n### ${r.url}  |  floor ${r.floorCount} sec (${r.genericCount} generic)  |  ceiling +${proms.length}`);
  for (const x of proms)
    console.log(`   ${x.floorType}→${x.llmType}  ${x.conf.toFixed(2)}  "${x.heading}"\n        ${x.excerpt}`);
  // nära-missar: LLM såg bevis men under golvet — visar var taket är FÖRSIKTIGT
  for (const x of r.rows.filter((x) => !x.promote && x.llmType && EVIDENCE.has(x.llmType) && x.conf > 0.3))
    console.log(`   · below-floor  ${x.llmType} ${x.conf.toFixed(2)}  "${x.heading}"`);
}

// ── aggregat ───────────────────────────────────────────────────────────────────
const ok = results.filter((r) => r.ok);
const allProm = ok.flatMap((r) => r.rows.filter((x) => x.promote));
const byType: Record<string, number> = {};
for (const x of allProm) byType[x.llmType!] = (byType[x.llmType!] || 0) + 1;
const evidenceProm = allProm.filter((x) => EVIDENCE.has(x.llmType!));
console.log(`\n\n### AGGREGATE — ${ok.length}/${results.length} fetched ok`);
console.log(`sections total: ${ok.reduce((a, r) => a + r.floorCount, 0)}`);
console.log(`generic after floor: ${ok.reduce((a, r) => a + r.genericCount, 0)}`);
console.log(`ceiling promotions: ${allProm.length}  (evidence types: ${evidenceProm.length})`);
console.log(`by type: ${JSON.stringify(byType)}`);
console.log(`avg confidence (promoted): ${(allProm.reduce((a, x) => a + x.conf, 0) / (allProm.length || 1)).toFixed(2)}`);
console.log(
  `thin/blocked: ${results
    .filter((r) => !r.ok || r.floorCount < 3)
    .map((r) => r.url.replace("https://", "") + (r.ok ? `(${r.floorCount})` : `(${r.error})`))
    .join(", ") || "none"}`,
);

// ── maskinblock (utan utdrag, för storlek) ───────────────────────────────────────
console.log("\n===JSON===");
console.log(
  JSON.stringify(
    results.map((r) => ({
      url: r.url,
      ok: r.ok,
      error: r.error,
      floorCount: r.floorCount,
      genericCount: r.genericCount,
      rows: r.rows.map((x) => ({ h: x.heading, from: x.floorType, to: x.llmType, c: Number(x.conf.toFixed(2)), p: x.promote })),
    })),
  ),
);
console.log("===ENDJSON===");
