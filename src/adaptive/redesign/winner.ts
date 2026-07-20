// Fas 4 (step 1) — variant winner evaluator. PURE, RECOMMENDATION-ONLY.
//
// Given a serving variant's A/B arms (variant vs control), answer ONE question:
// "should a human be told this variant looks like a winner / a loser / neither?"
// It decides NOTHING on its own — per the owner's Fas 4 rules (2026-07-12), the
// system recommends, a human approves, and baseline swaps are always manual.
// Not wired into any live path; the eventual serving step calls this.
//
// The significance math is the SAME as pattern attribution — twoProportionZ from
// aggregate.ts, |z| ≥ 1.96, and the success–failure validity rule (MIN_ARM_*) —
// one definition of "significant" across the whole system. The owner's stricter
// volume + effect-size gates layer on top:
//   winner ⇐ ≥1000 qualified visits AND ≥50 conversions per arm,
//            |z| ≥ 1.96 with the variant ahead,
//            ≥5% RELATIVE lift (the practically-relevant minimum),
//            and NO clear degradation of a secondary guard metric.
//   stop   ⇐ the variant is significantly WORSE (existing significance rules —
//            deliberately reachable below the winner-volume bar, so a clearly
//            losing variant can be pulled early instead of burning traffic).

import { twoProportionZ, armStatValid as armCountsValid } from "@/lib/dashboard/aggregate";

/** One A/B arm's counts (distinct qualified visitors). */
export interface VariantArm {
  visits: number;
  conversions: number;
}

/** A secondary guard metric — a rate where getting WORSE should block a winner
 *  recommendation even when the headline converts better (e.g. form-abandon
 *  rate, rage-click rate, bounce rate). `higherIsBetter` says which direction
 *  is good (false for all the examples above). */
export interface SecondaryMetric {
  name: string;
  variantRate: number;
  controlRate: number;
  higherIsBetter: boolean;
}

export type WinnerOutcome =
  | "insufficient_data"
  | "no_winner"
  | "recommend_winner"
  | "recommend_stop";

export interface WinnerEvaluation {
  outcome: WinnerOutcome;
  /** Human-readable reasons, most decisive first. Never empty. */
  reasons: string[];
  stats: {
    variantRate: number;
    controlRate: number;
    /** (variant − control) / control; null when the control rate is 0. */
    relativeLift: number | null;
    z: number | null;
  };
}

// Owner's cautious-v1 thresholds (docs/fas4-per-segment-serving.md, 2026-07-12).
// May be tuned per customer later; these are the defaults.
export const WINNER_MIN_VISITS = 1000;
export const WINNER_MIN_CONVERSIONS = 50;
/** Engagemangsmålet (test_metric='continuation', ägarbeslut 2026-07-20):
 *  utfallet finns i varje session, så armarna bär statistiken långt tidigare
 *  — men samma z-krav, lyftkrav och sekundärvakter gäller oförändrat. */
export const ENGAGEMENT_MIN_VISITS = 200;
export const ENGAGEMENT_MIN_SUCCESSES = 20;
export const WINNER_Z = 1.96; // ≥95% confidence — same bar attribution uses
export const WINNER_MIN_REL_LIFT = 0.05;
/** A secondary guard metric counts as degraded when it worsens by more than this
 *  RELATIVE amount — coarse by design (a guard, not a verdict). */
export const SECONDARY_DEGRADE_REL = 0.1;

const rate = (a: VariantArm): number => (a.visits > 0 ? a.conversions / a.visits : 0);

/** The success–failure validity rule — the attribution layer's exported
 *  predicate, applied to this evaluator's arm shape. */
const armStatValid = (a: VariantArm): boolean => armCountsValid(a.visits, a.conversions);

/** Secondary metrics that clearly got worse under the variant. */
function degradedSecondaries(secondaries: SecondaryMetric[]): SecondaryMetric[] {
  return secondaries.filter((s) => {
    const base = s.controlRate;
    if (base <= 0) return s.higherIsBetter ? false : s.variantRate > 0 && s.variantRate > SECONDARY_DEGRADE_REL;
    const rel = (s.variantRate - base) / base;
    return s.higherIsBetter ? rel < -SECONDARY_DEGRADE_REL : rel > SECONDARY_DEGRADE_REL;
  });
}

/** Evaluate one variant's A/B against the owner's gates. Pure; never throws. */
export function evaluateWinner(
  variant: VariantArm,
  control: VariantArm,
  secondaries: SecondaryMetric[] = [],
  // Volymtrösklar per mätmål — continuation-läget skickar ENGAGEMENT_-paren.
  // Betydelsen av `conversions` i armarna är då "fortsatte till andra sidan".
  thresholds: { minVisits: number; minSuccesses: number } = {
    minVisits: WINNER_MIN_VISITS,
    minSuccesses: WINNER_MIN_CONVERSIONS,
  },
): WinnerEvaluation {
  const vRate = rate(variant);
  const cRate = rate(control);
  const z = twoProportionZ(variant.conversions, variant.visits, control.conversions, control.visits);
  const relativeLift = cRate > 0 ? (vRate - cRate) / cRate : null;
  const stats = { variantRate: vRate, controlRate: cRate, relativeLift, z };
  const significant = z !== null && Math.abs(z) >= WINNER_Z && armStatValid(variant) && armStatValid(control);

  // Damage limitation first: a variant that is SIGNIFICANTLY worse should be
  // pulled as soon as the standard significance rules can say so — waiting for
  // the full winner volume would just burn traffic on a proven loser.
  if (significant && z !== null && z < 0) {
    return {
      outcome: "recommend_stop",
      reasons: [
        `variant converts significantly WORSE than control (${(vRate * 100).toFixed(1)}% vs ${(cRate * 100).toFixed(1)}%, z=${z.toFixed(2)}) — recommend stopping the variant`,
      ],
      stats,
    };
  }

  // Owner's volume gates for a WINNER call.
  const lacking: string[] = [];
  for (const [label, arm] of [["variant", variant], ["control", control]] as const) {
    if (arm.visits < thresholds.minVisits)
      lacking.push(`${label} has ${arm.visits}/${thresholds.minVisits} qualified visits`);
    if (arm.conversions < thresholds.minSuccesses)
      lacking.push(`${label} has ${arm.conversions}/${thresholds.minSuccesses} successes`);
  }
  if (lacking.length > 0) {
    return { outcome: "insufficient_data", reasons: lacking, stats };
  }

  if (!significant || z === null || z <= 0) {
    return {
      outcome: "no_winner",
      reasons: [
        `no significant difference at ≥95% confidence (z=${z === null ? "—" : z.toFixed(2)}) — keep testing`,
      ],
      stats,
    };
  }

  // Practically relevant effect size. A 0% control with a significant positive
  // variant clears any relative bar by definition.
  if (relativeLift !== null && relativeLift < WINNER_MIN_REL_LIFT) {
    return {
      outcome: "no_winner",
      reasons: [
        `lift is significant but below the practical minimum (${(relativeLift * 100).toFixed(1)}% < ${WINNER_MIN_REL_LIFT * 100}%) — not worth a baseline change`,
      ],
      stats,
    };
  }

  const degraded = degradedSecondaries(secondaries);
  if (degraded.length > 0) {
    return {
      outcome: "no_winner",
      reasons: degraded.map(
        (s) =>
          `secondary metric "${s.name}" degraded (${(s.controlRate * 100).toFixed(1)}% → ${(s.variantRate * 100).toFixed(1)}%) — winner blocked`,
      ),
      stats,
    };
  }

  return {
    outcome: "recommend_winner",
    reasons: [
      `variant converts ${(vRate * 100).toFixed(1)}% vs control ${(cRate * 100).toFixed(1)}%` +
        (relativeLift !== null ? ` (+${(relativeLift * 100).toFixed(1)}% relative)` : " (control at 0%)") +
        ` at z=${z.toFixed(2)} — RECOMMENDATION ONLY: baseline swap requires manual approval`,
    ],
    stats,
  };
}
