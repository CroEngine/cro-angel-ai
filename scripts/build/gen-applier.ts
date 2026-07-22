#!/usr/bin/env bun
// Kodgen: kompilera variant-appliceraren (src/adaptive/runtime/applier.ts —
// KÄLLAN, ADR-001 steg 4) till typ-strippad es2017-JS och splitsa in den mellan
// markörerna i public/adaptive.js. Samma disciplin som harvest-bundlens
// kodgen-pinne (build:harvest): källa och incheckad artefakt får aldrig glida
// isär tyst.
//
//   bun run gen:applier          — regenerera blocket i public/adaptive.js
//   bun run gen:applier:check    — verifiera utan att skriva (CI-pinnen)
//
// Determinism: esbuild är deterministisk per version; toppnivå-pinnen i
// bun.lock (esbuild@0.27.x) gör att CI:s regenerering matchar den incheckade
// artefakten byte för byte. Kommentarer följer INTE med transformen — all
// designdokumentation bor i källan (applier.ts), blocket är medvetet kalt.

import { readFileSync, writeFileSync } from "node:fs";
import { transform } from "esbuild";

const SRC = "src/adaptive/runtime/applier.ts";
const OUT = "public/adaptive.js";
const BEGIN = "  // >>> GENERATED APPLIER BEGIN (scripts/build/gen-applier.ts) — DO NOT EDIT";
const END = "  // <<< GENERATED APPLIER END";

const ts = readFileSync(SRC, "utf8");
const { code } = await transform(ts, { loader: "ts", target: "es2017" });
// Toppnivå-`export` blir vanliga deklarationer inne i snippet-IIFE:n (typerna
// är redan strippade av transformen).
const body = code.replace(/^export\s+/gm, "").trimEnd();
const indented = body
  .split("\n")
  .map((l) => (l.trim() ? "  " + l : l))
  .join("\n");

const snippet = readFileSync(OUT, "utf8");
const b = snippet.indexOf(BEGIN);
const e = snippet.indexOf(END);
if (b < 0 || e < 0 || e < b) {
  console.error(`[gen-applier] markörerna saknas/felordnade i ${OUT} — blocket kan inte splitsas.`);
  process.exit(1);
}
const next = snippet.slice(0, b + BEGIN.length) + "\n" + indented + "\n" + snippet.slice(e);

if (process.argv.includes("--check")) {
  if (next !== snippet) {
    console.error(
      `[gen-applier] DRIFT: applier-blocket i ${OUT} matchar inte källan ${SRC}. Kör: bun run gen:applier`,
    );
    process.exit(1);
  }
  console.log("[gen-applier] check OK — källa och genererat block i synk");
} else {
  writeFileSync(OUT, next);
  console.log(`[gen-applier] skrev ${indented.length} bytes applier-block till ${OUT}`);
}
