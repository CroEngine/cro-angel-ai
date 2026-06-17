#!/usr/bin/env bun
// A+C drift-detektor.
// =====================================================================
// Den enda drift som är värd att gate:a på är extractor-versionsdrift —
// capture-Chromium-drift accepteras som proveniens (se freeze-report.json::env).
//
// Detta script är minimalt och avsiktligt: det iterearar public/corpus/*,
// läser eventuella score.json + freeze-report.json, och rapporterar:
//
//   1. Vilka snapshots som har vilken extractor-version-stämpel
//   2. Om flera extractor-versioner är representerade — då är scores
//      ojämförbara och korpusen måste re-scoras
//   3. Per-snapshot proveniens (Chromium-version vid frystidpunkt) — bara
//      informativt, gate:as inte
//
// Den faktiska re-scoringen (parse(mhtml) -> extractor_vN) byggs ihop när
// score-aggregatorn landar. Tills dess: detta script är skelettet som låser
// invarianten "varje score måste bära sin extractor-version".
//
// Användning:
//   bun run scripts/rescore-corpus.ts
//   bun run scripts/rescore-corpus.ts --verbose
//   echo $?  # 0 = ok, 1 = drift

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

import { EXTRACTOR_VERSION } from "../src/lib/tests/extractor-version";

const CORPUS_DIR = join(process.cwd(), "public", "corpus");
const verbose = process.argv.includes("--verbose");

type Site = {
  name: string;
  extractorVersion: string | null;
  scoredAt: string | null;
  capture: {
    chromiumVersion: string | null;
    frozenAt: string | null;
  } | null;
};

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function scanSite(name: string): Site | null {
  const dir = join(CORPUS_DIR, name);
  if (!statSync(dir).isDirectory()) return null;

  const freezeReport = readJsonSafe(join(dir, "freeze-report.json"));
  const score = existsSync(join(dir, "score.json"))
    ? readJsonSafe(join(dir, "score.json"))
    : null;

  const env = (freezeReport?.env as Record<string, unknown> | undefined) ?? null;

  return {
    name,
    extractorVersion: (score?.extractorVersion as string | undefined) ?? null,
    scoredAt: (score?.capturedAt as string | undefined) ?? null,
    capture: env
      ? {
          chromiumVersion: (env.chromiumVersion as string | null) ?? null,
          frozenAt: (env.frozenAt as string | null) ?? null,
        }
      : null,
  };
}

function main(): number {
  if (!existsSync(CORPUS_DIR)) {
    console.log(`Ingen corpus-katalog på ${CORPUS_DIR} — inget att kontrollera.`);
    return 0;
  }

  const sites: Site[] = [];
  for (const entry of readdirSync(CORPUS_DIR)) {
    const site = scanSite(entry);
    if (site) sites.push(site);
  }

  if (sites.length === 0) {
    console.log("Korpusen är tom.");
    return 0;
  }

  console.log(`A+C drift-rapport — extractor_v${EXTRACTOR_VERSION}`);
  console.log("=".repeat(60));

  const byVersion = new Map<string, Site[]>();
  const unscored: Site[] = [];

  for (const s of sites) {
    if (!s.extractorVersion) {
      unscored.push(s);
      continue;
    }
    const bucket = byVersion.get(s.extractorVersion) ?? [];
    bucket.push(s);
    byVersion.set(s.extractorVersion, bucket);
  }

  if (verbose || unscored.length > 0) {
    console.log(`\nEj scorade ännu (${unscored.length}):`);
    for (const s of unscored) {
      const cap = s.capture
        ? `chromium=${s.capture.chromiumVersion ?? "?"} @ ${s.capture.frozenAt ?? "?"}`
        : "ingen freeze-report.env";
      console.log(`  - ${s.name}  [${cap}]`);
    }
  }

  console.log(`\nScored, grupperat per extractor-version:`);
  for (const [version, bucket] of byVersion) {
    const flag = version === EXTRACTOR_VERSION ? "✓ current" : "✗ STALE";
    console.log(`  ${flag}  v${version}  (${bucket.length} sajter)`);
    if (verbose) {
      for (const s of bucket) {
        console.log(`      - ${s.name}  scoredAt=${s.scoredAt}`);
      }
    }
  }

  // Drift = mer än en extractor-version representerad bland scorade snapshots.
  const versions = [...byVersion.keys()];
  const stale = versions.filter((v) => v !== EXTRACTOR_VERSION);

  if (versions.length > 1) {
    console.error(
      `\n✗ DRIFT: ${versions.length} extractor-versioner i samma korpus ` +
        `(${versions.join(", ")}). Scores är ojämförbara — kör re-score.`,
    );
    return 1;
  }
  if (stale.length > 0) {
    console.error(
      `\n✗ STALE: alla ${stale.length} scores är från äldre extractor ` +
        `(${stale.join(", ")}). Re-scora under v${EXTRACTOR_VERSION}.`,
    );
    return 1;
  }

  console.log(`\n✓ OK — alla scorade snapshots på v${EXTRACTOR_VERSION}.`);
  return 0;
}

process.exit(main());
