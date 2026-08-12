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

import { CORPUS_DOMAINS, nameForDomain } from "../capture-eval/corpus-domains";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = arg("out") ?? join("fleet-preview", "corpus-sites.json");
const SRC = "capture-corpus";
const DST = "fleet-preview";

// DELAD namnhärledning (nameForDomain) — annars länkar vi fel katalog. FÖRST-
// vinner vid namnkollision, för det är freeze-corpus semantik (första domänen
// med namnet skapar katalogen; senare hoppas som "redan fryst") — sist-vinner
// hade parat den frysta sidan med FEL domäns URL, tyst.
const urlByName = new Map<string, string>();
for (const d of [...new Set(CORPUS_DOMAINS)]) {
  const name = nameForDomain(d);
  if (!urlByName.has(name)) urlByName.set(name, `https://${d}/`);
  else console.warn(`[link-corpus] namnkollision: ${d} → ${name} (först vinner)`);
}

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
