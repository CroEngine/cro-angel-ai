#!/usr/bin/env node
// Fas 1 emission-smoke (observe-first + rage clicks).
//
// Self-contained, NO production traffic: a local static server serves the REAL
// repo snippet (public/adaptive.js) on a minimal page, and every /api call is
// intercepted in-browser. We assert the two Fas-1 contracts at runtime:
//
//   1. OBSERVE-ONLY: decide returns { adaptations: [] } (the observe-mode shape)
//      → the snippet injects NOTHING ([data-angel-injected] stays absent) and
//      still wires the journey (an events POST arrives).
//   2. RAGE CLICKS: 3 rapid clicks on the SAME element emit exactly one
//      rage_click { ref, count>=3 }; a single click never does.
//
//   node scripts/lab/rage-observe-smoke.mjs
//
// Exit 0 = both contracts held; non-zero = a contract broke (prints why).

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const SNIPPET = fs.readFileSync(path.join(REPO, "public/adaptive.js"), "utf8");
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// Minimal page: the snippet tag (consent forced granted so send() runs), one
// interactive button to rage-click, and a second to sanity-check single clicks.
const PAGE = `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Rage/observe smoke</title>
<script src="/adaptive.js" data-site="smoke-observe" data-consent="granted" data-endpoint="/api"></script>
</head><body>
<button id="buy" type="button">Köp nu</button>
<button id="help" type="button">Hjälp</button>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/adaptive.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(SNIPPET);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

const fail = (msg) => {
  console.error(`✗ SMOKE FAILED: ${msg}`);
  process.exitCode = 1;
};

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ executablePath: CHROME });
const collected = []; // every event the snippet POSTs to /api/adaptive/events
try {
  const ctx = await browser.newContext();
  // Force the fetch() path (page.route intercepts it deterministically) instead
  // of sendBeacon, so we capture every batch including the immediate rage POST.
  await ctx.addInitScript(() => {
    // eslint-disable-next-line no-undef
    Object.defineProperty(navigator, "sendBeacon", { value: undefined });
  });
  const page = await ctx.newPage();

  await page.route("**/api/adaptive/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/consent-config")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.includes("/decide")) {
      // Observe-mode response shape: empty adaptations, deterministic id.
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          decisionId: "obs-smoke",
          site: "smoke-observe",
          adaptations: [],
          holdout: false,
          context: {},
        }),
      });
    }
    if (url.includes("/events")) {
      try {
        const batch = JSON.parse(route.request().postData() || "{}");
        for (const e of batch.events || []) collected.push(e);
      } catch {
        /* ignore malformed */
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(base, { waitUntil: "networkidle" });

  // --- contract 1: observe-only injects nothing ---------------------------
  const injected = await page.locator("[data-angel-injected]").count();
  if (injected !== 0) fail(`observe-mode still injected ${injected} element(s)`);

  // A single click must NOT be a rage click.
  await page.locator("#help").click();
  // 3 rapid clicks on the same element = one rage burst.
  for (let i = 0; i < 3; i++) await page.locator("#buy").click({ delay: 0 });

  // Flush: journey batches fire on click; give the routed fetch a beat.
  await page.waitForTimeout(400);

  // --- contract 2: exactly one rage_click on #buy, none on #help ----------
  const rage = collected.filter((e) => e.type === "rage_click");
  const onBuy = rage.filter((e) => (e.payload?.ref || "").includes("buy"));
  const onHelp = rage.filter((e) => (e.payload?.ref || "").includes("help"));

  if (onBuy.length !== 1) fail(`expected 1 rage_click on #buy, got ${onBuy.length}`);
  else if ((onBuy[0].payload?.count ?? 0) < 3)
    fail(`rage_click count too low: ${onBuy[0].payload?.count}`);
  if (onHelp.length !== 0) fail(`single click wrongly flagged as rage (${onHelp.length})`);

  // element_click journey wiring must still be alive in observe mode.
  const clicks = collected.filter((e) => e.type === "element_click");
  if (clicks.length === 0) fail("observe-mode wired no element_click journey events");

  if (!process.exitCode) {
    console.log(
      `✓ observe-only injected nothing; rage_click fired once on #buy ` +
        `(count=${onBuy[0].payload.count}), single click clean; ` +
        `${clicks.length} element_click(s) wired.`,
    );
  }
} finally {
  await browser.close();
  server.close();
}
