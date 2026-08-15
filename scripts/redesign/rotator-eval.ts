#!/usr/bin/env bun
// Rotator-avvägningen mätt mot korpusen (ägarbeslut 2026-08-15 "Kör").
//
// FRÅGAN: cleanHeadingText kollapsar animerade ordrotatorer innan den läser
// rubriken. Ändrar en justering av dess signaler vad vi läser på riktiga sidor?
//
// MÄTER DEN RIKTIGA KODEN, INTE EN KOPIA (granskningsfynd 2026-08-15): bägge
// varianterna av cleanHeadingText extraheras ur källfilerna — den gamla ur en
// git-revision, den nya ur arbetsträdet — och injiceras i sidan. En egen
// reimplementation i mätskriptet kan drifta från det som faktiskt skeppas, och
// gjorde det: skriptets första version rapporterade "0 skillnader" med en smal
// variant som inte längre motsvarade källan.
//
// SAMMA DOM-ÖGONBLICK per sida — inte en sidladdning per variant. Laddar man om
// mäter man layout-drift, inte logik (samma fälla som dedup-A/B:t 2026-08-14).
//
// SJÄLVTESTET ÄR EN SIDA I MÄTNINGEN: en syntetisk fixtur körs genom exakt
// samma väg som korpusen och grindar körningen. Utan den är "0 skillnader"
// tvetydigt — det kan lika gärna betyda att mätningen inte ser någonting.
//
//   bun run scripts/redesign/rotator-eval.ts [--base=<rev>] [--limit=N] [--out=fil]

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const BASE = arg("base") ?? "origin/main";
const LIMIT = Number(arg("limit") ?? 0);
const OUT = arg("out") ?? "rotator-eval.json";
const ROOT = join(import.meta.dirname, "..", "..");
const SRC = "src/lib/tests/scripts/pageAudit.ts";

/** Plocka cleanHeadingText-kroppen ur en fil som bär den i en template literal,
 *  och avescapa till formen webbläsaren faktiskt kör (\\s blir \s). Kastar
 *  hellre än gissar: en tyst miss här hade gett en mätning av ingenting. */
function extractFn(source: string, where: string): string {
  const start = source.indexOf("  function cleanHeadingText(el) {");
  if (start < 0) throw new Error(`cleanHeadingText hittades inte i ${where}`);
  const end = source.indexOf("\n  }\n", start);
  if (end < 0) throw new Error(`slutet på cleanHeadingText hittades inte i ${where}`);
  // Inne i template-literalen står \\s för \s. Inget annat escape förekommer i
  // funktionen (inga backticks, inga ${}) — verifierat innan omskrivningen.
  return source.slice(start, end + 4).replace(/\\\\/g, "\\");
}

const newFn = extractFn(readFileSync(join(ROOT, SRC), "utf8"), `arbetsträdet ${SRC}`);
const oldFn = extractFn(
  execFileSync("git", ["show", `${BASE}:${SRC}`], { cwd: ROOT, encoding: "utf8" }),
  `${BASE}:${SRC}`,
);
if (oldFn === newFn) {
  console.log(`[rotator-eval] cleanHeadingText är IDENTISK med ${BASE} — inget att mäta.`);
  process.exit(0);
}
console.log(`[rotator-eval] ${BASE} (${oldFn.length} tecken) mot arbetsträdet (${newFn.length})`);

interface Row {
  site: string;
  tag: string;
  before: string;
  after: string;
}

const SELFTEST_HTML = `<main>
  <h1>Grow with <span class="animated-text"><span>speed</span> <span>and</span> <span>care</span></span></h1>
  <h2>Pick one <ul><li>A plan</li><li>B plan</li></ul></h2>
  <h2>Rotator on the list <ul class="hero-animated-list"><li>grow</li><li>scale</li></ul></h2>
  <h2>Rotator on the wrapper <span class="text-rotator"><ul><li>grow</li><li>scale</li></ul></span></h2>
  <h2>Plain heading with no rotator</h2>
</main>`;

const sources: { site: string; url?: string; content?: string }[] = [
  { site: "__selftest__", content: SELFTEST_HTML },
  ...readdirSync(join(ROOT, "capture-corpus"))
    .filter((d) => existsSync(join(ROOT, "capture-corpus", d, "frozen.html")))
    .sort()
    .map((d) => ({ site: d, url: `file://${join(ROOT, "capture-corpus", d, "frozen.html")}` })),
  ...readdirSync(join(ROOT, "corpus"))
    .filter((d) => existsSync(join(ROOT, "corpus", d, "page.mhtml")))
    .sort()
    .map((d) => ({ site: `corpus:${d}`, url: `file://${join(ROOT, "corpus", d, "page.mhtml")}` })),
];
// --limit tar från BÄGGE källorna: en naiv slice() på den sammanslagna listan
// skar bort varenda MHTML-capture — inklusive hubspot, som är hela poängen.
const mhtml = sources.filter((x) => x.site.startsWith("corpus:"));
const rest = sources.filter((x) => !x.site.startsWith("corpus:"));
const targets =
  LIMIT > 0 ? [...rest.slice(0, Math.max(2, LIMIT - mhtml.length)), ...mhtml] : sources;
console.log(`[rotator-eval] ${targets.length} sidor (${mhtml.length} MHTML)`);

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const rows: Row[] = [];
const failedSites: string[] = [];

for (const { site, url, content } of targets) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    if (content) await page.setContent(content);
    else await page.goto(url!, { waitUntil: "load", timeout: 45_000 });
    if (site.startsWith("corpus:")) await page.waitForTimeout(1500);
    const out = (await page.evaluate(
      ({ a, b }) => {
        const mk = (src: string) =>
          new Function(`${src}\nreturn cleanHeadingText;`)() as (el: Element) => string;
        const before = mk(a);
        const after = mk(b);
        // Elementmängden följer KONSUMENTERNA: pageAudit skannar h1 dokument-
        // vitt, sections kollapsar även h3/h4 och sektionernas p-underrubriker.
        // Bara h1/h2 i <main> hade burit ett smalare bevis än påståendet.
        const els = Array.from(document.querySelectorAll("h1, h2, h3, h4, p")).slice(0, 300);
        return els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          before: before(el),
          after: after(el),
        }));
      },
      { a: oldFn, b: newFn },
    )) as { tag: string; before: string; after: string }[];
    for (const r of out) rows.push({ site, ...r });
  } catch (e) {
    failedSites.push(site);
    console.warn(`[rotator-eval] ${site} föll: ${String(e).slice(0, 80)}`);
  } finally {
    await page.close();
  }
}
await browser.close();

const probe = rows.filter((r) => r.site === "__selftest__");
const corpus = rows.filter((r) => r.site !== "__selftest__");

// Grinden: fixturen MÅSTE visa bägge över-kollapserna borta och bägge äkta
// rotatorerna kvar. Faller den är korpussiffrorna meningslösa.
{
  const find = (t: string) => probe.find((r) => r.before.startsWith(t) || r.after.startsWith(t));
  console.log("[rotator-eval] SJÄLVTEST (samma kodväg som korpusen)");
  for (const r of probe) {
    console.log(
      `   före=${JSON.stringify(r.before.slice(0, 44))}  efter=${JSON.stringify(r.after.slice(0, 44))}`,
    );
  }
  const checks: [string, boolean][] = [
    ["split-text slutar trunkeras", find("Grow with")?.after === "Grow with speed and care"],
    ["naken lista slutar kollapsa", find("Pick one")?.after === "Pick one A plan B plan"],
    [
      "rotator PÅ listan kollapsar än",
      find("Rotator on the list")?.after === "Rotator on the list grow",
    ],
    [
      "rotator på OMSLAG kollapsar än",
      find("Rotator on the wrapper")?.after === "Rotator on the wrapper grow",
    ],
  ];
  for (const [label, ok] of checks) console.log(`   ${ok ? "OK " : "FEL"} ${label}`);
  if (checks.some(([, ok]) => !ok)) {
    console.error("[rotator-eval] SJÄLVTESTET FÖLL — siffrorna nedan vore meningslösa. Avbryter.");
    process.exit(1);
  }
}

const differing = corpus.filter((r) => r.before !== r.after);
const sites = new Set(corpus.map((r) => r.site)).size;

console.log(`\n[rotator-eval] ${corpus.length} element, ${sites} sidor`);
if (failedSites.length)
  console.log(`[rotator-eval] ${failedSites.length} sidor föll: ${failedSites.join(", ")}`);
console.log(`[rotator-eval] SKILLNAD före/efter: ${differing.length}\n`);

for (const d of differing) {
  console.log(`── ${d.site} <${d.tag}>`);
  console.log(`   före : ${JSON.stringify(d.before.slice(0, 150))}`);
  console.log(`   efter: ${JSON.stringify(d.after.slice(0, 150))}`);
}

writeFileSync(
  isAbsolute(OUT) ? OUT : join(ROOT, OUT),
  JSON.stringify({ base: BASE, corpus, probe, differing, failedSites }, null, 1),
);
console.log(`\n[rotator-eval] rådata → ${OUT}`);
