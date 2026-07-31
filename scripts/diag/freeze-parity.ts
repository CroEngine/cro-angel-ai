#!/usr/bin/env bun
// Text-/struktur-PARITET mellan live och fryst (ägarens "dubbelkolla på fler
// än 1 sätt", 2026-07-28): tredje, oberoende verifieringen vid sidan av
// mediemåttet (räknar målade element) och pixel-banden (räknar avvikande
// ytor). Här räknas INNEHÅLL: den frysta kopian renderas HELT OFFLINE och
// dess rubriker/text/länkar/bilder jämförs mot live-statistiken som freeze-
// page skrev ur samma browser-session (--stats-out).
//
//   Rubrik-täckning: andel av livesidans h1–h3 som återfinns i den frysta
//   kopian (normaliserat; exakt rubrikträff eller förekomst i löptexten).
//   Text-kvot: fryst textmängd / live textmängd — 1,0 = ingen text tappad.
//   Länk-/bildantal: delta som indikation, inte poäng (dedup är medveten).
//
// Rapport-only: exit 0 alltid — saknas live-statistiken (statiska vägen)
// skrivs {skipped:true} och kedjan går vidare ärligt.
//
//   bun run scripts/diag/freeze-parity.ts --frozen=<html> --stats=<live-stats.json> [--out=dir]

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FROZEN = arg("frozen");
const STATS = arg("stats");
const OUT = arg("out") ?? "parity-out";
if (!FROZEN || !STATS) {
  console.error("usage: --frozen=<frozen.html> --stats=<live-stats.json> [--out=dir]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const outPath = join(OUT, "parity.json");

if (!existsSync(STATS)) {
  writeFileSync(outPath, JSON.stringify({ skipped: true, reason: "ingen live-statistik (statisk väg)" }, null, 2));
  console.log("[parity] hoppad — ingen live-statistik (statiska hämtvägen skriver ingen)");
  process.exit(0);
}

interface LiveStats {
  title: string;
  headings: string[];
  textChars: number;
  links: number;
  images: number;
}
const live = JSON.parse(readFileSync(STATS, "utf8")) as LiveStats;
const frozenHtml = readFileSync(FROZEN, "utf8");

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("**/*", (r) => r.abort());
const page = await ctx.newPage();
await page.setContent(frozenHtml, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForTimeout(800);
const frozen = await page.evaluate(() => ({
  headings: Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean),
  text: (document.body?.innerText || "").replace(/\s+/g, " ").trim(),
  links: document.querySelectorAll("a[href]").length,
  images: document.images.length,
}));
await browser.close();

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const frozenHeadingSet = new Set(frozen.headings.map(norm));
const frozenTextNorm = norm(frozen.text);
const missing: string[] = [];
let found = 0;
for (const h of live.headings) {
  const n = norm(h);
  if (frozenHeadingSet.has(n) || (n.length >= 8 && frozenTextNorm.includes(n))) found++;
  else if (missing.length < 8) missing.push(h.slice(0, 90));
}
const recall = live.headings.length > 0 ? Math.round((found / live.headings.length) * 1000) / 10 : 100;
const textRatio = live.textChars > 0 ? Math.round((frozen.text.length / live.textChars) * 1000) / 1000 : 1;

console.log(
  `[parity] RUBRIK-TÄCKNING: ${recall}% — ${found}/${live.headings.length} av livesidans h1–h3 återfinns i frysta kopian`,
);
for (const m of missing) {
  console.log(`[parity]   saknad rubrik: ${m}`);
}
console.log(
  `[parity] TEXT-KVOT: ${textRatio} (fryst ${frozen.text.length} / live ${live.textChars} tecken)${textRatio < 0.9 ? " — UNDER 0,9: granska vad som tappats" : ""}`,
);
console.log(`[parity] länkar: live ${live.links} → fryst ${frozen.links} · bilder: live ${live.images} → fryst ${frozen.images}`);

writeFileSync(
  outPath,
  JSON.stringify(
    {
      headingsFound: found,
      headingsTotal: live.headings.length,
      headingsRecall: recall,
      missingHeadings: missing,
      textCharsLive: live.textChars,
      textCharsFrozen: frozen.text.length,
      textRatio,
      linksLive: live.links,
      linksFrozen: frozen.links,
      imagesLive: live.images,
      imagesFrozen: frozen.images,
      title: live.title,
    },
    null,
    2,
  ),
);
