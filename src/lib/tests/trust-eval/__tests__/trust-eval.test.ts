// Trust-signal benchmark as a CI regression gate.
//
// Replays every labeled capture present on disk through the real trust detector
// and scores precision/recall vs the hand-labeled ground truth (labels.json).
// In CI that is 30 sites — the committed corpus (hubspot/linear/hibob) plus the
// tracked drift-survey fixtures; only the two angel-sample captures
// (everlane/figma) are gitignored, so a local run scores all 32. The
// trust-signals.test.ts cases lock SPECIFIC behaviours; this is the HOLISTIC
// backstop — if the detector degrades broadly on real pages, P/R fall through
// the floor here.
//
// Floors are calibrated to the measured result with headroom for CI font-render
// flap, NOT pinned to the wire: at v1.14.0 the 30-site CI score is P=97.8% /
// R=83.3% (32-site local 98.0 / 84.2). The floors below sit ~6 pts under, so a
// single flaky signal can't red the build, but a broad regression does — the
// pre-v1.14.0 precision (90.0%, from the spiegel/ikea false positives this gate
// is meant to catch) is below the 0.92 floor, and losing a whole detection class
// drops recall through 0.77. Re-tighten these when P/R climb, or the gate goes
// slack again.
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
    expect(r.precision).toBeGreaterThanOrEqual(0.92);
    expect(r.recall).toBeGreaterThanOrEqual(0.77);
    // Sequential replay of all 30 CI captures runs ~150-200s and varies with
    // machine load; the old 180s budget straddled that and timed out flakily
    // (a spurious red, not a real regression). 360s gives ~2x headroom.
  }, 360_000);
});
