#!/usr/bin/env bun
/**
 * Grind 1 — Determinism check (N=3 freezes, pairwise diff mot låst whitelist).
 *
 *   bun run scripts/freeze-determinism-check.ts --name=hubspot
 *   bun run scripts/freeze-determinism-check.ts --name=hubspot --n=3
 *
 * Whitelist:en är låst i fixtures/determinism/WHITELIST.md. Detta script
 * kodar in DEN whitelist:en som regex-listor nedan — om de divergerar är
 * scriptet fel, inte whitelist:en.
 *
 * Pairwise: med N=3 får vi 3 par. Field flaggas om det driftar i >= 2 par
 * (drift i 1 par kan vara A/B-bucket-sammanträffande).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { getSite } from "../corpus/sites";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const name = arg("name");
const N = Number(arg("n") ?? "3");
if (!name) {
  console.error("Usage: bun run scripts/freeze-determinism-check.ts --name=<name> [--n=3]");
  process.exit(1);
}
const spec = getSite(name);
if (!spec) {
  console.error(`[determinism] ingen site '${name}' i corpus/sites.ts`);
  process.exit(1);
}

const outDir = join("fixtures", "determinism", name);
mkdirSync(outDir, { recursive: true });

// === A-priori whitelist (speglar fixtures/determinism/WHITELIST.md) ===
// Om du ändrar något här MÅSTE du också uppdatera WHITELIST.md och vice versa.
const MHTML_WHITELIST_LINE_PATTERNS: RegExp[] = [
  /^Date:\s/i,
  /^Content-Type: multipart\/related;\s*boundary=/i,
  /^Content-ID:\s</i,
  /^Content-Location:.*[?&](t|ts|cb|v|_|cache|version|build|hash)=/i,
];
const HTML_ATTR_WHITELIST_PATTERNS: RegExp[] = [
  /\bnonce="[^"]*"/g,
  /\bdata-[a-z-]+-nonce="[^"]*"/g,
  /<meta name="csrf-token" content="[^"]*">/gi,
  /[?&](t|ts|cb|v|_|cache|version|build|hash)=[a-z0-9.-]+/gi,
];

function normalizeMhtml(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter((line) => !MHTML_WHITELIST_LINE_PATTERNS.some((re) => re.test(line)))
    .map((line) => {
      let out = line;
      for (const re of HTML_ATTR_WHITELIST_PATTERNS) out = out.replace(re, "<WHITELISTED>");
      return out;
    })
    .join("\n");
}

interface PairDiff {
  pair: [number, number];
  mhtmlIdentical: boolean;
  // Lite-fingerprint för rapportering — vi loggar inte hela diff:en till disk.
  mhtmlSampleDrift: string[];
}

async function freezeOnce(idx: number) {
  const tmpOut = join(tmpdir(), `determinism-${name}-${idx}-${Date.now()}`);
  mkdirSync(tmpOut, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`[determinism] freeze ${idx + 1}/${N} -> ${tmpOut}`);
  const result = await freezeSite({
    url: spec!.url,
    name: `${name}-determinism-${idx}`,
    consentSelector: spec!.consentSelector,
    consentDismissCheck: spec!.consentDismissCheck,
    consentInstruction: spec!.consentInstruction,
    outDir: tmpOut,
    notes: `determinism check pass ${idx + 1}/${N}`,
  });
  const mhtmlPath = join(tmpOut, "page.mhtml");
  const mhtml = existsSync(mhtmlPath) ? readFileSync(mhtmlPath, "utf8") : "";
  return { idx, outDir: tmpOut, reportPath: result.reportPath, mhtml };
}

const runs: { idx: number; outDir: string; reportPath: string; mhtml: string }[] = [];
for (let i = 0; i < N; i++) {
  runs.push(await freezeOnce(i));
}

const pairs: PairDiff[] = [];
for (let i = 0; i < runs.length; i++) {
  for (let j = i + 1; j < runs.length; j++) {
    const a = normalizeMhtml(runs[i].mhtml).split("\n");
    const b = normalizeMhtml(runs[j].mhtml).split("\n");
    const max = Math.max(a.length, b.length);
    const drifts: string[] = [];
    for (let k = 0; k < max && drifts.length < 20; k++) {
      if (a[k] !== b[k]) drifts.push(`L${k}: ${(a[k] ?? "<EOF>").slice(0, 120)} | ${(b[k] ?? "<EOF>").slice(0, 120)}`);
    }
    pairs.push({
      pair: [i, j],
      mhtmlIdentical: drifts.length === 0,
      mhtmlSampleDrift: drifts,
    });
  }
}

const driftedPairs = pairs.filter((p) => !p.mhtmlIdentical).length;
const verdict =
  driftedPairs === 0
    ? "GREEN: 0 unexpected-drift across all pairs"
    : driftedPairs === 1
      ? "AMBER: drift in 1 pair (possible A/B coincidence; re-run with larger N)"
      : "RED: drift in >=2 pairs — whitelist incomplete or genuine non-determinism";

const diff = {
  site: name,
  url: spec.url,
  ranAt: new Date().toISOString(),
  N,
  whitelistVersion: "fixtures/determinism/WHITELIST.md (in-tree)",
  pairs,
  driftedPairCount: driftedPairs,
  verdict,
};
const diffPath = join(outDir, "diff.json");
writeFileSync(diffPath, JSON.stringify(diff, null, 2));
// eslint-disable-next-line no-console
console.log(`[determinism] -> ${diffPath}\n[determinism] ${verdict}`);
if (driftedPairs >= 2) process.exit(1);
