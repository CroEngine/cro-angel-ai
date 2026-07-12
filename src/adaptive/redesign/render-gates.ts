// Fas 3 (slice 3b) — pixel-half beauty gates (pure).
//
// The structural preview (slice 3a) answered "does the new ORDER make sense?"
// without a browser. This is the other half: after the plan is actually applied
// to a rendered DOM and measured, decide "blir det snyggt, eller försämrade vi
// sidan?" — the same question preflight asks of the old pattern engine, phrased
// for the redesign plan.
//
// This module is the PURE verdict over the browser's measurements (the DOM work
// + screenshots live in render.server.ts). It deliberately reuses the exact gate
// thresholds the robustness analyzer already trusts (analyze.ts): a moved block
// must not cross above the page's main content, apply must not introduce
// horizontal scroll, no interactive element may become unclickable, and the whole
// thing must reverse. Keeping the thresholds identical means the redesign path is
// held to the same "never degrade the page" bar as everything else.

/** Raw measurements the browser harness captures around apply. */
export interface RenderMeasurements {
  /** Section labels in DOM order BEFORE apply. */
  beforeOrder: string[];
  /** Section labels in DOM order AFTER apply. */
  afterOrder: string[];
  /** documentElement.scrollWidth − clientWidth BEFORE apply (the page's own). */
  hOverflowBeforePx: number;
  /** …AFTER apply. */
  hOverflowAfterPx: number;
  /** Vertical overlap (px) the reorder INTRODUCED between adjacent sections —
   *  the biggest new amount by which one section's box now sits over its
   *  neighbour's. Sections legitimately overlap by design (rounded cards, negative
   *  margins), so only the INTRODUCED delta counts. Catches the collision class the
   *  horizontal-overflow gate is blind to (a floating hero CTA landing on top of a
   *  block that was moved up under it). Optional: older observations omit it. */
  verticalOverlapIntroducedPx?: number;
  /** Sections that were actually moved (tagged data-angel-moved). */
  movedCount: number;
  /** Moved sections whose top landed ABOVE the page's main anchor (h1/main) —
   *  the "hero demoted / above the fold headline" breakage. */
  movedAboveMain: number;
  /** Was an h1/main anchor found to measure against? */
  mainAnchorFound: boolean;
  /** Conversion CTAs that were hit-testable (clickable) BEFORE apply. */
  ctaChecked: number;
  /** …how many became unclickable (covered/detached/hidden) AFTER apply. */
  ctaBroken: number;
  /** move ops the plan requested. */
  requestedMoves: number;
  /** move ops that were SAFELY applicable (target + predecessor were siblings). */
  appliedMoves: number;
  /** After reset(), does the DOM order equal beforeOrder exactly? */
  reversedOrderMatches: boolean;
}

export type RenderVerdict = "pass" | "warn" | "fail";

export interface RenderGateResult {
  verdict: RenderVerdict;
  /** Human-readable issues, most severe first. Empty on a clean pass. */
  reasons: string[];
  /** Horizontal overflow (px) apply INTRODUCED (0 when the page already had it). */
  hOverflowIntroducedPx: number;
  /** Vertical section overlap (px) apply INTRODUCED (0 when unmeasured/none). */
  verticalOverlapIntroducedPx: number;
  /** Did the applied order differ from before (i.e. a real reorder happened)? */
  reordered: boolean;
}

/** Same trigger analyze.ts uses: >8px of NEWLY introduced horizontal scroll fails. */
export const H_OVERFLOW_FAIL_PX = 8;

/** Introduced vertical overlap beyond this is a collision, not a nudge. Heuristic:
 *  a clean reorder shifts adjacent-section overlap by tens of px (rounded cards
 *  legitimately tuck); a section landing under a floating hero CTA introduces
 *  hundreds. Calibrated on plausible.io (clean reorder +48px passes; the collision
 *  case +320px fails). */
export const V_OVERLAP_FAIL_PX = 100;

/** Evaluate the beauty gates over one apply's measurements. Pure. */
export function evaluateRenderGates(m: RenderMeasurements): RenderGateResult {
  const hOverflowIntroducedPx = Math.max(0, m.hOverflowAfterPx - m.hOverflowBeforePx);
  const reordered = !sameOrder(m.beforeOrder, m.afterOrder);

  const reasons: string[] = [];
  let verdict: RenderVerdict = "pass";
  const fail = (r: string) => {
    reasons.push(r);
    verdict = "fail";
  };
  const warn = (r: string) => {
    reasons.push(r);
    if (verdict !== "fail") verdict = "warn";
  };

  // Hard failures — a customer would see these as damage.
  if (m.movedAboveMain > 0) {
    fail(
      `${m.movedAboveMain} moved section(s) placed ABOVE the page's main content — would look broken`,
    );
  }
  if (hOverflowIntroducedPx > H_OVERFLOW_FAIL_PX) {
    fail(`apply introduced ${hOverflowIntroducedPx}px of horizontal overflow`);
  }
  const vOverlap = m.verticalOverlapIntroducedPx ?? 0;
  if (vOverlap > V_OVERLAP_FAIL_PX) {
    fail(
      `apply introduced ${vOverlap}px of vertical overlap between sections (a moved block collides with its neighbour)`,
    );
  }
  if (m.ctaBroken > 0) {
    fail(
      `${m.ctaBroken} conversion CTA(s) became unclickable after apply (covered / hidden / detached)`,
    );
  }
  if (!m.reversedOrderMatches) {
    fail("reset() did not restore the original section order — change is not reversible");
  }

  // Soft signals — surfaced, not blocking.
  if (m.requestedMoves > 0 && m.appliedMoves < m.requestedMoves) {
    warn(
      `${m.requestedMoves - m.appliedMoves}/${m.requestedMoves} move(s) could not be applied safely (target not a clean sibling)`,
    );
  }
  if (m.movedCount > 0 && !m.mainAnchorFound) {
    warn("section(s) moved but no h1/main anchor to judge against — review screenshots");
  }
  if (m.requestedMoves > 0 && m.appliedMoves === 0) {
    warn("no moves were applied — nothing to preview");
  } else if (m.appliedMoves > 0 && !reordered && verdict === "pass") {
    // Applied a move but the order is unchanged (e.g. moved to its own slot).
    warn("apply reported moves but the section order is unchanged");
  }

  return { verdict, reasons, hOverflowIntroducedPx, verticalOverlapIntroducedPx: vOverlap, reordered };
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
