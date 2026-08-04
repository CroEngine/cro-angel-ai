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
});
