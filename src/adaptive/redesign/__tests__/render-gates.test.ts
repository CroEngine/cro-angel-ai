import { describe, it, expect } from "vitest";

import { evaluateRenderGates, type RenderMeasurements } from "../render-gates";

// A clean, safe apply: testimonials lifted above features, still below hero, no
// overflow, CTAs intact, fully reversible.
const clean = (over: Partial<RenderMeasurements> = {}): RenderMeasurements => ({
  beforeOrder: ["hero", "features", "testimonials", "comparison", "pricing"],
  afterOrder: ["hero", "testimonials", "features", "comparison", "pricing"],
  hOverflowBeforePx: 0,
  hOverflowAfterPx: 0,
  movedCount: 1,
  movedAboveMain: 0,
  mainAnchorFound: true,
  ctaChecked: 2,
  ctaBroken: 0,
  requestedMoves: 1,
  appliedMoves: 1,
  reversedOrderMatches: true,
  ...over,
});

describe("evaluateRenderGates — pixel-half beauty gates", () => {
  it("passes a clean, reversible reorder with no overflow and intact CTAs", () => {
    const r = evaluateRenderGates(clean());
    expect(r.verdict).toBe("pass");
    expect(r.reasons).toEqual([]);
    expect(r.hOverflowIntroducedPx).toBe(0);
    expect(r.reordered).toBe(true);
  });

  it("FAILS when a moved section crosses above the main content (hero demoted)", () => {
    const r = evaluateRenderGates(clean({ movedAboveMain: 1 }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toMatch(/above the page's main content/i);
  });

  it("FAILS when apply introduces horizontal overflow beyond the threshold", () => {
    const r = evaluateRenderGates(clean({ hOverflowBeforePx: 0, hOverflowAfterPx: 40 }));
    expect(r.verdict).toBe("fail");
    expect(r.hOverflowIntroducedPx).toBe(40);
    expect(r.reasons.some((x) => /horizontal overflow/i.test(x))).toBe(true);
  });

  it("does NOT count the page's own pre-existing overflow as introduced", () => {
    const r = evaluateRenderGates(clean({ hOverflowBeforePx: 30, hOverflowAfterPx: 30 }));
    expect(r.hOverflowIntroducedPx).toBe(0);
    expect(r.verdict).toBe("pass");
  });

  it("FAILS when a conversion CTA becomes unclickable", () => {
    const r = evaluateRenderGates(clean({ ctaChecked: 2, ctaBroken: 1 }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons.some((x) => /unclickable/i.test(x))).toBe(true);
  });

  it("FAILS when the order does not reverse (not reversible)", () => {
    const r = evaluateRenderGates(clean({ reversedOrderMatches: false }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons.some((x) => /reversible/i.test(x))).toBe(true);
  });

  it("WARNS (not fail) when some moves were not safely applicable", () => {
    const r = evaluateRenderGates(
      clean({ requestedMoves: 2, appliedMoves: 1, afterOrder: clean().afterOrder }),
    );
    expect(r.verdict).toBe("warn");
    expect(r.reasons.some((x) => /could not be applied safely/i.test(x))).toBe(true);
  });

  it("WARNS when sections moved but no main anchor was found to judge against", () => {
    const r = evaluateRenderGates(clean({ mainAnchorFound: false }));
    expect(r.verdict).toBe("warn");
    expect(r.reasons.some((x) => /no h1\/main anchor/i.test(x))).toBe(true);
  });

  it("WARNS when nothing could be applied", () => {
    const r = evaluateRenderGates(
      clean({
        requestedMoves: 1,
        appliedMoves: 0,
        movedCount: 0,
        afterOrder: clean().beforeOrder,
      }),
    );
    expect(r.verdict).toBe("warn");
    expect(r.reasons.some((x) => /no moves were applied/i.test(x))).toBe(true);
  });

  it("stacks the most severe verdict when several gates trip", () => {
    const r = evaluateRenderGates(
      clean({ movedAboveMain: 1, hOverflowAfterPx: 50, ctaBroken: 1, requestedMoves: 2, appliedMoves: 1 }),
    );
    expect(r.verdict).toBe("fail");
    // fail reasons come before the soft warn about unapplied moves
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
