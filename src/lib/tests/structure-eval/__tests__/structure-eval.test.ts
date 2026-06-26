// Page-structure benchmark as a CI regression gate.
//
// Replays every labeled capture present on disk through the real section + CTA
// detectors and scores section-type presence (P/R) + primary-CTA pick accuracy
// vs the hand-labeled ground truth (labels.json). In CI that is 30 sites — the
// committed corpus plus the tracked drift-survey fixtures; the two angel-sample
// captures (everlane/figma) are gitignored, so a local run scores all 32.
//
// Unlike the trust-eval gate (which guards a STRONG detector — 98/84 — against
// regression), this gate locks in a WEAK baseline so it can only get better:
//
//   * section-type classifier ≈ P 65% / R 48% (32-site local: 64.9 / 48.0, up
//     from the first-run 46.7 / 42.0 via the v1.16 precision gate + v1.17
//     structural testimonials). testimonials is now P100/R73; the weak spots left
//     are features (keyword-gated, R 8%) and the geometry `hero` (the separate
//     deriveHero finds the real hero — measured by the CTA metric, not here). The
//     floors sit a few points under measured so a real regression reds the build.
//   * primary-CTA pick ≈ 86% accuracy where a real primary exists (deriveHero is
//     much stronger than the section typer; v1.15.0 lifted it from 78.6% by
//     rejecting weak-link/chrome/nav hero CTAs). The "no false primary" rate on
//     pages with NO single CTA is still poor (~17%) — they surface a real but
//     non-dominant conversion button — so it is REPORTED here but not yet gated.
//
// Re-tighten the floors as the section classifier improves. Real engine
// required: skipped where chromium can't launch; runs in CI's Playwright job.

import { describe, it, expect, beforeAll } from "vitest";
import { chromium, type Browser } from "playwright";

import { evalStructure } from "../run";

let chromiumAvailable = false;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    const b: Browser = await chromium.launch({ headless: true, executablePath });
    await b.close();
    chromiumAvailable = true;
  } catch (e) {
    console.warn(
      `[structure-eval.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
}, 60_000);

describe("structure-eval — page-structure ground-truth regression gate", () => {
  it("section presence + primary-CTA accuracy hold above the floor", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const r = await evalStructure();
    if (r.scored.length === 0) return ctx.skip(); // no captures on disk

    console.log(
      `[structure-eval] scored ${r.scored.length}  ` +
        `SECTIONS P=${(r.precision * 100).toFixed(1)}% R=${(r.recall * 100).toFixed(1)}% ` +
        `(TP=${r.TP} FP=${r.FP} FN=${r.FN})  ` +
        `CTA acc=${(r.ctaAccuracy * 100).toFixed(1)}% (${r.ctaCorrect}/${r.ctaScored})  ` +
        `no-false-primary=${(r.noFalsePrimaryRate * 100).toFixed(1)}% (${r.nullClean}/${r.nullScored})`,
    );
    console.log(
      `[structure-eval] per-type ` +
        Object.entries(r.perType)
          .map(([t, c]) => `${t}(tp${c.tp}/fp${c.fp}/fn${c.fn})`)
          .join(" "),
    );

    // Section-type presence floors — under the measured ~P65/R48 (v1.17) with
    // headroom for the figma/everlane local-vs-CI split and replay flap; a broad
    // classifier regression (or losing the contentful SaaS sites) reds the build.
    expect(r.precision).toBeGreaterThanOrEqual(0.55);
    expect(r.recall).toBeGreaterThanOrEqual(0.42);
    // Primary-CTA pick accuracy on sites that HAVE a real primary CTA. Floor at
    // 0.70 — under the measured ~86% (v1.15.0) so the deriveHero gain is locked
    // in and can't silently regress, with headroom for the figma/everlane
    // local-vs-CI split and a fuzzy vercel-style labeling miss.
    expect(r.ctaAccuracy).toBeGreaterThanOrEqual(0.7);
    // noFalsePrimaryRate is intentionally NOT gated yet (known-weak ~17%); it is
    // logged above so the number is visible and a future fix can be measured.

    // Sequential replay of 30 captures through the full page audit runs
    // ~180-260s and varies with load; 420s gives headroom over a flaky timeout.
  }, 420_000);
});
