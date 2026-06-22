#!/usr/bin/env bun
// "Angel report" — run the audit engine live against frozen corpus page(s).
// =====================================================================
// Replays a frozen capture through the exact same path the snapshot harness and
// the live engine use (COLLECT_SCRIPT + pageAudit in pinned Playwright
// Chromium), normalizes the result, prints a human-readable CRO/conversion
// audit, and diffs the fresh run against any committed golden.json so
// score-determinism drift is visible in a single command.
//
// "Live" = recomputed from the frozen DOM right now, not a cat of golden.json.
// The frozen MHTML is the input; the audit findings are the output.
//
// Single site:
//   bun run angel --name=hubspot
//   bun run angel --name=hubspot --json        # also dump full normalized JSON
//   bun run angel --name=hubspot --strict      # exit 1 on golden drift
//   bun run angel --name=stripe --corpus-root=fixtures/breadth-corpus
//
// Batch (every capture under a root, recursively — for the breadth corpus):
//   bun run angel --breadth                     # alias for --root=fixtures/breadth-50
//   bun run angel --root=fixtures/breadth-corpus
//   bun run angel --root=fixtures/breadth-50 --out=fixtures/breadth-50/angel-report.json
//   bun run angel --root=... --lenient          # audit even canary-imperfect captures
//   bun run angel --root=... --strict           # exit 1 if any site fails or drifts
//
// A "capture" is any directory containing page.mhtml (or a page.mhtml.asset.json
// CDN pointer). Replay needs local Playwright Chromium (no Browserbase). The
// pinned browser is preferred (keeps the render-canary calibrated); otherwise
// set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an available chrome binary.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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
const batchRoot = flag("breadth") ? "fixtures/breadth-50" : arg("root");
const outPath = arg("out");
const wantJson = flag("json");
const strict = flag("strict");
// --lenient: run replay without the fatal render-canary gate, so a font-
// imperfect breadth capture still yields a CRO audit (the canary guards glyph
// fidelity, not hero/CTA/trust/image structure). Default stays strict.
const lenient = flag("lenient");
// Per-site replay budget (s). A pathological capture (animation/context churn)
// must not stall a batch — it's recorded as a failure and the run continues.
// Matches the snapshot harness's 120s per-site budget.
const timeoutMs = Number(arg("timeout") ?? "120") * 1000;

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
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function readJsonSafe<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

// Soft per-site timeout: the underlying replayCorpus has no AbortSignal, so a
// timed-out replay's browser may linger until process exit — acceptable for a
// short-lived CLI, and it keeps a single hanging capture from stalling a batch.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`replay timeout after ${ms / 1000}s (${label})`)), ms),
    ),
  ]);
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

// One audited site, reduced to the fields the batch table and JSON need.
interface AuditRow {
  name: string;
  ok: boolean;
  error?: string;
  tookMs?: number;
  h1Count?: number;
  hero?: string;
  ctaTotal?: number;
  ctaPrimary?: number;
  ctaAboveFold?: number;
  trustTotal?: number;
  imgTotal?: number;
  imgMissingAlt?: number;
  sections?: number;
  golden: "green" | "drift" | "none";
  driftCount?: number;
}

interface AuditResult {
  row: AuditRow;
  meta: Meta;
  freeze: FreezeReport;
  normalized?: { collect: unknown; pageAudit: unknown };
}

// Replay one capture, normalize, diff vs golden. Never throws — replay failures
// are captured on the row so a batch run surfaces them instead of aborting.
async function audit(siteName: string, root: string): Promise<AuditResult> {
  const dir = join(root, siteName);
  const meta = readJsonSafe<Meta>(join(dir, "meta.json")) ?? {};
  const freeze = readJsonSafe<FreezeReport>(join(dir, "freeze-report.json")) ?? {};
  const row: AuditRow = { name: siteName, ok: false, golden: "none" };

  const started = Date.now();
  try {
    const fresh = await withTimeout(
      replayCorpus(siteName, root, { lenientCanary: lenient }),
      timeoutMs,
      siteName,
    );
    row.tookMs = Date.now() - started;
    const normalized = {
      collect: normalizeCollect(fresh.collect),
      pageAudit: normalizePageAudit(fresh.pageAudit),
    };
    const a = normalized.pageAudit;
    const col = normalized.collect;
    row.ok = true;
    row.h1Count = a.headings?.h1Count;
    row.hero = (a.hero?.headline ?? "").trim();
    row.ctaTotal = a.ctaSummary?.total;
    row.ctaPrimary = a.ctaSummary?.primary;
    row.ctaAboveFold = a.ctaSummary?.aboveFold;
    row.trustTotal = a.trustSummary?.total;
    row.imgTotal = a.images?.total;
    row.imgMissingAlt = a.images?.missingAlt;
    row.sections = (a.sectionOrder ?? []).length;

    const golden = readJsonSafe(join(dir, "golden.json"));
    if (golden) {
      const diff = diffNormalized(golden, normalized);
      row.golden = diff.length === 0 ? "green" : "drift";
      row.driftCount = diff.length;
    }
    return { row, meta, freeze, normalized };
  } catch (err) {
    row.tookMs = Date.now() - started;
    row.error = err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : String(err);
    return { row, meta, freeze };
  }
}

// --- single-site detailed report ---------------------------------------------
function renderDetail(siteName: string, res: AuditResult): void {
  const { meta, freeze, normalized, row } = res;
  console.log("");
  console.log(c(BOLD, `Angel report — ${siteName}`));
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

  if (!row.ok || !normalized) {
    console.log(c(RED, `✗ replay failed: ${row.error}`));
    console.log("");
    return;
  }
  const a = normalized.pageAudit as ReturnType<typeof normalizePageAudit>;
  const col = normalized.collect as ReturnType<typeof normalizeCollect>;
  console.log(c(DIM, `replay ok in ${((row.tookMs ?? 0) / 1000).toFixed(1)}s`));
  console.log("");

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

  rule("DETERMINISM");
  if (row.golden === "none") {
    console.log(`  ${c(YELLOW, "no golden.json")} — run \`bun run snapshot:update\` to bless one.`);
  } else if (row.golden === "green") {
    console.log(
      `  ${c(GREEN, "✓ GREEN")} — live replay is byte-identical to golden (extractor v${EXTRACTOR_VERSION}).`,
    );
  } else {
    const golden = readJsonSafe(join(corpusRoot, siteName, "golden.json"));
    const diff = golden ? diffNormalized(golden, normalized) : [];
    console.log(`  ${c(RED, "✗ DRIFT")} — ${row.driftCount} field(s) differ from golden:`);
    for (const line of diff.slice(0, 40)) console.log(`    ${line}`);
    if (diff.length > 40) console.log(`    ${c(DIM, `… and ${diff.length - 40} more`)}`);
  }
  console.log("");

  if (wantJson) {
    rule("NORMALIZED JSON");
    console.log(JSON.stringify(normalized, null, 2));
    console.log("");
  }
}

// --- batch packaging ---------------------------------------------------------
// A capture dir is one that directly holds page.mhtml or a CDN pointer; we stop
// descending once found so nested category trees (breadth-50/<cat>/<name>) work.
function findCaptures(root: string, rel = ""): string[] {
  const abs = join(root, rel);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const isCapture = entries.some(
    (e) => e.isFile() && (e.name === "page.mhtml" || e.name === "page.mhtml.asset.json"),
  );
  if (isCapture) return [rel];
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) out.push(...findCaptures(root, rel ? join(rel, e.name) : e.name));
  }
  return out.sort();
}

function goldenBadge(g: AuditRow["golden"]): string {
  if (g === "green") return c(GREEN, "GREEN");
  if (g === "drift") return c(RED, "DRIFT");
  return c(DIM, "—");
}

async function runBatch(root: string): Promise<number> {
  if (!existsSync(root)) {
    console.error(c(RED, `✗ root not found: ${root}`));
    return 2;
  }
  const sites = findCaptures(root);
  console.log("");
  console.log(c(BOLD, `Angel breadth report — ${root}`));
  console.log(c(DIM, `extractor v${EXTRACTOR_VERSION} · ${sites.length} capture(s) found`));
  if (sites.length === 0) {
    console.log(
      c(
        YELLOW,
        `  no captures under ${root}/ — freeze first (e.g. bun run scripts/freeze-breadth.ts).`,
      ),
    );
    return 0;
  }
  console.log("");

  const rows: AuditRow[] = [];
  let i = 0;
  for (const site of sites) {
    i++;
    process.stdout.write(c(DIM, `  [${i}/${sites.length}] ${site} … `));
    const { row } = await audit(site, root);
    rows.push(row);
    if (row.ok) {
      console.log(
        `${c(GREEN, "ok")} ${((row.tookMs ?? 0) / 1000).toFixed(1)}s · golden ${goldenBadge(row.golden)}`,
      );
    } else {
      console.log(`${c(RED, "FAIL")} ${row.error}`);
    }
  }

  // table
  console.log("");
  rule("SUMMARY");
  const head = [
    "SITE".padEnd(34),
    "OK".padEnd(5),
    "H1".padStart(3),
    "HERO".padEnd(30),
    "CTA t/p/af".padEnd(12),
    "TRUST".padStart(6),
    "IMG(alt)".padEnd(10),
    "GOLDEN",
  ].join(" ");
  console.log(c(DIM, head));
  for (const r of rows) {
    const okCell = r.ok ? c(GREEN, "✓") : c(RED, "✗");
    const cta = r.ok ? `${r.ctaTotal ?? "?"}/${r.ctaPrimary ?? "?"}/${r.ctaAboveFold ?? "?"}` : "—";
    const img = r.ok ? `${r.imgTotal ?? "?"}(${r.imgMissingAlt ?? "?"})` : "—";
    const hero = r.ok ? truncate(r.hero ?? "", 29) : truncate(r.error ?? "", 29);
    console.log(
      [
        truncate(r.name, 34).padEnd(34),
        okCell.padEnd(supportsColor ? 14 : 5),
        String(r.ok ? (r.h1Count ?? "?") : "—").padStart(3),
        hero.padEnd(30),
        cta.padEnd(12),
        String(r.ok ? (r.trustTotal ?? "?") : "—").padStart(6),
        img.padEnd(10),
        r.ok ? goldenBadge(r.golden) : c(DIM, "—"),
      ].join(" "),
    );
  }

  // aggregate
  const okCount = rows.filter((r) => r.ok).length;
  const failCount = rows.length - okCount;
  const greenCount = rows.filter((r) => r.golden === "green").length;
  const driftCount = rows.filter((r) => r.golden === "drift").length;
  console.log("");
  rule("AGGREGATE");
  kv("captures", rows.length);
  kv(
    "replay ok",
    `${okCount}/${rows.length}` + (failCount ? c(RED, `  (${failCount} failed)`) : ""),
  );
  kv("golden green", greenCount > 0 ? c(GREEN, String(greenCount)) : "0");
  kv("golden drift", driftCount > 0 ? c(RED, String(driftCount)) : "0");
  kv("no golden", rows.filter((r) => r.golden === "none").length);
  console.log("");

  if (outPath) {
    const payload = {
      root,
      extractorVersion: EXTRACTOR_VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        captures: rows.length,
        replayOk: okCount,
        replayFailed: failCount,
        greenCount,
        driftCount,
      },
      sites: rows,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(c(DIM, `  wrote ${outPath}`));
    console.log("");
  }

  return strict && (failCount > 0 || driftCount > 0) ? 1 : 0;
}

async function main(): Promise<number> {
  if (batchRoot) return runBatch(batchRoot);

  if (!name) {
    console.error(
      "Usage:\n" +
        "  bun run angel --name=<name> [--corpus-root=corpus] [--json] [--strict]\n" +
        "  bun run angel --root=<dir> [--out=<file.json>] [--strict]   # batch\n" +
        "  bun run angel --breadth                                     # = --root=fixtures/breadth-50",
    );
    return 2;
  }
  const dir = join(corpusRoot, name);
  if (!existsSync(dir)) {
    console.error(c(RED, `✗ ${name} not found under ${corpusRoot}/`));
    return 2;
  }
  console.log(c(DIM, "Replaying frozen DOM through collect + pageAudit (pinned Chromium)…"));
  const res = await audit(name, corpusRoot);
  renderDetail(name, res);
  return strict && res.row.golden === "drift" ? 1 : res.row.ok ? 0 : 1;
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
