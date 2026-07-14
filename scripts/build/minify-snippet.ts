#!/usr/bin/env bun
// Minifiera snippeten i BYGGUTDATA — källan förblir läsbar.
//
// Kunder laddar /adaptive.js på varje förstabesök; ominifierad väger den ~83 KB.
// Det här steget kör efter `vite build` och skriver den minifierade versionen
// över kopian i publiceringskatalogen (dist/), så SAMMA URL serverar ~hälften
// rå och ~20 KB gzippad — utan att någon utveckling ändras: all kod, alla
// tester och robusthets-harnesset läser fortfarande public/adaptive.js.
//
// CI-smoken (scripts/ci/serving-smoke.mjs) kör mot BÅDE källan och den
// minifierade utdatan, så en minifierare som skulle ändra beteende blir ett
// rött bygge — inte en tyst kundbugg.
//
//   bun run scripts/build/minify-snippet.ts
//
// Publiceringskatalogen beror på Nitro-preset: `dist` på Netlify
// (NITRO_PRESET=netlify), `.output/public` lokalt — alla som finns skrivs.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { transform } from "esbuild";

const source = readFileSync("public/adaptive.js", "utf8");
const out = await transform(source, {
  minify: true,
  // Snippeten är medvetet gammaldags JS (var/function) för maximal
  // webbläsartäckning — minifieraren får inte "modernisera" den.
  target: "es2017",
  legalComments: "none",
});

const banner = "/* CROENGINE Angel — minifierad; källa: public/adaptive.js i repot */\n";
const minified = banner + out.code;

const targets = ["dist", ".output/public"]
  .map((d) => join(d, "adaptive.js"))
  .filter((p) => existsSync(p));
if (targets.length === 0) {
  console.error("[minify-snippet] ingen adaptive.js i dist/ eller .output/public/ — kördes vite build först?");
  process.exit(1);
}
for (const target of targets) {
  writeFileSync(target, minified);
  console.log(
    `[minify-snippet] ${target}: ${source.length} → ${minified.length} bytes (${Math.round((minified.length / source.length) * 100)} %)`,
  );
}
