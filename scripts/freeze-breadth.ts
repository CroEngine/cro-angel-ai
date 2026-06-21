#!/usr/bin/env bun
/**
 * Grind 2 — Skala-mätning över 50 sajter.
 *
 * Skriver till fixtures/breadth-50/<category>/<name>/. Producerar
 * fixtures/breadth-50/SUMMARY.json med addressableSuccessRate +
 * byFailureClass + per-kategori-rate.
 *
 * Detta är en MÄTNING, inte en pass/fail-grind. Exit-koden återspeglar
 * beslutsregeln dokumenterad i .lovable/plan.md (>=95% grön, 80-95% amber,
 * <80% röd) men ingen CI-job ska låsa på den utan explicit beslut.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";

interface Site {
  name: string;
  url: string;
  consentSelector?: string;
  consentFrame?: string;
  consentDismissCheck?: "detached" | "hidden";
}
interface Category { description: string; deferred: boolean; sites: Site[] }
interface Targets { version: number; categories: Record<string, Category> }

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const targets = JSON.parse(readFileSync(join("corpus", "breadth-targets.json"), "utf8")) as Targets;
// Default 2, not 4: CDP captureSnapshot (-32000 "Failed to generate MHTML")
// chokes on large media pages under capture concurrency. spiegel/techcrunch/dn
// fail at 4 but pass at ≤2. Reliability over wall-clock for the breadth gate;
// override with --concurrent= for a faster, flakier pass.
const concurrent = Number(arg("concurrent") ?? "2");
const onlyCategory = arg("category");
const onlySites = arg("site")?.split(",").map((s) => s.trim()).filter(Boolean);
const includeDeferred = flag("include-deferred");

const outRoot = join("fixtures", "breadth-50");
mkdirSync(outRoot, { recursive: true });

interface Outcome {
  category: string;
  deferred: boolean;
  name: string;
  url: string;
  ok: boolean;
  failureClass: string | null;
  reason: string | null;
  mhtmlKb: number;
  reportPath: string;
}

async function runOne(category: string, deferred: boolean, site: Site): Promise<Outcome> {
  const dir = join(outRoot, category, site.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    const r = await freezeSite({
      url: site.url,
      name: `${category}__${site.name}`,
      consentSelector: site.consentSelector,
      consentFrame: site.consentFrame,
      consentDismissCheck: site.consentDismissCheck,
      skipExternalize: true,
      outDir: dir,
      notes: `breadth-50 ${new Date().toISOString()}`,
    });
    const report = JSON.parse(readFileSync(r.reportPath, "utf8"));
    return {
      category,
      deferred,
      name: site.name,
      url: site.url,
      ok: r.ok && report.captureValidity?.ok === true,
      failureClass: report.failureClass ?? null,
      reason: report.captureValidity?.reason ?? report.error ?? null,
      mhtmlKb: report.capture?.mhtmlKb ?? 0,
      reportPath: r.reportPath,
    };
  } catch (e) {
    const reportPath = join(dir, "freeze-report.json");
    let failureClass: string | null = "unknown";
    let reason: string | null = e instanceof Error ? e.message : String(e);
    if (existsSync(reportPath)) {
      try {
        const r = JSON.parse(readFileSync(reportPath, "utf8"));
        failureClass = r.failureClass ?? "unknown";
        reason = r.captureValidity?.reason ?? r.error ?? reason;
      } catch { /* */ }
    }
    return {
      category, deferred, name: site.name, url: site.url,
      ok: false, failureClass, reason, mhtmlKb: 0, reportPath,
    };
  }
}

const jobs: { category: string; deferred: boolean; site: Site }[] = [];
for (const [catName, cat] of Object.entries(targets.categories)) {
  if (onlyCategory && catName !== onlyCategory) continue;
  if (cat.deferred && !includeDeferred) continue;
  for (const site of cat.sites) {
    if (onlySites && !onlySites.includes(site.name)) continue;
    jobs.push({ category: catName, deferred: cat.deferred, site });
  }
}

console.log(`[breadth-50] ${jobs.length} sajter (concurrent=${concurrent})`);

const results: Outcome[] = [];
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const idx = cursor++;
    const j = jobs[idx];
    console.log(`[breadth-50] (${idx + 1}/${jobs.length}) ${j.category}/${j.site.name}`);
    results.push(await runOne(j.category, j.deferred, j.site));
  }
}
await Promise.all(Array.from({ length: concurrent }, worker));

const addressable = results.filter((r) => !r.deferred);
const addressableOk = addressable.filter((r) => r.ok).length;
const addressableSuccessRate = addressable.length > 0 ? addressableOk / addressable.length : 0;

const byFailureClass: Record<string, number> = {};
for (const r of results.filter((r) => !r.ok)) {
  const k = r.failureClass ?? "unknown";
  byFailureClass[k] = (byFailureClass[k] ?? 0) + 1;
}

const byCategory: Record<string, { total: number; ok: number; rate: number; deferred: boolean }> = {};
for (const r of results) {
  byCategory[r.category] ??= { total: 0, ok: 0, rate: 0, deferred: r.deferred };
  byCategory[r.category].total += 1;
  if (r.ok) byCategory[r.category].ok += 1;
}
for (const c of Object.values(byCategory)) c.rate = c.total > 0 ? +(c.ok / c.total).toFixed(3) : 0;

// Unknown-gating: per planens "unknown är förbjudet i grön rapport".
const unknownCount = byFailureClass["unknown"] ?? 0;

const summary = {
  ranAt: new Date().toISOString(),
  total: results.length,
  addressableTotal: addressable.length,
  addressableOk,
  addressableSuccessRate: +addressableSuccessRate.toFixed(3),
  byFailureClass,
  byCategory,
  unknownCount,
  verdict:
    unknownCount > 0
      ? "RED: 'unknown' failureClass present — utöka classifyFailure i freeze.server.ts"
      : addressableSuccessRate >= 0.95
        ? "GREEN: redo för nästa lager"
        : addressableSuccessRate >= 0.8
          ? "AMBER: härda specifika failure-klasser, kör om"
          : "RED: arkitektur räcker inte för bredd, omdesign krävs",
  outcomes: results,
};

const summaryPath = join(outRoot, "SUMMARY.json");
writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`[breadth-50] -> ${summaryPath}`);
console.log(`[breadth-50] addressable ${addressableOk}/${addressable.length} = ${(addressableSuccessRate * 100).toFixed(1)}%`);
console.log(`[breadth-50] verdict: ${summary.verdict}`);
if (unknownCount > 0) process.exit(2);
