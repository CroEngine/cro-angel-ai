// Robustness analyzer (pure).
//
// Turns the raw in-browser observation captured by the runner into a verdict:
// did the snippet run cleanly, hit real targets, avoid breaking the page, and
// fully reverse? No IO, no DOM — unit-testable against synthetic observations.

/** Cheap, layout-independent fingerprint of the DOM at a point in time. */
export interface DomSignature {
  /** document.body.textContent.length — catches text replacement. */
  textLen: number;
  /** Total element count — catches inserted/removed nodes. */
  elementCount: number;
  /** document.body.children.length — catches structural churn. */
  bodyChildCount: number;
}

/** How much the visible layout moved when the adaptations were applied — a
 *  CLS-like signal that catches "looks broken / content jumps" even when no
 *  element was removed and nothing threw. */
export interface LayoutDiff {
  /** Elements sampled before apply that were still present after. */
  matched: number;
  /** How many of those moved more than a few px. */
  shiftedCount: number;
  /** Angel-attributable viewport shift, 0..1 (CLS-like): motion during apply
   *  MINUS the page's own ambient motion over an equal control window. */
  shiftedFraction: number;
  /** The page's own motion over the control window (carousels, autoplay, etc.),
   *  0..1 — surfaced so a large ambient number explains a noisy page. */
  controlShiftedFraction: number;
  /** Largest single-element movement during apply, in px. */
  maxMove: number;
}

/** Did the adaptation survive a framework re-render? On a React/Vue/Svelte page
 *  the next render can revert our change (markers vanish) or duplicate it. We
 *  compare the count of Angel markers right after apply vs after provoking a
 *  re-render (scroll / resize / time). */
export interface RerenderProbe {
  /** Angel markers present immediately after apply. */
  residueAfterApply: number;
  /** Angel markers present after a re-render was provoked. */
  residueAfterRerender: number;
}

/** Did the page stay USABLE after apply? We hit-test interactive elements
 *  (CTA / nav / form controls) at their centre before and after apply; an
 *  element that was clickable and became covered / hidden / detached is a
 *  functional regression, not just a cosmetic one. */
export interface InteractionProbe {
  /** Interactive elements that were clickable (hit-testable) before apply. */
  checked: number;
  /** How many of those became unclickable after apply. */
  broken: number;
}

/** Per-adaptation target resolution, mirroring the snippet's resolveNodes(). */
export interface AdaptationProbe {
  pattern: string;
  op: string;
  /** Which locator resolved the target: selector → slot → text → none. */
  via: "selector" | "slot" | "text" | "none";
  /** How many nodes the locator matched. */
  count: number;
}

/** Everything the runner captured for one (site, url, persona). */
export interface RobustnessObservation {
  url: string;
  site: string;
  persona: string;
  /** Page navigation succeeded. */
  reachable: boolean;
  /** The snippet's real apply()/reset() seam was reachable and ran. */
  snippetRan: boolean;
  /** console.error / pageerror strings captured during the apply window. */
  consoleErrors: string[];
  /** decision.adaptations.length. */
  decidedCount: number;
  /** ids apply() reported as applied. */
  appliedCount: number;
  probes: AdaptationProbe[];
  baseline: DomSignature;
  afterApply: DomSignature;
  afterReset: DomSignature;
  layout: LayoutDiff;
  rerender: RerenderProbe;
  interaction: InteractionProbe;
  /** Angel residue remaining after reset() (must be 0): leftover classes /
   *  injected badges / hidden markers. The strongest reversibility signal —
   *  robust even on pages that mutate their own DOM. */
  residueAfterReset: number;
  durationMs: number;
}

export type Verdict = "pass" | "warn" | "fail";

export interface RobustnessReport {
  url: string;
  site: string;
  persona: string;
  verdict: Verdict;
  /** Human-readable issues, most severe first. Empty on a clean pass. */
  reasons: string[];
  metrics: {
    decided: number;
    applied: number;
    /** Adaptations whose target resolved to ≥1 node. */
    targeted: number;
    /** targeted / decided, 0..1 (1 when nothing was decided). */
    targetingRate: number;
    /** All decided adaptations resolved to a real target. */
    fullyTargeted: boolean;
    /** How targets resolved across adaptations — shows the resilient fallbacks
     *  (slot / text) actually earning their keep vs the primary selector. */
    via: { selector: number; slot: number; text: number; none: number };
    /** No Angel residue left after reset(). */
    reversible: boolean;
    /** Elements removed after apply vs baseline (layout-breakage smell). */
    elementsRemoved: number;
    /** CLS-like layout movement caused by apply. */
    layout: LayoutDiff;
    /** Did the marker-bearing adaptations survive a re-render unchanged? */
    rerenderStable: boolean;
    /** Interactive elements that became unclickable after apply (0 = good). */
    interactionBroken: number;
    consoleErrorCount: number;
    durationMs: number;
  };
}

/** Viewport-shift fraction at/above which we flag the change for visual review. */
export const LARGE_SHIFT = 0.4;

/** Fraction of the element tree that vanished after apply (0..1). */
function removedFraction(baseline: DomSignature, after: DomSignature): number {
  if (baseline.elementCount <= 0) return 0;
  const removed = baseline.elementCount - after.elementCount;
  return removed > 0 ? removed / baseline.elementCount : 0;
}

const EMPTY_SIGNATURE: DomSignature = { textLen: 0, elementCount: 0, bodyChildCount: 0 };

/** Build a `fail` report for a page/persona that never got measured (unreachable,
 *  snippet didn't init, a phase timed out). Shared by the runner and the route. */
export function failReport(
  url: string,
  site: string,
  persona: string,
  reason: string,
  opts: { reachable?: boolean; snippetRan?: boolean } = {},
): RobustnessReport {
  return analyze({
    url,
    site,
    persona,
    reachable: opts.reachable ?? false,
    snippetRan: opts.snippetRan ?? false,
    consoleErrors: [reason],
    decidedCount: 0,
    appliedCount: 0,
    probes: [],
    baseline: EMPTY_SIGNATURE,
    afterApply: EMPTY_SIGNATURE,
    afterReset: EMPTY_SIGNATURE,
    layout: { matched: 0, shiftedCount: 0, shiftedFraction: 0, controlShiftedFraction: 0, maxMove: 0 },
    rerender: { residueAfterApply: 0, residueAfterRerender: 0 },
    interaction: { checked: 0, broken: 0 },
    residueAfterReset: -1,
    durationMs: 0,
  });
}

export function analyze(o: RobustnessObservation): RobustnessReport {
  const targeted = o.probes.filter((p) => p.count > 0).length;
  const via = { selector: 0, slot: 0, text: 0, none: 0 };
  for (const p of o.probes) via[p.via] += 1;
  const targetingRate = o.decidedCount > 0 ? targeted / o.decidedCount : 1;
  const fullyTargeted = o.decidedCount === 0 || targeted === o.decidedCount;
  const reversible = o.snippetRan && o.residueAfterReset === 0;
  // Only meaningful when apply left markers to track (reveal/emphasize/condense/
  // inject_badge). move_up / set_text leave none, so treat as stable.
  const rerenderStable =
    o.rerender.residueAfterApply === 0 ||
    o.rerender.residueAfterRerender === o.rerender.residueAfterApply;
  const elementsRemoved = Math.max(0, o.baseline.elementCount - o.afterApply.elementCount);
  const removedFrac = removedFraction(o.baseline, o.afterApply);

  const reasons: string[] = [];
  let verdict: Verdict = "pass";
  const fail = (r: string) => {
    reasons.push(r);
    verdict = "fail";
  };
  const warn = (r: string) => {
    reasons.push(r);
    if (verdict !== "fail") verdict = "warn";
  };

  // Hard failures — these would be visible defects on a customer's page.
  if (!o.reachable) {
    fail("page unreachable");
  } else if (!o.snippetRan) {
    fail("snippet did not initialize");
  } else {
    if (o.consoleErrors.length > 0) {
      fail(`console error(s) during apply: ${o.consoleErrors.slice(0, 3).join(" | ")}`);
    }
    if (!reversible) {
      fail(`reset() left ${o.residueAfterReset} residual change(s) on the page`);
    }
    // Losing a meaningful chunk of the DOM after apply = layout breakage.
    if (removedFrac >= 0.1) {
      fail(`${elementsRemoved} elements (${Math.round(removedFrac * 100)}%) removed after apply`);
    }
    // A clickable element became unclickable = functional breakage, not cosmetic.
    if (o.interaction.broken > 0) {
      fail(
        `${o.interaction.broken} interactive element(s) became unclickable after apply (covered / hidden / detached)`,
      );
    }

    // Soft signals — worth surfacing, not launch-blocking.
    if (o.decidedCount > 0 && !fullyTargeted) {
      warn(`${o.decidedCount - targeted}/${o.decidedCount} adaptation(s) resolved no target`);
    }
    if (o.decidedCount === 0) {
      warn("no adaptations decided for this persona (empty inventory?)");
    }
    // Large layout movement after apply — the page still "works" and reverses,
    // but content visibly jumps (bad CLS / possible layout break). Flag for a
    // human to eyeball the screenshots; not an automatic fail because some ops
    // (move_up / reveal) shift content by design.
    if (o.layout.shiftedFraction >= LARGE_SHIFT) {
      warn(
        `large layout shift: ~${Math.round(o.layout.shiftedFraction * 100)}% of the viewport moved after apply (review)`,
      );
    }
    // The adaptation didn't survive a re-render — a framework (React/Vue/…)
    // reverted or duplicated it. The page isn't broken (no error, still
    // reversible), but Angel won't reliably stick there. Worth flagging.
    if (!rerenderStable) {
      const a = o.rerender.residueAfterApply;
      const b = o.rerender.residueAfterRerender;
      warn(
        b < a
          ? `adaptation reverted by page re-render (${a}→${b} markers survived)`
          : `adaptation duplicated after page re-render (${a}→${b} markers)`,
      );
    }
  }

  return {
    url: o.url,
    site: o.site,
    persona: o.persona,
    verdict,
    reasons,
    metrics: {
      decided: o.decidedCount,
      applied: o.appliedCount,
      targeted,
      targetingRate,
      fullyTargeted,
      via,
      reversible,
      elementsRemoved,
      layout: o.layout,
      rerenderStable,
      interactionBroken: o.interaction.broken,
      consoleErrorCount: o.consoleErrors.length,
      durationMs: o.durationMs,
    },
  };
}

export interface SweepSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  /** Mean targeting rate across reachable pages, 0..1. */
  avgTargetingRate: number;
  /** Pages where reset() failed to fully revert. */
  irreversible: number;
  /** Pages with a large layout shift after apply (visual-review bucket). */
  bigShift: number;
  /** Pages where an interactive element became unclickable after apply. */
  interactionBroken: number;
}

/** Aggregate a batch of reports — the launch-gate view. */
export function summarize(reports: RobustnessReport[]): SweepSummary {
  const total = reports.length;
  const pass = reports.filter((r) => r.verdict === "pass").length;
  const warn = reports.filter((r) => r.verdict === "warn").length;
  const fail = reports.filter((r) => r.verdict === "fail").length;
  const reachable = reports.filter((r) => !r.reasons.includes("page unreachable"));
  const avgTargetingRate =
    reachable.length > 0
      ? reachable.reduce((s, r) => s + r.metrics.targetingRate, 0) / reachable.length
      : 0;
  const irreversible = reports.filter((r) => r.metrics.reversible === false).length;
  const bigShift = reports.filter((r) => r.metrics.layout.shiftedFraction >= LARGE_SHIFT).length;
  const interactionBroken = reports.filter((r) => r.metrics.interactionBroken > 0).length;
  return { total, pass, warn, fail, avgTargetingRate, irreversible, bigShift, interactionBroken };
}
