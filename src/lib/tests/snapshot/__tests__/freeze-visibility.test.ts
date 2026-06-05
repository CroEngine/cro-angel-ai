// Smoke-test för freeze-receiptets synlighetslogik.
//
// Testet asserterar ÖVERENSKOMMELSEN mellan:
//   - POST_DISMISS_HITS_FN (i freeze.server.ts) — det receiptet kör
//   - COLLECTOR_RULES_FN (inlinead spegling nedan av collect.ts::isVisible)
//
// Om de divergerar är collectorn sanningen — fixa freeze.server.ts först,
// uppdatera spegelregeln nedan sen. Receiptets prediktiva kraft mot golden
// bygger på att de håller med varandra.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { POST_DISMISS_HITS_FN } from "../freeze.server";

// Spegling av src/lib/tests/scripts/collect.ts::isVisible (rad 22-28) +
// walk-rekursion (rad 31-40). Inlinead här så testet kan köras utan att
// importera den 400+ raders COLLECT_SCRIPT-strängen. Om collectorn refactorar
// isVisible måste denna spegel uppdateras — testet blir rött vid drift.
const COLLECTOR_RULES_FN = `(needles) => {
  const hits = Object.fromEntries(needles.map(n => [n, 0]));
  const seen = new Set();
  function isVisible(el, cs, rect) {
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity || '1') === 0) return false;
    if (rect.width < 1 || rect.height < 1) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }
  function walk(root) {
    const nodes = root.querySelectorAll('*');
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.shadowRoot) walk(el.shadowRoot);
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (!isVisible(el, cs, rect)) continue;
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += ' ' + (child.nodeValue || '');
      }
      if (!text.trim()) continue;
      const hay = text.toLowerCase();
      for (const n of needles) if (hay.includes(n)) hits[n] += 1;
    }
  }
  walk(document);
  return hits;
}`;

let browser: Browser | null = null;
let context: BrowserContext;
let page: Page;
let chromiumAvailable = false;

beforeAll(async () => {
  // Sandbox/CI saknar ofta Playwrights Chromium-sysdeps (libglib m.fl.).
  // Probea och skip:a hela suiten istället för att fejla — testet är
  // avsett att köras på utvecklarmaskin där Playwright är installerat,
  // exakt som harness.server.ts redan körs i replay-flödet.
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext();
    page = await context.newPage();
    chromiumAvailable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[freeze-visibility.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `Detta är förväntat i sandbox utan Playwright-sysdeps. Lokal körning OK. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});


async function runBoth(html: string, needles: string[]) {
  await page.setContent(html);
  const args = JSON.stringify(needles);
  const fromFreeze = (await page.evaluate(
    `(${POST_DISMISS_HITS_FN})(${args})`,
  )) as Record<string, number>;
  const fromCollector = (await page.evaluate(
    `(${COLLECTOR_RULES_FN})(${args})`,
  )) as Record<string, number>;
  return { fromFreeze, fromCollector };
}

describe("freeze visibility — agreement with collector", () => {
  const cases: Array<{ name: string; html: string; needles: string[] }> = [
    {
      name: "synlig text räknas",
      html: `<div>Accept All</div>`,
      needles: ["accept all"],
    },
    {
      name: "display:none räknas inte",
      html: `<div style="display:none">Accept All</div>`,
      needles: ["accept all"],
    },
    {
      name: "visibility:hidden räknas inte",
      html: `<div style="visibility:hidden">Accept All</div>`,
      needles: ["accept all"],
    },
    {
      name: "opacity:0 räknas inte",
      html: `<div style="opacity:0">Accept All</div>`,
      needles: ["accept all"],
    },
    {
      name: "noll bbox räknas inte",
      html: `<div style="width:0;height:0;overflow:hidden">Accept All</div>`,
      needles: ["accept all"],
    },
    {
      // Den här fixturen fångar exakt buggen som planen v2 åtgärdade:
      // utan aria-hidden-checken i freeze hade receiptet sagt 1 medan
      // collectorn säger 0 → falskt positivt i receiptet.
      name: "aria-hidden räknas inte",
      html: `<div aria-hidden="true">Accept All</div>`,
      needles: ["accept all"],
    },
    {
      name: "footer 'cookie policy'-länk matchar bara 'cookie', inte 'accept all'",
      html: `<footer><a href="/cookies">Cookie Policy</a></footer>`,
      needles: ["accept all", "cookie"],
    },
    {
      name: "multi-hit räknar korrekt",
      html: `<div>Accept All</div><span>Accept All</span>`,
      needles: ["accept all"],
    },
    {
      // Vi traverserar inte iframes idag. Detta test LÅSER det beteendet
      // (båda sidor missar lika) — inte en spekulativ fix.
      name: "iframe-innehåll missas av båda (känd begränsning)",
      html: `<iframe srcdoc="<div>Accept All</div>" style="width:200px;height:100px"></iframe>`,
      needles: ["accept all"],
    },
  ];

  for (const c of cases) {
    test(`agreement: ${c.name}`, async (ctx) => {
      if (!chromiumAvailable) ctx.skip();
      const { fromFreeze, fromCollector } = await runBoth(c.html, c.needles);
      expect(fromFreeze).toEqual(fromCollector);
    });
  }

  test("agreement: shadow DOM (imperativt skapad) — båda traverserar", async (ctx) => {
    if (!chromiumAvailable) ctx.skip();
    await page.setContent(`<body></body>`);
    await page.evaluate(() => {
      const host = document.createElement("div");
      document.body.append(host);
      host.attachShadow({ mode: "open" }).innerHTML = "<span>Accept All</span>";
    });
    const args = JSON.stringify(["accept all"]);
    const fromFreeze = (await page.evaluate(
      `(${POST_DISMISS_HITS_FN})(${args})`,
    )) as Record<string, number>;
    const fromCollector = (await page.evaluate(
      `(${COLLECTOR_RULES_FN})(${args})`,
    )) as Record<string, number>;
    expect(fromFreeze).toEqual(fromCollector);
    // Sanity: båda hittade faktiskt något, inte bara två 0:or som råkar matcha.
    expect(fromFreeze["accept all"]).toBe(1);
  });
});

describe("freeze visibility — needle-kontrakt", () => {
  test("needles måste vara lowercase — mixed-case needle missar", async (ctx) => {
    if (!chromiumAvailable) ctx.skip();
    await page.setContent(`<div>Accept All</div>`);
    const r = (await page.evaluate(
      `(${POST_DISMISS_HITS_FN})(${JSON.stringify(["Accept All"])})`,
    )) as Record<string, number>;
    expect(r["Accept All"]).toBe(0); // kontraktet: haystack lc:as, needles görs inte
  });
});

describe("freeze.server.ts module hygien", () => {
  test("läser inte BROWSERBASE_API_KEY på modulnivå", async () => {
    const saved = process.env.BROWSERBASE_API_KEY;
    delete process.env.BROWSERBASE_API_KEY;
    try {
      // Cache-bust så testet inte är trivialt om en annan test redan importerat.
      await import(`../freeze.server?bust=${Date.now()}`);
    } finally {
      if (saved !== undefined) process.env.BROWSERBASE_API_KEY = saved;
    }
  });
});
