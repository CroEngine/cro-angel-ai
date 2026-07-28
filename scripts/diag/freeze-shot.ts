#!/usr/bin/env bun
// Freeze-test-slingans skärmdumpare (ägarfynd 2026-07-28: "frysningen är
// riktigt dålig" — bevisa browser-frysningens kvalitet med riktiga bilder):
// ladda en FRYST kopia i Chromium MED nätverk tillåtet (till skillnad från
// grindmätningens route-abort) så absolutlänkade bilder/typsnitt får ladda,
// och skjut (1) viewport-toppen och (2) helsida capped 4000px. Körs på
// Actions-runnern där utgående nät är fritt.
//
//   bun run scripts/diag/freeze-shot.ts --frozen=<html> --out=<dir>

import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FROZEN = arg("frozen");
const OUT = arg("out") ?? "freeze-shot-out";
if (!FROZEN) {
  console.error("usage: --frozen=<frozen.html> [--out=dir]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.setContent(readFileSync(FROZEN, "utf8"), { waitUntil: "domcontentloaded", timeout: 30_000 });
// Låt absolutlänkade assets ladda — det här är visnings-sanningen (växlaren
// serverar med https-assets tillåtna), inte grindmätningens offline-läge.
await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(1_500);
await page.screenshot({ path: join(OUT, "viewport.jpg"), type: "jpeg", quality: 70 });
const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
await page.screenshot({
  path: join(OUT, "fullpage.jpg"),
  type: "jpeg",
  quality: 55,
  clip: { x: 0, y: 0, width: 390, height: Math.min(4000, fullH) },
  fullPage: true,
});
console.log(`[freeze-shot] ${OUT}/viewport.jpg + fullpage.jpg (sidhöjd ${fullH}px)`);
await browser.close();
