#!/usr/bin/env bun
// Fleet-E2E (2026-07-23): kör EXAKT prospekt-pipelinen (paste-URL-trattens
// arbetarväg — granska-site i onboarding-läge) över hela sajtflottan och mät
// VÄRDET: hur många av 100+ riktiga sajter får ett demo-värdigt exempel
// (fynd + grindat före/efter), var faller det, och varför.
//
// Strukturerade resultat per sajt → fleet-e2e/results.json (skrivs om efter
// VARJE sajt så en krasch aldrig tappar framsteg). Feltaxonomi:
//   freeze_failed    — sidan gick inte att frysa (bot-block, SPA utan browser-
//                      väg i den här miljön, nät)
//   crashed          — granska-processen föll (bugg — ska granskas)
//   ok               — rapport producerad; flyttStatus pass/held/refused/null
//
//   bun run scripts/fleet-e2e/run.ts [--only=namn1,namn2] [--limit=N] [--conc=3]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SITES } from "../day0-sites";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const ONLY = arg("only")?.split(",").filter(Boolean);
const LIMIT = arg("limit") ? Number(arg("limit")) : undefined;
const CONC = Math.max(1, Number(arg("conc") ?? 3));
const OUT_ROOT = "fleet-e2e";
const PER_SITE_TIMEOUT_MS = 240_000;

interface SiteResult {
  name: string;
  url: string;
  status: "ok" | "freeze_failed" | "crashed";
  flyttStatus: "pass" | "held" | "refused" | null;
  // Ett pass kan vara giltigt men sakna ett visuellt tydligt före/efter (bildlös
  // frysning / inner-scroll) — då är flyttShown false: giltig flytt, ingen demo.
  flyttShown: boolean;
  fyndCount: number;
  fyndRubriker: string[];
  heldReason: string | null;
  sektioner: number | null;
  ctas: number;
  goalGuess: string | null;
  ms: number;
  error: string | null;
}

let sites = SITES;
if (ONLY) sites = sites.filter((s) => ONLY.includes(s.name));
if (LIMIT) sites = sites.slice(0, LIMIT);
mkdirSync(OUT_ROOT, { recursive: true });

const results: SiteResult[] = [];
const resultsPath = join(OUT_ROOT, "results.json");
// Återupptagbart: redan körda sajter (ok/freeze_failed) hoppas — crashed körs om.
const prior: SiteResult[] = existsSync(resultsPath)
  ? (JSON.parse(readFileSync(resultsPath, "utf8")) as SiteResult[])
  : [];
const doneNames = new Set(prior.filter((r) => r.status !== "crashed").map((r) => r.name));
results.push(...prior.filter((r) => r.status !== "crashed"));

const queue = sites.filter((s) => !doneNames.has(s.name));
console.log(`[fleet-e2e] ${queue.length} sajter i kön (${doneNames.size} redan klara)`);

const persist = () => {
  results.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
};

async function runSite(site: { name: string; url: string }): Promise<SiteResult> {
  const dir = join(OUT_ROOT, site.name);
  const t0 = Date.now();
  const proc = Bun.spawn(
    [
      "bun",
      "run",
      "scripts/audit/granska-site.ts",
      `--url=${site.url}`,
      `--out=${dir}`,
      "--mode=onboarding",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), PER_SITE_TIMEOUT_MS);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  const stderr = await new Response(proc.stderr).text();
  const ms = Date.now() - t0;

  const fyndPath = join(dir, "fynd.json");
  if (exitCode === 0 && existsSync(fyndPath)) {
    try {
      const fynd = JSON.parse(readFileSync(fyndPath, "utf8")) as {
        flyttStatus: SiteResult["flyttStatus"];
        flyttShown?: boolean;
        fynd?: { rubrik: string }[];
        flyttText?: string;
        sektioner?: number;
        ctas?: string[];
        goalGuess?: string | null;
      };
      // held-orsaken bor i rapporttexten — plocka första grindorsaken ur
      // fynd.json när den finns (flyttText innehåller "held it back: <reason>").
      const heldReason =
        fynd.flyttStatus === "held"
          ? ((fynd.flyttText ?? "").match(/held it back: (.+?)\. That is how/)?.[1] ?? null)
          : null;
      return {
        name: site.name,
        url: site.url,
        status: "ok",
        flyttStatus: fynd.flyttStatus ?? null,
        flyttShown: fynd.flyttShown ?? false,
        fyndCount: fynd.fynd?.length ?? 0,
        fyndRubriker: (fynd.fynd ?? []).map((f) => f.rubrik),
        heldReason,
        sektioner: fynd.sektioner ?? null,
        ctas: fynd.ctas?.length ?? 0,
        goalGuess: fynd.goalGuess ?? null,
        ms,
        error: null,
      };
    } catch (e) {
      return {
        name: site.name,
        url: site.url,
        status: "crashed",
        flyttStatus: null,
        flyttShown: false,
        fyndCount: 0,
        fyndRubriker: [],
        heldReason: null,
        sektioner: null,
        ctas: 0,
        goalGuess: null,
        ms,
        error: `fynd.json oläslig: ${e instanceof Error ? e.message : e}`,
      };
    }
  }
  const freezeFail = /frysning misslyckades/.test(stderr);
  return {
    name: site.name,
    url: site.url,
    status: freezeFail ? "freeze_failed" : "crashed",
    flyttStatus: null,
    flyttShown: false,
    fyndCount: 0,
    fyndRubriker: [],
    heldReason: null,
    sektioner: null,
    ctas: 0,
    goalGuess: null,
    ms,
    error:
      stderr.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400) || `exit ${exitCode}`,
  };
}

let idx = 0;
async function worker(id: number): Promise<void> {
  while (idx < queue.length) {
    const site = queue[idx++];
    console.log(`[fleet-e2e w${id}] ${site.name} …`);
    const r = await runSite(site);
    results.push(r);
    persist();
    console.log(
      `[fleet-e2e w${id}] ${site.name}: ${r.status}${r.flyttStatus ? ` · flytt=${r.flyttStatus}` : ""} · ${r.fyndCount} fynd · ${Math.round(r.ms / 1000)}s${r.error ? ` · ${r.error.slice(0, 80)}` : ""}`,
    );
  }
}

await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
persist();

const by = (s: string) => results.filter((r) => r.status === s).length;
const byFlytt = (s: string) => results.filter((r) => r.flyttStatus === s).length;
const shown = results.filter((r) => r.flyttStatus === "pass" && r.flyttShown).length;
console.log(
  `\n[fleet-e2e] klart: ${results.length} sajter · ok=${by("ok")} freeze_failed=${by("freeze_failed")} crashed=${by("crashed")} · flytt: pass=${byFlytt("pass")} (varav ${shown} med demo-bild) held=${byFlytt("held")} refused=${byFlytt("refused")}`,
);
