// cleanHeadingText word-rotator collapse (CRO-planen steg 2) — and, critically,
// that it does NOT over-collapse on the ubiquitous animation UTILITY classes
// (Tailwind animate-*/rotate-*, Animate.css animate__*/rotateIn), which the
// night-verification flagged as an over-collapse risk when a broad substring
// match was used. Runs the real PAGE_AUDIT_SCRIPT (headings.h1Texts feeds hero
// headline) in real Chromium — jsdom does no layout, so innerText can't be
// reproduced there. Skips where chromium can't launch (same as sections-walker).

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { PAGE_AUDIT_SCRIPT } from "../pageAudit";

let browser: Browser | null = null;
let context: BrowserContext;
let page: Page;
let chromiumAvailable = false;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    page = await context.newPage();
    chromiumAvailable = true;
  } catch (e) {
    console.warn(
      `[heading-rotator.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});

async function h1Text(inner: string): Promise<string> {
  await page.setContent(
    `<!doctype html><html><head><title>t</title></head><body>${inner}</body></html>`,
  );
  const audit = (await page.evaluate(PAGE_AUDIT_SCRIPT)) as {
    headings: { h1Texts: string[] };
  };
  return (audit.headings.h1Texts[0] ?? "").trim();
}

describe("cleanHeadingText — collapse word-rotators, never utility classes", () => {
  test("collapses a <ul>/<li> word-rotator to its first item (hubspot shape)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const t = await h1Text(
      "<h1>Where teams go to " +
        '<span class="wf-heading-animated-wrapper">' +
        '<ul class="wf-heading-animated-list"><li>grow</li><li>scale</li><li>close</li></ul>' +
        "</span></h1>",
    );
    expect(t).toBe("Where teams go to grow");
  });

  test("collapses a class-tagged span rotator (rotating-text)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const t = await h1Text(
      '<h1>Build <span class="rotating-text"><span>faster</span><span>smarter</span></span></h1>',
    );
    expect(t).toBe("Build faster");
  });

  // The over-collapse guard: a heading whose descendant carries a common
  // animation UTILITY class (not a rotator) with >=2 real children must keep ALL
  // its text. A bare [class*="animat"]/[class*="rotat"] substring match failed this.
  test("does NOT collapse an animate-* utility class (Tailwind/Animate.css)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const t = await h1Text(
      '<h1><span class="animate-spin"><span>Ship</span> <span>faster</span></span></h1>',
    );
    expect(t).toBe("Ship faster");
  });

  test("does NOT collapse a rotate-45 utility class (Tailwind transform)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const t = await h1Text(
      '<h1><span class="rotate-45"><span>Grow</span> <span>revenue</span></span></h1>',
    );
    expect(t).toBe("Grow revenue");
  });

  test("does NOT collapse an animate__animated utility (Animate.css)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const t = await h1Text(
      '<h1><span class="animate__animated animate__fadeIn"><span>One</span> <span>platform</span></span></h1>',
    );
    expect(t).toBe("One platform");
  });

  test("plain heading is unchanged", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const t = await h1Text("<h1>Just a normal headline</h1>");
    expect(t).toBe("Just a normal headline");
  });

  // ── Åtstramningen 2026-08-15 (korpusmätt) ────────────────────────────────
  // Två signaler var för breda och trunkerade äkta rubriker. Mätningen
  // (scripts/redesign/rotator-eval.ts, 1162 rubriker på 121 verkliga sidor)
  // visade att logiken rör EN enda rubrik i hela korpusen — hubspots — och att
  // den blir bit-identisk efter åtstramningen. Testerna nedan låser bägge
  // riktningarna: det som ska sluta kollapsa, och det som måste fortsätta.

  test("does NOT collapse a bare <ul> in a heading — a list is not a rotator", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Förut: varje ul/ol med >=2 barn räknades som rotator utan någon
    // rotator-signal, så andra posten (och framåt) försvann ur rubriken.
    const t = await h1Text("<h1>Pick one <ul><li>A plan</li><li>B plan</li></ul></h1>");
    expect(t).toBe("Pick one A plan B plan");
  });

  test("does NOT collapse split-text wrappers (animated-text/-headline/-word)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Per-ord-avslöjande: alla barn tillhör SAMMA rubrik, inget alternerar.
    for (const cls of ["animated-text", "animated-headline", "animated-word"]) {
      const t = await h1Text(
        `<h1>Grow with <span class="${cls}"><span>speed</span> <span>and</span> <span>care</span></span></h1>`,
      );
      expect(t, `klass ${cls}`).toBe("Grow with speed and care");
    }
  });

  test("STILL collapses a list whose token sits on the WRAPPER, not the list", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Granskningsfynd 2026-08-15: omslaget har ETT element-barn (listan), så
    // en ren children>=2-vakt missade rotatorn helt när listregeln togs bort.
    const t = await h1Text(
      '<h1>We help you <span class="text-rotator">' +
        "<ul><li>grow</li><li>scale</li><li>close</li></ul></span></h1>",
    );
    expect(t).toBe("We help you grow");
  });

  test("STILL collapses the hubspot shape — the case the rule exists for", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Listan bär själv token `animated-list`, så klass-scanningen fångar den
    // utan den nakna ul/ol-regeln. Det är hela grunden för att ta bort den.
    const t = await h1Text(
      "<h1>Where go-to-market teams go to " +
        '<ul class="wf-page-header_heading-animated-list">' +
        "<li>grow</li><li>scale</li><li>close</li><li>retain</li><li>grow</li>" +
        "</ul></h1>",
    );
    expect(t).toBe("Where go-to-market teams go to grow");
  });
});
