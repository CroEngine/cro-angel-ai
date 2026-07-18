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

  it("FAILS when the reorder introduces a vertical collision beyond the threshold", () => {
    // The plausible.io mobile case: a section moved under the hero collides with
    // the floating CTA card (+320px) — passes every other gate but this one.
    const r = evaluateRenderGates(clean({ verticalOverlapIntroducedPx: 320 }));
    expect(r.verdict).toBe("fail");
    expect(r.verticalOverlapIntroducedPx).toBe(320);
    expect(r.reasons.some((x) => /vertical overlap|collides/i.test(x))).toBe(true);
  });

  it("does NOT fail on a small introduced overlap (sections legitimately tuck)", () => {
    const r = evaluateRenderGates(clean({ verticalOverlapIntroducedPx: 48 }));
    expect(r.verdict).toBe("pass");
    expect(r.verticalOverlapIntroducedPx).toBe(48);
  });

  it("treats a missing vertical-overlap measurement as 0 (older observations)", () => {
    const m = clean();
    delete (m as { verticalOverlapIntroducedPx?: number }).verticalOverlapIntroducedPx;
    const r = evaluateRenderGates(m);
    expect(r.verdict).toBe("pass");
    expect(r.verticalOverlapIntroducedPx).toBe(0);
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

  it("WARNS when the CTA hit-test was vacuous (0 CTAs checkable before apply)", () => {
    // Breadth finding 2: ctaChecked=0 used to read as a silent pass ("0 broken")
    // even though the gate protected nothing. The vacuity must be visible.
    const r = evaluateRenderGates(clean({ ctaChecked: 0, ctaBroken: 0 }));
    expect(r.verdict).toBe("warn");
    expect(r.reasons.some((x) => /vacuous/i.test(x))).toBe(true);
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

  it("FAILS when an op targets the page's LCP element (unservable live)", () => {
    // Task #105: the snippet's serve-time CWV guard rolls the whole variant
    // back for every real visitor when any op touches the LCP element — the
    // lab's hero-retext variants are living examples. Verification must say
    // no BEFORE such a variant reaches 'verified'.
    const r = evaluateRenderGates(clean({ lcpFound: true, opsTouchingLcp: 1 }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons.some((x) => /LCP element.*unservable/i.test(x))).toBe(true);
  });

  it("passes when the LCP element was found and no op touches it", () => {
    const r = evaluateRenderGates(clean({ lcpFound: true, opsTouchingLcp: 0 }));
    expect(r.verdict).toBe("pass");
  });

  it("WARNS when no LCP element could be observed (servability check vacuous)", () => {
    const r = evaluateRenderGates(clean({ lcpFound: false, opsTouchingLcp: 0 }));
    expect(r.verdict).toBe("warn");
    expect(r.reasons.some((x) => /LCP.*vacuous/i.test(x))).toBe(true);
  });

  it("leaves older observations without the LCP fields unaffected", () => {
    const m = clean();
    expect("lcpFound" in m).toBe(false);
    const r = evaluateRenderGates(m);
    expect(r.verdict).toBe("pass");
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

describe("evaluateRenderGates — insert_snippet-grindarna (task #117)", () => {
  it("passes a clean insert below the hero (visible, reversible, LCP unmoved)", () => {
    const r = evaluateRenderGates(
      clean({
        requestedInserts: 1,
        appliedInserts: 1,
        insertedAboveMain: 0,
        insertedGapToHeroPx: 320,
        insertedVisible: true,
        insertedRemoved: true,
        lcpShiftPx: 0,
      }),
    );
    expect(r.verdict).toBe("pass");
  });

  it("FAILS when apply SHIFTS the LCP element beyond the threshold", () => {
    const r = evaluateRenderGates(clean({ lcpShiftPx: 120 }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons.join(" ")).toMatch(/shifted the page's LCP element by 120px/);
  });

  it("tolerates sub-threshold LCP jitter and absent fields (older observations)", () => {
    expect(evaluateRenderGates(clean({ lcpShiftPx: 4 })).verdict).toBe("pass");
    expect(evaluateRenderGates(clean()).verdict).toBe("pass");
  });

  it("FAILS an insert above the hero, a covered insert, and a non-removed insert", () => {
    expect(evaluateRenderGates(clean({ insertedAboveMain: 1 })).verdict).toBe("fail");
    expect(evaluateRenderGates(clean({ insertedVisible: false })).verdict).toBe("fail");
    expect(evaluateRenderGates(clean({ insertedRemoved: false })).verdict).toBe("fail");
  });

  it("WARNS (holds back) when the insert landed far below the hero (wrapper anchor)", () => {
    const r = evaluateRenderGates(
      clean({ requestedInserts: 1, appliedInserts: 1, insertedGapToHeroPx: 4200 }),
    );
    expect(r.verdict).toBe("warn");
    expect(r.reasons.join(" ")).toMatch(/below the hero headline/);
  });

  it("WARNS when a requested insert could not be applied", () => {
    const r = evaluateRenderGates(clean({ requestedInserts: 1, appliedInserts: 0 }));
    expect(r.verdict).toBe("warn");
    expect(r.reasons.join(" ")).toMatch(/insert\(s\) could not be applied/);
  });
});
