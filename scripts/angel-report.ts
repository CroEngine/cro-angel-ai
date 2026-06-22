#!/usr/bin/env bun
// "Angel report" — run the audit engine live against a frozen corpus page.
// =====================================================================
// Replays corpus/<name>/ through the exact same path the snapshot harness and
// the live engine use (COLLECT_SCRIPT + pageAudit in pinned Playwright
// Chromium), normalizes the result, prints a human-readable CRO/conversion
// audit, and diffs the fresh run against the committed golden.json so
// score-determinism drift is visible in a single command.
//
// "Live" = recomputed from the frozen DOM right now, not a cat of golden.json.
// The frozen MHTML is the input; the audit findings are the output.
//
// Usage:
//   bun run angel --name=hubspot
//   bun run angel --name=hubspot --json        # also dump full normalized JSON
//   bun run angel --name=hubspot --strict      # exit 1 on golden drift
//   bun run angel --name=hubspot --corpus-root=corpus
//
// Replay needs local Playwright Chromium (no Browserbase). The pinned browser
// is preferred (keeps the render-canary calibrated). If it can't be installed,
// set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an available chrome binary — the
// render-canary then reports pinned=false and skips its families receipt.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import {
  normalizeCollect,
  normalizePageAudit,
  diffNormalized,
} from "../src/lib/tests/snapshot/normalize";
import { EXTRACTOR_VERSION } from "../src/lib/tests/extractor-version";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const name = arg("name");
const corpusRoot = arg("corpus-root") ?? "corpus";
const wantJson = flag("json");
const strict = flag("strict");

if (!name) {
  console.error("Usage: bun run angel --name=<name> [--corpus-root=corpus] [--json] [--strict]");
  process.exit(2);
}

// --- tiny terminal formatting -------------------------------------------------
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (supportsColor ? `${code}${s}${RESET}` : s);

function rule(label = "") {
  const line = "─".repeat(Math.max(0, 64 - label.length - 1));
  console.log(c(DIM, label ? `${label} ${line}` : "─".repeat(64)));
}
function kv(k: string, v: unknown) {
  console.log(`  ${k.padEnd(22)} ${v ?? c(DIM, "∅")}`);
}
interface Meta {
  url?: string;
  frozenAt?: string;
  viewport?: { width: number; height: number };
  promoted?: boolean;
}
interface FreezeReport {
  env?: { frozenAt?: string };
}

function readJsonSafe<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const dir = join(corpusRoot, name!);
  if (!existsSync(dir)) {
    console.error(c(RED, `✗ corpus/${name} not found under ${corpusRoot}/`));
    return 2;
  }
  const meta: Meta = readJsonSafe<Meta>(join(dir, "meta.json")) ?? {};
  const freeze: FreezeReport = readJsonSafe<FreezeReport>(join(dir, "freeze-report.json")) ?? {};

  console.log("");
  console.log(c(BOLD, `Angel report — ${name}`));
  rule();
  kv("url", meta.url);
  kv("frozenAt", meta.frozenAt ?? freeze?.env?.frozenAt);
  kv("viewport", meta.viewport ? `${meta.viewport.width}×${meta.viewport.height}` : null);
  kv("extractor", `v${EXTRACTOR_VERSION}`);
  kv(
    "promoted",
    meta.promoted === true ? c(GREEN, "yes") : c(YELLOW, String(meta.promoted ?? "no")),
  );
  console.log("");

  // --- live replay ----------------------------------------------------------
  console.log(c(DIM, "Replaying frozen DOM through collect + pageAudit (pinned Chromium)…"));
  const started = Date.now();
  const fresh = await replayCorpus(name!, corpusRoot);
  const tookMs = Date.now() - started;

  const normalized = {
    collect: normalizeCollect(fresh.collect),
    pageAudit: normalizePageAudit(fresh.pageAudit),
  };
  const a = normalized.pageAudit;
  const col = normalized.collect;

  console.log(c(DIM, `replay ok in ${(tookMs / 1000).toFixed(1)}s`));
  console.log("");

  // --- page audit (the report) ----------------------------------------------
  rule("PAGE");
  kv("title", a.head?.title);
  kv("lang / canonical", `${a.head?.lang ?? "?"}  ${c(DIM, a.head?.canonical ?? "")}`);
  kv("meta description", a.head?.hasDescription ? c(GREEN, "present") : c(YELLOW, "missing"));
  kv("h1 count", a.headings?.h1Count);
  for (const h of a.headings?.h1 ?? []) kv("h1", c(BOLD, JSON.stringify(h)));
  console.log("");

  rule("HERO");
  kv("headline", c(BOLD, JSON.stringify(a.hero?.headline ?? "")));
  kv("primary CTA", JSON.stringify(a.hero?.primaryCtaText ?? ""));
  kv("CTA intent", a.hero?.primaryCtaIntent);
  kv("above fold", a.hero?.aboveFold ? c(GREEN, "yes") : c(YELLOW, "no"));
  console.log("");

  rule("CTAs");
  kv("total", a.ctaSummary?.total);
  kv("primary", a.ctaSummary?.primary);
  kv("above fold", a.ctaSummary?.aboveFold);
  kv("competing above fold", col.summary?.competingAboveFold);
  kv("primary conversion", col.summary?.primaryConversionCtaCount);
  console.log("");

  rule("CLICKABLES");
  kv("total collected", col.count);
  kv("above fold", col.summary?.aboveFold);
  if (col.summary?.intentBreakdown) {
    console.log(`  ${"by intent".padEnd(22)}`);
    for (const [k, v] of Object.entries(col.summary.intentBreakdown)) {
      console.log(`    ${String(k).padEnd(20)} ${v}`);
    }
  }
  const top = (col.summary?.topVisualWeight ?? []).slice(0, 5);
  if (top.length) {
    console.log(`  ${"top visual weight".padEnd(22)}`);
    for (const t of top)
      console.log(`    ${String(t.score).padStart(4)}  ${JSON.stringify(t.text)}`);
  }
  console.log("");

  rule("TRUST SIGNALS");
  kv("total", a.trustSummary?.total);
  kv("above fold", a.trustSummary?.aboveFold);
  for (const [k, v] of Object.entries(a.trustSummary?.byType ?? {})) {
    console.log(`    ${String(k).padEnd(20)} ${v}`);
  }
  console.log("");

  rule("IMAGES");
  kv("total", a.images?.total);
  kv(
    "missing alt",
    a.images?.missingAlt > 0 ? c(YELLOW, String(a.images.missingAlt)) : c(GREEN, "0"),
  );
  kv("modern / legacy", `${a.images?.modernCount} / ${a.images?.legacyCount}`);
  kv("formats", JSON.stringify(a.images?.formats ?? {}));
  console.log("");

  rule("SECTION ORDER");
  console.log("  " + (a.sectionOrder ?? []).join(" › "));
  console.log("");

  // --- determinism check vs committed golden --------------------------------
  rule("DETERMINISM");
  const goldenPath = join(dir, "golden.json");
  const golden = readJsonSafe(goldenPath);
  let drift = 0;
  if (!golden) {
    console.log(`  ${c(YELLOW, "no golden.json")} — run \`bun run snapshot:update\` to bless one.`);
  } else {
    const diff = diffNormalized(golden, normalized);
    drift = diff.length;
    if (drift === 0) {
      console.log(
        `  ${c(GREEN, "✓ GREEN")} — live replay is byte-identical to golden (extractor v${EXTRACTOR_VERSION}).`,
      );
    } else {
      console.log(`  ${c(RED, `✗ DRIFT`)} — ${drift} field(s) differ from golden:`);
      for (const line of diff.slice(0, 40)) console.log(`    ${line}`);
      if (diff.length > 40) console.log(`    ${c(DIM, `… and ${diff.length - 40} more`)}`);
    }
  }
  console.log("");

  if (wantJson) {
    rule("NORMALIZED JSON");
    console.log(JSON.stringify(normalized, null, 2));
    console.log("");
  }

  return strict && drift > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("");
    console.error(
      c(RED, `✗ Angel report failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    if (err instanceof Error && err.stack)
      console.error(c(DIM, err.stack.split("\n").slice(1, 4).join("\n")));
    process.exit(1);
  });
