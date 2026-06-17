#!/usr/bin/env bun
/**
 * Grind 0 — Thin breadth-enumeration / drift survey.
 *
 * Kör freezeSite mot varje site i corpus/breadth-targets.json en gång,
 * concurrent=4. Skriver INTE pass/fail. Outputs en katalog av
 * drift-källor som matas in i Grind 1:s whitelist.
 *
 * MEDVETET MAGER: vi gör inte den dubbla freezen + diff:en här (det är
 * Grind 1:s jobb på 1 representativt fall). Grind 0 mäter bara att
 * vi kan fånga sajterna alls + räknar förekomster av kända drift-signaturer.
 *
 *   bun run scripts/drift-survey.ts                 # alla kategorier utom deferred
 *   bun run scripts/drift-survey.ts --include-deferred
 *   bun run scripts/drift-survey.ts --category=saas-landing
 *   bun run scripts/drift-survey.ts --concurrent=2  # default 4
 *   bun run scripts/drift-survey.ts --dry-run       # plotta planen, kör inte
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";

interface Site {
  name: string;
  url: string;
}
interface Category {
  description: string;
  deferred: boolean;
  sites: Site[];
}
interface Targets {
  version: number;
  categories: Record<string, Category>;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const targetsPath = join("corpus", "breadth-targets.json");
const targets = JSON.parse(readFileSync(targetsPath, "utf8")) as Targets;

const includeDeferred = flag("include-deferred");
const onlyCategory = arg("category");
const concurrent = Number(arg("concurrent") ?? "4");
const dryRun = flag("dry-run");

const outDir = join("fixtures", "drift-survey");
mkdirSync(outDir, { recursive: true });

interface SiteOutcome {
  category: string;
  name: string;
  url: string;
  ok: boolean;
  failureClass: string | null;
  captureValidityReason: string | null;
  mhtmlKb: number;
  textLen: number | null;
  reportPath: string;
  error: string | null;
}

async function runOne(category: string, site: Site): Promise<SiteOutcome> {
  const siteOutDir = join(outDir, category, site.name);
  if (!existsSync(siteOutDir)) mkdirSync(siteOutDir, { recursive: true });
  try {
    const result = await freezeSite({
      url: site.url,
      name: `${category}__${site.name}`,
      outDir: siteOutDir,
      notes: `drift-survey ${new Date().toISOString()}`,
      dryRun: false, // vi vill ha receipt på disk
    });
    // Re-läs receipt för failureClass + captureValidity (freezeSite returnerar inte dem direkt).
    const report = JSON.parse(readFileSync(result.reportPath, "utf8"));
    return {
      category,
      name: site.name,
      url: site.url,
      ok: result.ok && report.captureValidity?.ok === true,
      failureClass: report.failureClass ?? null,
      captureValidityReason: report.captureValidity?.reason ?? null,
      mhtmlKb: report.capture?.mhtmlKb ?? 0,
      textLen: report.captureValidity?.textLen ?? null,
      reportPath: result.reportPath,
      error: report.error ?? null,
    };
  } catch (e) {
    return {
      category,
      name: site.name,
      url: site.url,
      ok: false,
      failureClass: "unknown",
      captureValidityReason: null,
      mhtmlKb: 0,
      textLen: null,
      reportPath: join(siteOutDir, "freeze-report.json"),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runQueue(jobs: { category: string; site: Site }[]): Promise<SiteOutcome[]> {
  const results: SiteOutcome[] = [];
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const idx = i++;
      const job = jobs[idx];
      // eslint-disable-next-line no-console
      console.log(`[drift-survey] (${idx + 1}/${jobs.length}) ${job.category}/${job.site.name}`);
      results.push(await runOne(job.category, job.site));
    }
  }
  await Promise.all(Array.from({ length: concurrent }, worker));
  return results;
}

const jobs: { category: string; site: Site }[] = [];
for (const [catName, cat] of Object.entries(targets.categories)) {
  if (onlyCategory && catName !== onlyCategory) continue;
  if (cat.deferred && !includeDeferred) continue;
  for (const site of cat.sites) jobs.push({ category: catName, site });
}

// eslint-disable-next-line no-console
console.log(`[drift-survey] ${jobs.length} sajter (concurrent=${concurrent}, dryRun=${dryRun})`);

if (dryRun) {
  for (const j of jobs) console.log(`  ${j.category}/${j.site.name}  ${j.site.url}`);
  process.exit(0);
}

const startedAt = Date.now();
const outcomes = await runQueue(jobs);
const elapsedMs = Date.now() - startedAt;

const total = outcomes.length;
const ok = outcomes.filter((o) => o.ok).length;
const byFailure = outcomes
  .filter((o) => !o.ok)
  .reduce<Record<string, number>>((acc, o) => {
    const k = o.failureClass ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

const summary = {
  ranAt: new Date().toISOString(),
  elapsedMs,
  jobsTotal: total,
  ok,
  baselineSuccessRate: total > 0 ? +(ok / total).toFixed(3) : 0,
  byFailureClass: byFailure,
  outcomes,
};

const summaryJsonPath = join(outDir, "outcomes.json");
writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2));
// eslint-disable-next-line no-console
console.log(`[drift-survey] outcomes -> ${summaryJsonPath}`);
// eslint-disable-next-line no-console
console.log(
  `[drift-survey] ${ok}/${total} ok (${(summary.baselineSuccessRate * 100).toFixed(1)}%). ` +
    `failures: ${JSON.stringify(byFailure)}`,
);
// eslint-disable-next-line no-console
console.log(`[drift-survey] Nästa steg: granska MHTML:erna manuellt och fyll ut ${join(outDir, "SUMMARY.md")} med drift-källor per kategori.`);
