// Section-walker behavior: passing THROUGH display:contents wrappers.
//
// A display:contents element renders no box of its own (width/height 0), so the
// walker's size guards would drop it AND its whole subtree. Real sections sit
// behind one on common React/Next layouts (warby-parker: <main> →
// display:contents div → 25 sections), so the walker must recurse through it.
//
// This MUST run in a real engine: jsdom does no layout, so getComputedStyle
// wouldn't report display:contents and getBoundingClientRect would be all zeros —
// it can't reproduce the bug. Skipped (not failed) where chromium can't launch,
// same as render-canary's behavior layer; runs locally + in CI's Playwright job.

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { SECTIONS_SCRIPT } from "../sections";

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
      `[sections-walker.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});

describe("section walker — display:contents pass-through", () => {
  test("recovers sections nested behind a display:contents wrapper", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    // <main> (tall enough to be wrapper-skipped) → display:contents div → three
    // real content divs, each with its own heading. Mirrors warby-parker's
    // <main> → display:contents → sections shape that collapsed to one section.
    const block = (h: string) =>
      `<div style="height:520px;width:880px"><h2>${h}</h2><p>` +
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6) +
      `</p></div>`;
    await page.setContent(
      `<html><body><main style="display:flex;flex-direction:column">` +
        `<div style="display:contents">` +
        block("Section Alpha") +
        block("Section Beta") +
        block("Section Gamma") +
        `</div></main></body></html>`,
    );

    const sections = (await page.evaluate(SECTIONS_SCRIPT)) as Array<{ heading?: string }>;
    const headings = sections.map((s) => (s.heading || "").trim());

    // All three sections behind the display:contents wrapper must be surfaced.
    // Pre-fix this returned the wrapper-collapsed result (the three were lost).
    expect(headings).toContain("Section Alpha");
    expect(headings).toContain("Section Beta");
    expect(headings).toContain("Section Gamma");
  });

  test("display:contents wrapper itself is not emitted as a section", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    await page.setContent(
      `<html><body><main style="display:flex;flex-direction:column">` +
        `<div style="display:contents" id="ghost-wrapper">` +
        `<div style="height:900px;width:880px"><h2>Real Section</h2></div>` +
        `</div></main></body></html>`,
    );
    const sections = (await page.evaluate(SECTIONS_SCRIPT)) as Array<{
      heading?: string;
      selector?: string;
    }>;
    // The pass-through recurses into children; the zero-box wrapper is never a section.
    expect(sections.some((s) => (s.selector || "").includes("ghost-wrapper"))).toBe(false);
    expect(sections.some((s) => (s.heading || "").trim() === "Real Section")).toBe(true);
  });
});
