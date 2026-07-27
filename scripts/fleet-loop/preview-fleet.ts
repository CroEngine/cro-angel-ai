#!/usr/bin/env bun
// Preview-fleet (ägarbeslut 2026-07-27: "klistra in typ 100 olika hemsidor
// så ser vi vilket resultat vi fått och hur vi löser det"): kör EXAKT
// preview-trattens kedja (scripts/loop/preview.ts steg 1-4 — freeze →
// extractContentModel → produktions-designern → auto-generate verify med
// hjälte-klamp + bevis-lyftets placerings-stege) över sajtflottan, UTAN
// kö/DB — och samlar per-sajt-diagnostik för fördelningsanalysen.
//
// Feltaxonomi (speglar trattens fail-orsaker + verify-domsluten):
//   freeze_failed / thin_page / designer_empty / crashed
//   verified · verified_fallback · gate_fail · not_applicable · no_serve_ops
//
// Strukturerade resultat → fleet-preview/results.json (skrivs om efter VARJE
// sajt — en krasch tappar aldrig framsteg; omkörning hoppar färdiga sajter).
//
//   bun run scripts/fleet-loop/preview-fleet.ts [--limit=N] [--offset=N]
//     [--only=namn1,namn2] [--conc=3]
//
// Kräver ANTHROPIC_API_KEY (designern). BROWSERBASE_* frivilligt (SPA-frys).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { FLEET_SITES as SITES } from "./fleet-sites";
import { anthropicDesigner } from "../loop/designer";
import { buildCandidatePlan } from "../loop/candidate-plan";
import { generateRedesign, type RedesignOp } from "../../src/adaptive/redesign/generate";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { segmentDims } from "../../src/lib/segment-key";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const ONLY = arg("only")?.split(",").filter(Boolean);
const LIMIT = arg("limit") ? Number(arg("limit")) : undefined;
const OFFSET = arg("offset") ? Number(arg("offset")) : 0;
const CONC = Math.max(1, Number(arg("conc") ?? 3));
const OUT_ROOT = "fleet-preview";
const PER_SITE_TIMEOUT_MS = 300_000;

interface SiteResult {
  name: string;
  url: string;
  status: "ok" | "freeze_failed" | "thin_page" | "designer_empty" | "crashed";
  verdict: string | null;
  fallback: string | null;
  reason: string | null;
  gateReasons: string[];
  attempts: number;
  sections: number | null;
  planOps: string[];
  planSource: string | null;
  ms: number;
  error: string | null;
}

let sites = SITES;
if (ONLY) sites = sites.filter((s) => ONLY.includes(s.name));
sites = sites.slice(OFFSET, LIMIT ? OFFSET + LIMIT : undefined);
mkdirSync(OUT_ROOT, { recursive: true });

const resultsPath = join(OUT_ROOT, "results.json");
const prior: SiteResult[] = existsSync(resultsPath)
  ? (JSON.parse(readFileSync(resultsPath, "utf8")) as SiteResult[])
  : [];
const doneNames = new Set(prior.filter((r) => r.status !== "crashed").map((r) => r.name));
const results: SiteResult[] = [...prior.filter((r) => r.status !== "crashed")];
const queue = sites.filter((s) => !doneNames.has(s.name));
console.log(`[fleet] ${queue.length} sajter i kön (${results.length} redan klara), conc=${CONC}`);

const flush = () => writeFileSync(resultsPath, JSON.stringify(results, null, 2));

function spawnBun(args: string[], timeoutMs: number): boolean {
  const r = spawnSync("bun", ["run", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    timeout: timeoutMs,
  });
  return r.status === 0;
}

async function runSite(site: { name: string; url: string }): Promise<SiteResult> {
  const t0 = Date.now();
  const dir = join(OUT_ROOT, site.name);
  mkdirSync(dir, { recursive: true });
  const res: SiteResult = {
    name: site.name,
    url: site.url,
    status: "ok",
    verdict: null,
    fallback: null,
    reason: null,
    gateReasons: [],
    attempts: 0,
    sections: null,
    planOps: [],
    planSource: null,
    ms: 0,
    error: null,
  };
  try {
    // 1. Frys — samma auto-läge som tratten (Browserbase-fallback för SPA).
    const frozen = join(dir, "frozen-home.html");
    if (
      !existsSync(frozen) &&
      !spawnBun(
        ["scripts/redesign/freeze-page.ts", `--url=${site.url}`, `--out=${frozen}`],
        120_000,
      )
    ) {
      res.status = "freeze_failed";
      return res;
    }

    // 2. Innehållsmodellen — trattens tunn-sida-grind.
    const content = extractContentModel(readFileSync(frozen, "utf8"));
    res.sections = content.sections.length;
    if (content.sections.length < 1) {
      res.status = "thin_page";
      return res;
    }

    // 3. Produktions-designern med trattens EXAKTA syntetiska cell.
    const key = "google·mobile";
    const dims = segmentDims(key);
    const observations = [
      "FÖRHANDSVISNING (prospekt): snippeten är inte installerad — ingen riktig besöksdata finns.",
      "Designa för ett generellt men vanligt scenario: en mobil besökare som landar från Google.",
      "Föreslå EN tydlig, säker förbättring som går att verifiera visuellt på den frysta sidan.",
    ];
    const summary: SegmentSummary = {
      key,
      label: dims.join(" · "),
      depth: dims.length,
      channel: dims[0] ?? null,
      device: dims[1] ?? null,
      country: null,
      returning: null,
      visits: 0,
      conversions: 0,
      conversionRate: 0,
      formStarts: 0,
      formAbandons: 0,
      adequate: true,
      recent: null,
    };
    // KATALOGEN FÖRST (kandidatkatalogen 2026-07-27) — exakt trattens väg:
    // kod genererar dragen, DOM-proben filtrerar, LLM väljer (golvet när
    // den tystnar); fritt-skapande designern är reserv för tomma menyer.
    let planOps: RedesignOp[];
    let altOps: RedesignOp[][] = [];
    const candPlan = await buildCandidatePlan({
      content,
      frozenPath: frozen,
      workDir: dir,
      segmentLabel: dims.join(" · "),
      observations,
    });
    if (candPlan) {
      planOps = candPlan.ops;
      altOps = candPlan.altOps;
      res.planSource = `katalog/${candPlan.source}`;
    } else {
      const ctx = buildRedesignContext({
        site: `preview--${new URL(site.url).hostname}`,
        goal: { text: null, kind: null, selector: null },
        page: {
          url: site.url,
          frozenHtmlPath: frozen,
          screenshotPath: "",
          viewport: { width: 390, height: 844 },
        },
        content,
        segment: segmentInsightFrom(summary, { observations }),
        sourcePages: [],
      });
      const plan = await generateRedesign(ctx, anthropicDesigner);
      if (plan.ops.length === 0) {
        res.status = "designer_empty";
        res.reason = plan.note ?? null;
        return res;
      }
      planOps = plan.ops;
      res.planSource = "designer";
    }
    res.planOps = planOps.map((o) => o.op);

    // 4. Verify — grindkedjan med klamp + reserv-stege + placerings-stege.
    writeFileSync(join(dir, "pages.json"), JSON.stringify({ "/": frozen }));
    writeFileSync(
      join(dir, "site.json"),
      JSON.stringify({ conversion_text: null, conversion_kind: null, conversion_selector: null }),
    );
    writeFileSync(
      join(dir, "plans.json"),
      JSON.stringify([
        {
          path: "/",
          key,
          total: { visits: 0, conversions: 0 },
          observations,
          sourcePaths: [],
          ops: planOps,
          altOps,
        },
      ]),
    );
    const verifyOk = spawnBun(
      [
        "scripts/redesign/auto-generate.ts",
        "--mode=verify",
        `--plans=${join(dir, "plans.json")}`,
        `--pages=${join(dir, "pages.json")}`,
        `--site=preview--${site.name}`,
        `--base-url=${site.url.replace(/\/$/, "")}`,
        `--site-config=${join(dir, "site.json")}`,
        `--out=${dir}`,
      ],
      PER_SITE_TIMEOUT_MS,
    );
    type Entry = {
      verdict?: string;
      reason?: string;
      fallback?: string;
      attempts?: { gate?: { reasons?: string[] } }[];
    };
    const vr = JSON.parse(readFileSync(join(dir, "verify-report.json"), "utf8")) as Entry[];
    const first = vr[0];
    res.verdict = first?.verdict ?? (verifyOk ? "no_result" : "verify_failed");
    res.fallback = first?.fallback ?? null;
    res.reason = first?.reason ?? null;
    res.attempts = first?.attempts?.length ?? 0;
    res.gateReasons = (first?.attempts?.[(first.attempts?.length ?? 1) - 1]?.gate?.reasons ?? []).slice(
      0,
      3,
    );
    return res;
  } catch (e) {
    res.status = "crashed";
    res.error = String(e).slice(0, 300);
    return res;
  } finally {
    res.ms = Date.now() - t0;
  }
}

// Enkel pool — CONC sajter i flykt; results.json skrivs om efter varje.
let cursor = 0;
async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++;
    if (i >= queue.length) return;
    const site = queue[i];
    console.log(`\n[fleet] ── ${site.name} (${site.url}) ── [${i + 1}/${queue.length}]`);
    const r = await runSite(site);
    results.push(r);
    flush();
    console.log(
      `[fleet] ${site.name}: ${r.status}${r.verdict ? ` · ${r.verdict}` : ""}${r.fallback ? ` (${r.fallback})` : ""} · ${Math.round(r.ms / 1000)}s`,
    );
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));

// Sammanfattning — fördelningen är leveransen.
const buckets = new Map<string, number>();
for (const r of results) {
  const k = r.status === "ok" ? (r.fallback ? `${r.verdict} (fallback)` : (r.verdict ?? "?")) : r.status;
  buckets.set(k, (buckets.get(k) ?? 0) + 1);
}
console.log(`\n[fleet] ═══ FÖRDELNING (${results.length} sajter) ═══`);
for (const [k, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
}
const reasons = new Map<string, number>();
for (const r of results) {
  if (r.status === "ok" && r.verdict !== "verified") {
    const key = r.gateReasons[0] ?? r.reason ?? "(okänd orsak)";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
}
if (reasons.size > 0) {
  console.log(`\n[fleet] ═══ TOPP-ORSAKER bland hållna ═══`);
  for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${String(n).padStart(3)}  ${k.slice(0, 110)}`);
  }
}
