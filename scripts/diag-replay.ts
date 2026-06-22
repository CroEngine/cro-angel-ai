#!/usr/bin/env bun
// Throwaway replay diagnostic: load a frozen capture under the SAME browser
// protections the harness uses (file:// route-abort + nav neutralization) and
// log what the page actually does — navigations, crashes, console errors, and
// how often page.evaluate survives. Reveals WHY waitForStableContext fails.
//
//   bun run scripts/diag-replay.ts fixtures/angel-sample/spa/trello
import { chromium } from "playwright";
import { readFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = process.argv[2];
if (!dir) throw new Error("usage: diag-replay.ts <capture-dir>");
const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
const tmp = mkdtempSync(join(tmpdir(), "diag-"));
const tmpFile = join(tmp, "page.mhtml");
copyFileSync(join(dir, "page.mhtml"), tmpFile);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: meta.viewport,
  deviceScaleFactor: 1,
});
let aborted = 0;
await context.route("**/*", (r) => {
  if (r.request().url().startsWith("file://")) return r.continue();
  aborted++;
  return r.abort();
});
await context.addInitScript(() => {
  try {
    const noop = () => {};
    history.pushState = noop as typeof history.pushState;
    history.replaceState = noop as typeof history.replaceState;
    (window.location as unknown as { assign: () => void }).assign = noop;
    (window.location as unknown as { replace: () => void }).replace = noop;
  } catch {
    /* ignore */
  }
});
const page = await context.newPage();
page.on("framenavigated", (f) => {
  if (f === page.mainFrame()) console.log("NAV →", f.url().slice(0, 80));
});
page.on("crash", () => console.log("‼ PAGE CRASH"));
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).split("\n")[0].slice(0, 100)));

const t0 = Date.now();
await page
  .goto(`file://${tmpFile}`, { waitUntil: "load", timeout: 30_000 })
  .catch((e) => console.log("GOTO ERR", String(e).split("\n")[0].slice(0, 100)));
console.log(`goto done in ${Date.now() - t0}ms`);

let oks = 0;
let fails = 0;
let firstFail = "";
for (let i = 0; i < 48; i++) {
  try {
    const u = (await page.evaluate(() => location.href)) as string;
    oks++;
    if (i % 8 === 0) console.log(`  [t+${i * 250}ms] loc=${u.slice(0, 50)} evalOk`);
  } catch (e) {
    fails++;
    if (!firstFail) firstFail = String(e).split("\n")[0].slice(0, 90);
  }
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`\nRESULT: evaluate oks=${oks} fails=${fails} abortedRequests=${aborted}`);
if (firstFail) console.log(`firstEvalFail: ${firstFail}`);
await browser.close();
