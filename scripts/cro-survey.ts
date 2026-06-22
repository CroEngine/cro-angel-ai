#!/usr/bin/env bun
/**
 * CRO survey — replay every captured breadth site through the extractor +
 * deterministic CRO scorer, recording pageType + score. Ground-truths the
 * page-type classifier and the rubric at corpus scale (the technique that
 * caught the techcrunch "editorial $ → ecommerce" trap, run over all 45).
 *
 *   bun run scripts/cro-survey.ts [--concurrent=3] [--timeout=75]
 *
 * Writes (incrementally, so a slow/hung site never loses prior results):
 *   fixtures/breadth-50/CRO-SURVEY.jsonl   one result object per line
 *   fixtures/breadth-50/CRO-SURVEY.json    summary (distributions + anomalies)
 *
 * skipCanary: this is a SCORING survey, not a font-fidelity gate. Non-promoted
 * captures may fail the render-canary; we log and score anyway.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import { normalizeCollect, normalizePageAudit } from "../src/lib/tests/snapshot/normalize";
import { scoreCro } from "../src/lib/tests/croScore";

function arg(name: string, def: string): string {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length) ?? def;
}
const concurrent = Number(arg("concurrent", "3"));
const perSiteTimeoutMs = Number(arg("timeout", "75")) * 1000;

interface Site { name: string; url: string }
interface Cat { deferred: boolean; sites: Site[] }
const targets = JSON.parse(readFileSync(join("corpus", "breadth-targets.json"), "utf8")) as {
  categories: Record<string, Cat>;
};

const jobs: { category: string; deferred: boolean; name: string; url: string }[] = [];
for (const [category, cat] of Object.entries(targets.categories)) {
  for (const s of cat.sites) {
    if (existsSync(join("fixtures", "breadth-50", category, s.name, "page.mhtml"))) {
      jobs.push({ category, deferred: cat.deferred, name: s.name, url: s.url });
    }
  }
}

const JSONL = join("fixtures", "breadth-50", "CRO-SURVEY.jsonl");
writeFileSync(JSONL, "");

interface Result {
  category: string;
  deferred: boolean;
  name: string;
  ok: boolean;
  pageType?: string;
  overall?: number;
  grade?: string;
  dims?: Record<string, number>;
  signals?: string[];
  elements?: number;
  error?: string;
  ms: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout>${ms / 1000}s`)), ms)),
  ]);
}

async function runOne(j: (typeof jobs)[number]): Promise<Result> {
  const t0 = Date.now();
  try {
    const fresh = await withTimeout(
      replayCorpus(j.name, join("fixtures", "breadth-50", j.category), {
        skipCanary: true, // score-only: don't run the font canary (slow on huge DOMs)
        contextTries: 60, // ~9s for heavy SPAs to settle vs the 3s default
      }),
      perSiteTimeoutMs,
    );
    const collect = normalizeCollect(fresh.collect);
    const pageAudit = normalizePageAudit(fresh.pageAudit);
    const cro = scoreCro({ collect, pageAudit });
    return {
      category: j.category,
      deferred: j.deferred,
      name: j.name,
      ok: true,
      pageType: cro.pageType,
      overall: cro.overall,
      grade: cro.grade,
      dims: Object.fromEntries(cro.dimensions.map((d) => [d.id, d.score])),
      signals: cro.pageTypeSignals,
      elements: collect.elements.length,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      category: j.category,
      deferred: j.deferred,
      name: j.name,
      ok: false,
      error: e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : String(e),
      ms: Date.now() - t0,
    };
  }
}

const results: Result[] = [];
let cursor = 0;
async function worker(id: number) {
  while (cursor < jobs.length) {
    const j = jobs[cursor++];
    // eslint-disable-next-line no-console
    console.log(`[survey w${id}] ${j.category}/${j.name} …`);
    const r = await runOne(j);
    results.push(r);
    appendFileSync(JSONL, JSON.stringify(r) + "\n");
    // eslint-disable-next-line no-console
    console.log(
      `[survey w${id}] ${j.category}/${j.name} → ${r.ok ? `${r.pageType} ${r.overall} ${r.grade}` : "FAIL: " + r.error} (${(r.ms / 1000) | 0}s)`,
    );
  }
}
console.log(`[survey] ${jobs.length} sites, concurrent=${concurrent}, per-site timeout=${perSiteTimeoutMs / 1000}s`);
await Promise.all(Array.from({ length: concurrent }, (_, i) => worker(i + 1)));

// --- summary ---
const ok = results.filter((r) => r.ok);
const byType: Record<string, number> = {};
const byGrade: Record<string, number> = {};
for (const r of ok) {
  byType[r.pageType!] = (byType[r.pageType!] ?? 0) + 1;
  byGrade[r.grade!] = (byGrade[r.grade!] ?? 0) + 1;
}
// expected page-type per corpus category (for misclassification flagging)
const EXPECTED: Record<string, string> = {
  "saas-landing": "saas-landing",
  ecommerce: "ecommerce",
  media: "content-media",
};
const misclassified = ok.filter(
  (r) => EXPECTED[r.category] && r.pageType !== EXPECTED[r.category],
);
const summary = {
  ranAt: new Date().toISOString(),
  total: results.length,
  scored: ok.length,
  failed: results.filter((r) => !r.ok).length,
  byPageType: byType,
  byGrade: byGrade,
  avgOverall: ok.length ? Math.round(ok.reduce((s, r) => s + r.overall!, 0) / ok.length) : 0,
  misclassifiedVsCategory: misclassified.map((r) => ({
    site: `${r.category}/${r.name}`,
    classified: r.pageType,
    expected: EXPECTED[r.category],
    signals: r.signals,
  })),
  failures: results.filter((r) => !r.ok).map((r) => ({ site: `${r.category}/${r.name}`, error: r.error })),
  results: results.sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name)),
};
writeFileSync(join("fixtures", "breadth-50", "CRO-SURVEY.json"), JSON.stringify(summary, null, 2));
console.log(`\n[survey] scored ${ok.length}/${results.length}`);
console.log(`[survey] byPageType: ${JSON.stringify(byType)}`);
console.log(`[survey] byGrade: ${JSON.stringify(byGrade)} avg=${summary.avgOverall}`);
console.log(`[survey] misclassified vs category: ${misclassified.length}`);
console.log(`[survey] -> fixtures/breadth-50/CRO-SURVEY.json`);
