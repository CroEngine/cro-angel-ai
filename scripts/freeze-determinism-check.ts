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
 * Pairwise: med N=3 får vi 3 par. AMBER/RED-verdicts SKRIVER UT fält-nivå-diff
 * (drifting lines med before/after fragment + mekanism-hint) till stdout — så
 * "läs diff:en först"-regeln i AMBER-handlingen är operationell utan att läsa
 * diff.json separat. Utan detta defaulter den till "tryck på knappen igen
 * med större N" — som per design är fel verdict-flöde.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { normalizeMhtml } from "../src/lib/tests/snapshot/mhtml-normalize";
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

// Mekanism-hints för diff-klassificering i AMBER/RED-utskriften. Hint-träff
// betyder INTE auto-promotion till whitelist — det är en pekare för
// reviewern: "denna line ser ut att komma från mekanism X, kolla om X
// finns i WHITELIST.md eller borde läggas till".
//
// Whitelist-patterns och normalizeMhtml() lever nu i
// src/lib/tests/snapshot/mhtml-normalize.ts (enhetstestat efter Block A:s
// QP-encoding-fix; tidigare no-op'ade attribut-maskerna mot wire-shapen).
const MECHANISM_HINTS: Array<{ name: string; re: RegExp }> = [
  { name: "session-token:hubspot-laboratory", re: /laboratory-identifier-/i },
  { name: "consent-cmp:onetrust", re: /optanon|data-domain-script|onetrust/i },
  { name: "consent-cmp:other", re: /usercentrics|didomi|cookieyes|cookielaw/i },
  { name: "ab:optimizely", re: /optimizely|optly/i },
  { name: "ab:vwo", re: /_vis_opt_|data-vwo|__vwo/i },
  { name: "ab:adobe-target", re: /adobe-target|mboxdefault/i },
  { name: "personalization:dynamic-yield", re: /dynamic-yield|\bdy-rec-/i },
  { name: "session-token:csrf", re: /csrf-token|xsrf|data-csrf/i },
  { name: "session-token:nonce", re: /\bnonce=/i },
  { name: "cdn-bust:hash-query", re: /[?&](v|t|ts|cb|cache|version|build|hash)=[a-z0-9.-]+/i },
  { name: "cdn-bust:filename-hash", re: /\.[a-f0-9]{8,}\.(js|css|woff2?|png|jpe?g|svg)/i },
  { name: "ads:googletag", re: /googletag|googlesyndication|pubads|prebid/i },
  { name: "session-recording", re: /_uxa|usabilla|fullstory|_hjSettings|hotjar|mouseflow|clarity/i },
  // D1: animation:mid-frame-transform — capture-time variance, NOT a content/session driver.
  // Hint only (no whitelist row); policy avvaktar Block B/C i plan v2.
  { name: "animation:mid-frame-transform", re: /transform:\s*translate[XY]?\([^)]*-?\d+(\.\d+)?(px|%)\)/i },
];

function classifyLine(line: string): string {
  const hits = MECHANISM_HINTS.filter((h) => h.re.test(line)).map((h) => h.name);
  return hits.length > 0 ? hits.join(",") : "unclassified";
}




interface DriftRow {
  line: number;
  before: string;
  after: string;
  hint: string;
}

interface PairDiff {
  pair: [number, number];
  mhtmlIdentical: boolean;
  driftCount: number;
  driftRows: DriftRow[]; // up to 50 — bounded så diff.json inte sväller
  hintCounts: Record<string, number>;
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
    removeSelectors: spec!.removeSelectors,
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
    const driftRows: DriftRow[] = [];
    const hintCounts: Record<string, number> = {};
    let total = 0;
    for (let k = 0; k < max; k++) {
      if (a[k] === b[k]) continue;
      total++;
      const before = (a[k] ?? "<EOF>").slice(0, 200);
      const after = (b[k] ?? "<EOF>").slice(0, 200);
      const hint = classifyLine(before + " || " + after);
      hintCounts[hint] = (hintCounts[hint] ?? 0) + 1;
      if (driftRows.length < 50) driftRows.push({ line: k, before, after, hint });
    }
    pairs.push({
      pair: [i, j],
      mhtmlIdentical: total === 0,
      driftCount: total,
      driftRows,
      hintCounts,
    });
  }
}

const driftedPairs = pairs.filter((p) => !p.mhtmlIdentical).length;
const verdict =
  driftedPairs === 0
    ? "GREEN: 0 unexpected-drift across all pairs"
    : driftedPairs === 1
      ? "AMBER: drift in 1 pair — READ DIFF BELOW before re-running with larger N (drift in known whitelist mechanism → widen whitelist; new field → RED)"
      : "RED: drift in >=2 pairs — whitelist incomplete or genuine non-determinism (read diff below; new whitelist row or real instability)";

const whitelistPath = join("fixtures", "determinism", "WHITELIST.md");
const whitelistSha = existsSync(whitelistPath)
  ? createHash("sha256").update(readFileSync(whitelistPath)).digest("hex")
  : "missing";

const diff = {
  site: name,
  url: spec.url,
  ranAt: new Date().toISOString(),
  N,
  whitelistVersion: `sha256:${whitelistSha}`,
  whitelistPath,
  pairs,
  driftedPairCount: driftedPairs,
  verdict,
};
const diffPath = join(outDir, "diff.json");
writeFileSync(diffPath, JSON.stringify(diff, null, 2));

// eslint-disable-next-line no-console
console.log(`\n[determinism] -> ${diffPath}`);
// eslint-disable-next-line no-console
console.log(`[determinism] ${verdict}\n`);

// Field-level diff to stdout for AMBER/RED. Without this the "read diff first"
// rule is unenforceable — operator defaults to N=5 retry.
if (driftedPairs > 0) {
  for (const p of pairs) {
    if (p.mhtmlIdentical) continue;
    // eslint-disable-next-line no-console
    console.log(`--- pair [${p.pair[0]}, ${p.pair[1]}]  driftCount=${p.driftCount}`);
    // eslint-disable-next-line no-console
    console.log(`    hint summary: ${JSON.stringify(p.hintCounts)}`);
    for (const r of p.driftRows.slice(0, 15)) {
      // eslint-disable-next-line no-console
      console.log(
        `    L${r.line}  [${r.hint}]\n      A: ${r.before}\n      B: ${r.after}`,
      );
    }
    if (p.driftRows.length > 15) {
      // eslint-disable-next-line no-console
      console.log(`    ... +${p.driftRows.length - 15} more rows (full diff in diff.json)`);
    }
  }
}

if (driftedPairs >= 2) process.exit(1);
