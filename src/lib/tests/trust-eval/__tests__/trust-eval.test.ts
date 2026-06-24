// Trust-signal benchmark as a CI regression gate.
//
// Replays the committed-corpus captures (hubspot/linear/hibob) through the real
// trust detector and scores precision/recall vs the hand-labeled ground truth
// (labels.json). The 45 trust-signals.test.ts cases lock SPECIFIC behaviours;
// this is the HOLISTIC backstop — if the detector degrades broadly on real
// pages, P/R fall through the floor here. The full 18-site set scores locally
// when the gitignored fixtures are present (run.ts skips captures not on disk).
//
// Floors are deliberately loose (the unit tests catch fine regressions) so a
// single flaky replay can't red the build; they still trip on a real break
// (e.g. logo or testimonial detection disappearing across all three sites).
//
// Real engine required: skipped where chromium can't launch (same as the other
// behaviour-layer suites); runs in CI's Playwright job.

import { describe, it, expect, beforeAll } from "vitest";
import { chromium, type Browser } from "playwright";

import { evalAvailable } from "../run";

let chromiumAvailable = false;

beforeAll(async () => {
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    const b: Browser = await chromium.launch({ headless: true, executablePath });
    await b.close();
    chromiumAvailable = true;
  } catch (e) {
    console.warn(
      `[trust-eval.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
}, 60_000);

describe("trust-eval — ground-truth regression gate (committed corpus)", () => {
  it("precision and recall hold above the floor on available captures", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    const r = await evalAvailable();
    if (r.scored.length === 0) return ctx.skip(); // no captures on disk
    // eslint-disable-next-line no-console
    console.log(
      `[trust-eval] scored ${r.scored.length} (${r.scored.join(", ")})  ` +
        `P=${(r.precision * 100).toFixed(1)}% R=${(r.recall * 100).toFixed(1)}% ` +
        `TP=${r.TP} FP=${r.FP} FN=${r.FN}` +
        (r.fps.length ? `  FP:[${r.fps.join(", ")}]` : "") +
        (r.fns.length ? `  FN:[${r.fns.join(", ")}]` : ""),
    );
    expect(r.precision).toBeGreaterThanOrEqual(0.8);
    expect(r.recall).toBeGreaterThanOrEqual(0.65);
  }, 180_000);
});
