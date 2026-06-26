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
//   * section-type classifier ≈ P 44% / R 41% (32-site local: 46.7 / 42.0). It
//     labels most sections "content" and rarely emits hero/features/testimonials
//     (notion: 21 sections, 0 typed hero; the separate deriveHero DOES find the
//     hero — measured by the CTA metric below, not here). This is the next
//     detector to harden; the floors sit a few points under measured so a real
//     regression reds the build while the known weakness doesn't.
//   * primary-CTA pick ≈ 77% accuracy where a real primary exists (deriveHero is
//     much stronger than the section typer). The "no false primary" rate on
//     pages with NO single CTA is poor (~17%) — deriveHero surfaces nav/category
//     links as conversion CTAs — so it is REPORTED here but not yet gated.
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

    // Section-type presence floors — under the measured 30-site CI result
    // (~P44/R41) with headroom for replay flap; a broad classifier regression
    // (or a corpus that loses the contentful SaaS sites) reds the build.
    expect(r.precision).toBeGreaterThanOrEqual(0.4);
    expect(r.recall).toBeGreaterThanOrEqual(0.35);
    // Primary-CTA pick accuracy on sites that HAVE a real primary CTA.
    expect(r.ctaAccuracy).toBeGreaterThanOrEqual(0.65);
    // noFalsePrimaryRate is intentionally NOT gated yet (known-weak ~17%); it is
    // logged above so the number is visible and a future fix can be measured.

    // Sequential replay of 30 captures through the full page audit runs
    // ~180-260s and varies with load; 420s gives headroom over a flaky timeout.
  }, 420_000);
});
