// Flytt-markören (uppslukande sandboxen 2026-08-30): harness-applikatorn
// stämplar den flyttade sektionen med data-angel-moved — SPEGELVÄNT mot
// runtime-applikatorn — så page-after.html bär en pekare spotlighten kan
// hitta. Testet låser båda halvorna: keepApplied ⇒ markören står kvar i
// kopian; reset-vägen ⇒ markören är borta (ingen residue i före-mätningar).
// Riktig Chromium, samma fixtur-mönster som measure-reason.test.ts.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";

import { measurePlan } from "../measure";

let browser: Browser | null = null;
beforeAll(async () => {
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    });
  } catch {
    browser = null;
  }
});

// OBS: första sektionen bär AVSIKTLIG runtime-residue (data-angel-moved
// från en live-snippet som körde när sidan frystes) — measurePlan ska
// strippa den innan något stämplas, annars pekar spotlighten fel.
const REN = `<!doctype html><html><head><meta charset="utf-8"><style>
section{padding:24px;min-height:200px}</style></head><body><main>
<section data-angel-moved=""><h1>Kom igång i dag</h1><p>${"Hjältetext. ".repeat(20)}</p></section>
<section><h2>Vad kunderna säger</h2><p>${"Omdöme. ".repeat(30)}</p></section>
<section><h2>Enkla priser</h2><p>${"Pris. ".repeat(30)}</p></section>
</main></body></html>`;

async function withPage<T>(fn: (page: import("playwright-core").Page) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "moved-marker-"));
  const file = join(dir, "page.html");
  writeFileSync(file, REN);
  const ctx = await browser!.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`, { waitUntil: "load" });
  try {
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

const MOVE = [{ op: "move_up" as const, tag: "h2", find: "Enkla priser" }];

describe("data-angel-moved — harness-markören för spotlighten", () => {
  it("keepApplied ⇒ den flyttade sektionen bär markören (kopians kontrakt)", async (ctx) => {
    if (!browser) return ctx.skip();
    await withPage(async (page) => {
      const r = await measurePlan(page, MOVE, [], true);
      expect(r.resolvedAll).toBe(true);
      // EXAKT en markör — fixturens förstämplade residue är strippad, bara
      // denna mätnings flytt bär data-angel-moved.
      const markers = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-angel-moved]")).map(
          (el) => el.querySelector("h1,h2")?.textContent ?? "",
        ),
      );
      expect(markers).toHaveLength(1);
      expect(markers[0]).toContain("Enkla priser");
      // Tom sträng exakt som runtime-applikatorn (SPEGELVÄND, håll i synk).
      const attr = await page.evaluate(() =>
        document.querySelector("[data-angel-moved]")?.getAttribute("data-angel-moved"),
      );
      expect(attr).toBe("");
    });
  }, 120_000);

  it("reset-vägen ⇒ ingen markör-residue kvar", async (ctx) => {
    if (!browser) return ctx.skip();
    await withPage(async (page) => {
      const r = await measurePlan(page, MOVE, [], false);
      expect(r.resolvedAll).toBe(true);
      const residue = await page.evaluate(
        () => document.querySelectorAll("[data-angel-moved]").length,
      );
      expect(residue).toBe(0);
    });
  }, 120_000);
});
