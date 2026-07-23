// Trust-signal ground-truth benchmark runner.
//
// Replays each capture in labels.json, runs the REAL trust detector
// (runPageAudit), maps emitted signal types to the 10 eval types, and scores
// precision / recall / F1 against the hand-labeled ground truth. Captures that
// aren't on disk (gitignored fixtures) are skipped, so the same harness runs
// the full 18-site set locally and the committed-corpus subset in CI.
//
// CLI:  bun run src/lib/tests/trust-eval/run.ts            (score all available)
//       bun run src/lib/tests/trust-eval/run.ts hubspot linear   (subset)
// Lib:  import { evalAvailable } from "./run";  (used by the CI regression test)

import { chromium, type Browser, type Page } from "playwright";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runPageAudit } from "../runners/pageAudit.server";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const LABELS = JSON.parse(readFileSync(join(HERE, "labels.json"), "utf8")) as {
  types: string[];
  captures: Record<string, string>;
  labels: Record<string, Record<string, number>>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitStable(page: Page, tries = 45, gap = 200, need = 2): Promise<void> {
  let s = 0;
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const u = await page.evaluate(() => location.href);
      s = u === last ? s + 1 : 1;
      last = u;
      if (s >= need) return;
    } catch {
      s = 0;
    }
    await sleep(gap);
  }
}

async function nodeScroll(page: Page, steps = 8, gap = 150): Promise<void> {
  const safe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch {
      await waitStable(page);
      await fn().catch(() => {});
    }
  };
  for (let i = 1; i <= steps; i++) {
    await safe(() =>
      page.evaluate(
        ({ idx, total }) => {
          const h = document.documentElement.scrollHeight;
          window.scrollTo(0, (h / total) * idx);
        },
        { idx: i, total: steps },
      ),
    );
    await sleep(gap);
  }
  await safe(() => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)));
  await sleep(600);
  await safe(() => page.evaluate(() => window.scrollTo(0, 0)));
  await sleep(200);
}

// detector signal type -> eval type
function evalTypesOf(signals: Array<{ type: string }>): Set<string> {
  const got = new Set<string>();
  for (const s of signals) {
    if (s.type === "review_rating" || s.type === "stars_aggregate") got.add("rating");
    else if (LABELS.types.includes(s.type)) got.add(s.type);
  }
  return got;
}

async function detectSite(browser: Browser, capturePath: string): Promise<Set<string>> {
  const tmp = mkdtempSync(join(tmpdir(), "trust-eval-"));
  const tmpFile = join(tmp, "page.mhtml");
  copyFileSync(capturePath, tmpFile);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route("**/*", (r) => (r.request().url().startsWith("file://") ? r.continue() : r.abort()));
  await ctx.addInitScript(() => {
    try {
      const n = () => {};
      history.pushState = n as typeof history.pushState;
      history.replaceState = n as typeof history.replaceState;
      (window.location as unknown as { assign: () => void }).assign = n;
      (window.location as unknown as { replace: () => void }).replace = n;
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`file://${tmpFile}`, { waitUntil: "load", timeout: 30_000 });
    let lu = page.url();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const now = page.url();
      if (now === lu && i > 1) break;
      lu = now;
    }
    await sleep(600);
    await waitStable(page);
    await nodeScroll(page);
    await waitStable(page);
    let audit: { trustSignals: Array<{ type: string }> } | null = null;
    for (let a = 0; a < 3 && !audit; a++) {
      try {
        audit = (await runPageAudit(page as unknown as Parameters<typeof runPageAudit>[0], {
          skipScrollWarmup: true,
          skipCookiePoll: true,
        })) as {
          trustSignals: Array<{ type: string }>;
        };
      } catch (e) {
        await waitStable(page);
        if (a === 2) throw e;
      }
    }
    return evalTypesOf(audit!.trustSignals);
  } finally {
    await ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

export type EvalResult = {
  scored: string[];
  skipped: string[];
  TP: number;
  FP: number;
  FN: number;
  TN: number;
  precision: number;
  recall: number;
  f1: number;
  fps: string[];
  fns: string[];
  perSite: Record<string, string[]>;
};

export async function evalAvailable(opts: { only?: string[]; executablePath?: string } = {}): Promise<EvalResult> {
  const names = (opts.only && opts.only.length ? opts.only : Object.keys(LABELS.labels)).filter(
    (n) => existsSync(join(REPO_ROOT, LABELS.captures[n] || "")),
  );
  const skipped = (opts.only && opts.only.length ? opts.only : Object.keys(LABELS.labels)).filter(
    (n) => !names.includes(n),
  );
  const browser = await chromium.launch({
    headless: true,
    executablePath: opts.executablePath || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const perSite: Record<string, string[]> = {};
  let TP = 0,
    FP = 0,
    FN = 0,
    TN = 0;
  const fps: string[] = [];
  const fns: string[] = [];
  try {
    for (const name of names) {
      let got: Set<string>;
      try {
        got = await detectSite(browser, join(REPO_ROOT, LABELS.captures[name]));
      } catch {
        got = new Set();
      }
      perSite[name] = Array.from(got).sort();
      const lab = LABELS.labels[name];
      for (const t of LABELS.types) {
        const L = lab[t] === 1;
        const G = got.has(t);
        if (L && G) TP++;
        else if (!L && G) {
          FP++;
          fps.push(`${name}/${t}`);
        } else if (L && !G) {
          FN++;
          fns.push(`${name}/${t}`);
        } else TN++;
      }
    }
  } finally {
    await browser.close();
  }
  const precision = TP / (TP + FP || 1);
  const recall = TP / (TP + FN || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  return { scored: names, skipped, TP, FP, FN, TN, precision, recall, f1, fps, fns, perSite };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2);
  evalAvailable({ only }).then((r) => {
    const pct = (x: number) => (x * 100).toFixed(1) + "%";
    console.log(`\n===== TRUST-SIGNAL GROUND-TRUTH BENCHMARK =====`);
    console.log(`scored ${r.scored.length} site(s): ${r.scored.join(", ")}`);
    if (r.skipped.length) console.log(`skipped ${r.skipped.length} (no capture on disk): ${r.skipped.join(", ")}`);
    console.log(`\nPRECISION=${pct(r.precision)}  RECALL=${pct(r.recall)}  F1=${pct(r.f1)}  (TP=${r.TP} FP=${r.FP} FN=${r.FN} TN=${r.TN})`);
    if (r.fps.length) console.log(`\nFALSE POSITIVES:\n  + ${r.fps.join("\n  + ")}`);
    if (r.fns.length) console.log(`\nFALSE NEGATIVES:\n  - ${r.fns.join("\n  - ")}`);
    process.exit(0);
  });
}
