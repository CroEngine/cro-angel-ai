// CTA classifier: customer-logo / image-only links are not CTAs.
//
// A button-ish <a> with no visible text of its own but an <img>/<svg> child gets
// its label from alt/aria and was scoring cta_primary — a "trusted by" logo strip
// then polluted CTA counts and won the hero CTA (notion: "OpenAI" over "Get Notion
// free"). The classifier now drops those to plain links. A link/button WITH visible
// text (even if it also has an icon) stays a CTA.
//
// Real engine required: jsdom does no layout, so getBoundingClientRect/visibility
// can't reproduce the scoring. Skipped where chromium can't launch (same as the
// render-canary / walker behavior layers); runs in CI's Playwright job.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { CTAS_SCRIPT } from "../ctas";

let browser: Browser | null = null;
let context: BrowserContext;
let page: Page;
let chromiumAvailable = false;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext({
      viewport: { width: 1000, height: 800 },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    chromiumAvailable = true;
  } catch (e) {
    console.warn(
      `[ctas-logo.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});

describe("CTA classifier — logo / image-only links are not CTAs", () => {
  test("drops a 'trusted by' logo strip but keeps the real text CTA", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    // A hero with a real CTA + a logo strip of image-only links (label via alt),
    // each given a surface so it WOULD have scored cta_primary pre-fix.
    const logo = (brand: string) =>
      `<a href="/x" style="display:inline-block;background:#eee;padding:10px;margin:4px">` +
      `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="${brand}" style="width:120px;height:40px"></a>`;
    await page.setContent(
      `<html><body><section style="padding:24px">` +
        `<h1>Meet the night shift.</h1>` +
        `<a href="/signup" style="display:inline-block;background:#06f;color:#fff;padding:14px 24px">Get Notion free</a>` +
        `<div style="margin-top:20px">Trusted by ` +
        logo("OpenAI") +
        logo("Figma") +
        logo("Ramp") +
        logo("Cursor") +
        logo("Vercel") +
        `</div></section></body></html>`,
    );

    const ctas = (await page.evaluate(CTAS_SCRIPT)) as Array<{ text?: string; category?: string }>;
    const texts = ctas.map((c) => (c.text || "").trim());

    // The real CTA survives…
    expect(texts).toContain("Get Notion free");
    // …and none of the logos are CTAs (they were each scoring cta_primary before).
    for (const brand of ["OpenAI", "Figma", "Ramp", "Cursor", "Vercel"]) {
      expect(texts).not.toContain(brand);
    }
    // No CTA at all should be a brand logo.
    expect(
      ctas.some(
        (c) => c.category === "cta_primary" && /OpenAI|Figma|Ramp|Cursor|Vercel/.test(c.text || ""),
      ),
    ).toBe(false);
  });

  test("keeps a button that has an icon AND visible text", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Icon + text → visible text of its own → still a CTA (not dropped as image-only).
    await page.setContent(
      `<html><body><section style="padding:24px"><h1>Hi</h1>` +
        `<a href="/go" style="display:inline-block;background:#06f;color:#fff;padding:14px 24px">` +
        `<svg width="16" height="16"></svg> Start free trial</a></section></body></html>`,
    );
    const ctas = (await page.evaluate(CTAS_SCRIPT)) as Array<{ text?: string }>;
    expect(ctas.some((c) => /Start free trial/.test(c.text || ""))).toBe(true);
  });
});

describe("CTA classifier — primary scoring (small + outline buttons)", () => {
  test("a small filled above-fold button is primary (≈72×32, under the old 90×28 floor)", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // linear's "Sign up" (≈78×30 = 2334px²) used to score 3 → secondary, so its
    // hero CTA was empty. A button-sized, surfaced, short-text, above-fold control
    // must reach cta_primary.
    await page.setContent(
      `<html><body><section style="padding:24px"><h1>Hi</h1>` +
        `<a href="/signup" style="display:inline-block;background:#06f;color:#fff;width:72px;height:32px;line-height:32px;text-align:center">Sign up</a>` +
        `</section></body></html>`,
    );
    const ctas = (await page.evaluate(CTAS_SCRIPT)) as Array<{ text?: string; category?: string }>;
    const su = ctas.find((c) => (c.text || "").trim() === "Sign up");
    expect(su?.category).toBe("cta_primary");
  });

  test("an outline/ghost button (border, no fill) is a surfaced CTA, not dropped", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // hasSurface previously only saw backgroundColor, so a transparent-bg outline
    // button scored no surface point → fell through to a plain link (dropped).
    await page.setContent(
      `<html><body><section style="padding:24px"><h1>Hi</h1>` +
        `<a href="/contact" style="display:inline-block;border:1px solid #06f;color:#06f;padding:14px 24px;background:transparent">Contact sales</a>` +
        `</section></body></html>`,
    );
    const ctas = (await page.evaluate(CTAS_SCRIPT)) as Array<{ text?: string; category?: string }>;
    const cs = ctas.find((c) => (c.text || "").trim() === "Contact sales");
    expect(cs).toBeTruthy();
    expect(["cta_primary", "cta_secondary"]).toContain(cs?.category);
  });
});
