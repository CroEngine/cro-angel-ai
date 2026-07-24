#!/usr/bin/env bun
// Capture-eval (kapacitet steg 1, 2026-07-24): mät FÖRTROGENHETEN i vad
// extraktionen fångar, över hela sajtflottan. För varje frusen sajt renderas
// den i 390×844 och två modeller jämförs:
//   RAW      — extractContentModel(document.outerHTML)          (gamla vägen)
//   FAITHFUL — extractContentModel(serializeVisibleHtml(page))  (synligt-bara + dedup)
//
// Nyckeltal:
//   phantomDrop  = raw − faithful  (borttagna fantom-/dubblettsektioner)
//   genericRate  = andel sektioner utan meningsfull typ (section/content)
//   SÄKERHET: faithful får ALDRIG understiga antalet UNIKA SYNLIGA rubriker —
//            gör den det har vi tappat riktigt innehåll (regression, flaggas rött).
//
//   bun run scripts/capture-eval/run.ts [--only=namn1,namn2] [--conc=4]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright-core";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { serializeVisibleHtml } from "../redesign/visible-dom";

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const ONLY = arg("only")?.split(",").filter(Boolean);
const CONC = Math.max(1, Number(arg("conc") ?? 4));
const FLEET = arg("root") ?? "fleet-e2e";
const OUT = "capture-eval";
mkdirSync(OUT, { recursive: true });

interface Row {
  name: string;
  raw: number | null;
  faithful: number | null;
  phantomDrop: number;
  uniqueVisible: number; // ground-truth floor
  overDropped: boolean; // faithful < uniqueVisible ⇒ real content lost (BUG)
  genericRaw: number;
  genericFaithful: number;
  error: string | null;
}

let names = readdirSync(FLEET, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(FLEET, d.name, "frozen.html")))
  .map((d) => d.name);
if (ONLY) names = names.filter((n) => ONLY.includes(n));

const genericRate = (secs: { type: string }[]) =>
  secs.length ? secs.filter((s) => s.type === "section" || s.type === "content").length / secs.length : 0;

const browser = await chromium.launch({ headless: true, executablePath: EXEC });

async function evalSite(name: string): Promise<Row> {
  const base: Row = {
    name,
    raw: null,
    faithful: null,
    phantomDrop: 0,
    uniqueVisible: 0,
    overDropped: false,
    genericRaw: 0,
    genericFaithful: 0,
    error: null,
  };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await ctx.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    await page.setContent(readFileSync(join(FLEET, name, "frozen.html"), "utf8"), {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(400);
    const rawHtml = await page.evaluate(() => document.documentElement.outerHTML);
    const visHtml = await serializeVisibleHtml(page);
    const rawSecs = extractContentModel(rawHtml).sections;
    const faithfulSecs = extractContentModel(visHtml).sections;
    const faithfulKeys = new Set(faithfulSecs.map((s) => s.heading.trim().toLowerCase()));
    // SÄKERHET, rätt gjord: av de sektioner RAW-extraktionen såg, vilka dropp:ades
    // OCH är FAKTISKT renderade (getClientRects>0 — respekterar förfäders
    // display:none, till skillnad från getComputedStyle(el).display)? De är den
    // enda riktiga förlusten. Dolda-via-förälder-rubriker SKA försvinna.
    const dropped = rawSecs.map((s) => s.heading.trim().toLowerCase()).filter((h) => !faithfulKeys.has(h));
    const realLoss = await page.evaluate((headings: string[]) => {
      const main = document.querySelector("main") || document.body;
      const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      let n = 0;
      for (const h of headings) {
        const rendered = Array.from(main.querySelectorAll("h1,h2")).some(
          (e) => norm(e.textContent) === h && e.getClientRects().length > 0,
        );
        if (rendered) n++;
      }
      return n;
    }, dropped);
    base.raw = rawSecs.length;
    base.faithful = faithfulSecs.length;
    base.phantomDrop = rawSecs.length - faithfulSecs.length;
    base.uniqueVisible = realLoss; // reused field: count of truly-rendered sections dropped
    base.overDropped = realLoss > 0; // the regression we must never introduce
    base.genericRaw = Math.round(genericRate(rawSecs) * 100);
    base.genericFaithful = Math.round(genericRate(faithfulSecs) * 100);
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  } finally {
    await ctx.close();
  }
  return base;
}

const rows: Row[] = [];
let idx = 0;
async function worker(): Promise<void> {
  while (idx < names.length) {
    const name = names[idx++];
    rows.push(await evalSite(name));
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
await browser.close();

rows.sort((a, b) => b.phantomDrop - a.phantomDrop);
writeFileSync(join(OUT, "results.json"), JSON.stringify(rows, null, 2));

const ok = rows.filter((r) => r.error === null);
const polluted = ok.filter((r) => r.phantomDrop > 0);
const overDropped = ok.filter((r) => r.overDropped);
const totalPhantom = ok.reduce((s, r) => s + r.phantomDrop, 0);
const avgGenericRaw = Math.round(ok.reduce((s, r) => s + r.genericRaw, 0) / (ok.length || 1));
const avgGenericFaithful = Math.round(ok.reduce((s, r) => s + r.genericFaithful, 0) / (ok.length || 1));

console.log(`\n[capture-eval] ${ok.length} sites (errors: ${rows.length - ok.length})`);
console.log(`phantom/duplicate sections removed: ${totalPhantom} across ${polluted.length} polluted sites`);
console.log(`over-dropped (real visible content lost — MUST be 0): ${overDropped.length}`);
if (overDropped.length) console.log(`  ⚠ ${overDropped.map((r) => r.name).join(", ")}`);
console.log(`generic-section rate: raw ${avgGenericRaw}% → faithful ${avgGenericFaithful}%`);
console.log(`top polluted: ${polluted.slice(0, 12).map((r) => `${r.name}(−${r.phantomDrop})`).join(", ")}`);
