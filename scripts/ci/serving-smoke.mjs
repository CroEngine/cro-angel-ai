#!/usr/bin/env node
// Serving-vägens CI-smoke — riktiga snippeten i riktig headless Chromium.
//
// Skyddar det enda som rör kundens sida: appliceringen. Tre invarianter, körda
// mot BÅDE den läsbara källan och den minifierade byggartefakten (in-memory,
// samma esbuild-inställningar som scripts/build/minify-snippet.ts):
//
//   1. BOT-GRINDEN: headless Chromium har navigator.webdriver=true → snippeten
//      vägrar boota; harness-flaggan (och bara den) öppnar test-sömmen.
//   2. FULL APPLICERING (utan LCP-observer = tidig boot): variantens ops landar
//      exakt — sektionen lyfts precis ett steg per op, rubriken byts till det
//      verifierade värdet, markörer sätts, omkörning är idempotent och reset()
//      återställer sidan BYTE-exakt.
//   3. ALLT-ELLER-INGET: en op vars lokator inte finns på sidan ⇒ HELA
//      varianten rullas tillbaka — DOM:en är byte-identisk med baslinjen.
//
// Fixtur: den frysta plausible.io-sidan (offline, nätverk avstängt).
//
//   node scripts/ci/serving-smoke.mjs
//   (Chromium: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH-övertramp eller playwrights
//    egen installation — samma mönster som snapshot-testerna.)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";

const source = readFileSync("public/adaptive.js", "utf8");
const minified = (await transform(source, { minify: true, target: "es2017", legalComments: "none" })).code;

let html = readFileSync("fixtures/real-sites/plausible-io.html", "utf8");
html = html.replace(/<script[\s\S]*?<\/script>/gi, "");

const VARIANT = {
  id: "smoke",
  segmentKey: "facebook·mobile·US",
  ops: [
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    {
      op: "set_text",
      locator: { tag: "h1", text: "Easy to use and privacy-friendly" },
      value: "Privacy-friendly Google Analytics alternative — trusted by thousands of companies.",
    },
  ],
};
const BROKEN_VARIANT = {
  id: "smoke-broken",
  segmentKey: "x",
  ops: [
    { op: "move_up", locator: { tag: "h2", text: "People ❤️ Plausible" } },
    { op: "set_text", locator: { tag: "h1", text: "THIS HEADING DOES NOT EXIST" }, value: "x" },
  ],
};

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, executablePath });

async function boot(page, snippet, { harness }) {
  await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ src, harness }) => {
      window.PerformanceObserver = undefined; // deterministisk "tidig boot"
      if (harness) window.__ANGEL_HARNESS__ = true;
      const m = document.createElement("script");
      m.type = "text/plain";
      m.setAttribute("data-site", "smoke");
      m.setAttribute("data-endpoint", "https://dead.invalid");
      m.setAttribute("src", "data:text/plain,adaptive.js");
      document.head.appendChild(m);
      (0, eval)(src);
    },
    { src: snippet, harness },
  );
}

const state = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main") || document.body;
    const h = [...document.querySelectorAll("h2")].find((x) => (x.textContent || "").includes("People ❤️ Plausible"));
    let sec = h;
    while (sec && sec.parentElement && sec.parentElement !== main && sec.parentElement !== document.body)
      sec = sec.parentElement;
    return {
      h1: (document.querySelector("main h1") || document.querySelector("h1")).textContent.replace(/\s+/g, " ").trim(),
      peopleIdx: [...main.children].indexOf(sec),
      moved: document.querySelectorAll("[data-angel-moved]").length,
      retext: document.querySelectorAll("[data-angel-retext]").length,
      mainHtml: main.innerHTML,
    };
  });

async function runSuite(label, snippet) {
  const failures = [];
  const check = (name, ok) => {
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
    if (!ok) failures.push(name);
  };

  // 1) Bot-grinden.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: false });
    const blocked = await page.evaluate(
      () => navigator.webdriver === true && typeof window.__angel === "undefined",
    );
    check("bot-grind: webdriver blockerar boot", blocked);
    await page.close();
  }

  // 2) Full applicering + idempotens + byte-exakt reset.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: true });
    const booted = await page.evaluate(() => typeof window.__angel === "object");
    check("harness-flaggan öppnar test-sömmen", booted);
    const before = await state(page);
    const applied = await page.evaluate((v) => window.__angel.apply({ adaptations: [], variant: v }), VARIANT);
    const after = await state(page);
    check("variant rapporterad applicerad", applied.includes("variant:smoke"));
    check("sektionen lyft EXAKT två steg", before.peopleIdx - after.peopleIdx === 2);
    check("rubriken bytt till verifierat värde", after.h1.startsWith("Privacy-friendly Google Analytics"));
    check("markörer satta (moved+retext)", after.moved === 1 && after.retext === 1);
    const applied2 = await page.evaluate((v) => window.__angel.apply({ adaptations: [], variant: v }), VARIANT);
    const afterRe = await state(page);
    check(
      "omkörning idempotent (hydrerings-skydd)",
      applied2.includes("variant:smoke") && afterRe.peopleIdx === after.peopleIdx && afterRe.moved === 1,
    );
    await page.evaluate(() => window.__angel.reset());
    const restored = await state(page);
    check("reset återställer BYTE-exakt", restored.mainHtml === before.mainHtml);
    check("noll residue efter reset", (await page.evaluate(() => window.__angel.residue())) === 0);
    await page.close();
  }

  // 3) Allt-eller-inget.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await boot(page, snippet, { harness: true });
    const before = await state(page);
    const applied = await page.evaluate((v) => window.__angel.apply({ adaptations: [], variant: v }), BROKEN_VARIANT);
    const after = await state(page);
    check("trasig lokator ⇒ varianten rapporteras EJ applicerad", !applied.includes("variant:smoke-broken"));
    check("trasig lokator ⇒ DOM byte-identisk med baslinjen", after.mainHtml === before.mainHtml);
    await page.close();
  }

  return failures;
}

console.log("── serving-smoke: KÄLLAN (public/adaptive.js) ──");
const f1 = await runSuite("source", source);
console.log("── serving-smoke: MINIFIERAD (byggartefakten) ──");
const f2 = await runSuite("minified", minified);
await browser.close();

const failures = [...f1.map((f) => `källa: ${f}`), ...f2.map((f) => `minifierad: ${f}`)];
if (failures.length) {
  console.error(`\nSERVING SMOKE FAIL (${failures.length}):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nSERVING SMOKE OK (källa + minifierad)");
