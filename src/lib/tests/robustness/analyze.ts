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
    consoleErrorCount: number;
    durationMs: number;
  };
}

/** Fraction of the element tree that vanished after apply (0..1). */
function removedFraction(baseline: DomSignature, after: DomSignature): number {
  if (baseline.elementCount <= 0) return 0;
  const removed = baseline.elementCount - after.elementCount;
  return removed > 0 ? removed / baseline.elementCount : 0;
}

export function analyze(o: RobustnessObservation): RobustnessReport {
  const targeted = o.probes.filter((p) => p.count > 0).length;
  const via = { selector: 0, slot: 0, text: 0, none: 0 };
  for (const p of o.probes) via[p.via] += 1;
  const targetingRate = o.decidedCount > 0 ? targeted / o.decidedCount : 1;
  const fullyTargeted = o.decidedCount === 0 || targeted === o.decidedCount;
  const reversible = o.snippetRan && o.residueAfterReset === 0;
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

    // Soft signals — worth surfacing, not launch-blocking.
    if (o.decidedCount > 0 && !fullyTargeted) {
      warn(`${o.decidedCount - targeted}/${o.decidedCount} adaptation(s) resolved no target`);
    }
    if (o.decidedCount === 0) {
      warn("no adaptations decided for this persona (empty inventory?)");
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
  return { total, pass, warn, fail, avgTargetingRate, irreversible };
}
