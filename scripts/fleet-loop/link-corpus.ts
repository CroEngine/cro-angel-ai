#!/usr/bin/env bun
// Länka den frysta korpusen (capture-corpus/<namn>/frozen.html) in i
// flottrunnerns form (fleet-preview/<namn>/frozen-home.html) + skriv en
// sites-file — så kör preview-fleet HELT offline mot redan frysta sidor
// (frys-steget hoppar när filen finns). Kopior, inte symlänkar: flottans
// CI-städning får aldrig kunna radera korpusens original.
//
//   bun run scripts/fleet-loop/link-corpus.ts [--out=fleet-preview/corpus-sites.json]

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CORPUS_DOMAINS } from "../capture-eval/corpus-domains";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? join("fleet-preview", "corpus-sites.json");
const SRC = "capture-corpus";
const DST = "fleet-preview";

// Samma namnform som freeze-corpus använder — annars länkar vi fel katalog.
const urlByName = new Map(
  [...new Set(CORPUS_DOMAINS)].map((d) => [
    d.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/gi, "-"),
    `https://${d}/`,
  ]),
);

const sites: { name: string; url: string }[] = [];
for (const name of readdirSync(SRC).sort()) {
  const src = join(SRC, name, "frozen.html");
  if (!existsSync(src)) continue;
  const url = urlByName.get(name);
  if (!url) {
    console.warn(`[link-corpus] ${name}: okänd domän (inte i corpus-domains) — hoppas`);
    continue;
  }
  mkdirSync(join(DST, name), { recursive: true });
  copyFileSync(src, join(DST, name, "frozen-home.html"));
  sites.push({ name, url });
}
mkdirSync(DST, { recursive: true });
writeFileSync(OUT, JSON.stringify(sites, null, 2));
console.log(`[link-corpus] ${sites.length} frysta sidor länkade → ${OUT}`);
