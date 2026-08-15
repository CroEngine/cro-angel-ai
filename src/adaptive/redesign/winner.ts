// Fas 4 (step 1) — variant winner evaluator. PURE, RECOMMENDATION-ONLY.
//
// Given a serving variant's A/B arms (variant vs control), answer ONE question:
// "should a human be told this variant looks like a winner / a loser / neither?"
// It decides NOTHING on its own — per the owner's Fas 4 rules (2026-07-12), the
// system recommends, a human approves, and baseline swaps are always manual.
// LIVE consumers (gap-audit Tier-1 wiring, 2026-07-23): the dashboard's variant
// A/B view calls evaluateWinnerWithGuards (never bare evaluateWinner — the
// guards come from the arms RPC), and setVariantStatus gates serving→winner on
// promotionBlockReason. The ONE carve-out from "the human decides": promotion
// is refused when harm is DEMONSTRATED (contract breach/loss/recommend_stop),
// because promotion freezes the A/B and makes live harm unmeasurable.
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
  "insufficient_data" | "no_winner" | "recommend_winner" | "recommend_stop";

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
    if (base <= 0)
      return s.higherIsBetter ? false : s.variantRate > 0 && s.variantRate > SECONDARY_DEGRADE_REL;
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
  // RIKTNINGEN (bounce-bytet 2026-08-15). Default true = oförändrat beteende
  // för varje befintlig anropare. Sätts false för mått där LÄGRE är bättre
  // (metrikkatalogens direction: "down", t.ex. bounce). Utan den här flaggan
  // dömde regeln alltid "högre = bättre" och hade utropat den variant som får
  // FLER att studsa till vinnare — tyst, med full självsäkerhet, eftersom
  // guardrail-vägen läser riktningen men primärvägen inte gjorde det.
  higherIsBetter = true,
): WinnerEvaluation {
  const vRate = rate(variant);
  const cRate = rate(control);
  const z = twoProportionZ(
    variant.conversions,
    variant.visits,
    control.conversions,
    control.visits,
  );
  const relativeLift = cRate > 0 ? (vRate - cRate) / cRate : null;
  // stats bär ALLTID de råa talen — det är sanningen om datan. Bara domen
  // vänds, så en läsare ser "bounce 56 % → 48 %" och z:s verkliga tecken.
  const stats = { variantRate: vRate, controlRate: cRate, relativeLift, z };
  const sign = higherIsBetter ? 1 : -1;
  /** z/lyft sedda från "bättre är positivt"-hållet — allt nedanför dömer på dem. */
  const dirZ = z === null ? null : sign * z;
  const dirLift = relativeLift === null ? null : sign * relativeLift;
  const better = higherIsBetter ? "higher" : "lower";
  const significant =
    z !== null && Math.abs(z) >= WINNER_Z && armStatValid(variant) && armStatValid(control);

  // Damage limitation first: a variant that is SIGNIFICANTLY worse should be
  // pulled as soon as the standard significance rules can say so — waiting for
  // the full winner volume would just burn traffic on a proven loser.
  if (significant && dirZ !== null && dirZ < 0) {
    return {
      outcome: "recommend_stop",
      reasons: [
        `variant is significantly WORSE than control (${(vRate * 100).toFixed(1)}% vs ${(cRate * 100).toFixed(1)}%, ${better} is better, z=${z!.toFixed(2)}) — recommend stopping the variant`,
      ],
      stats,
    };
  }

  // Owner's volume gates for a WINNER call.
  const lacking: string[] = [];
  for (const [label, arm] of [
    ["variant", variant],
    ["control", control],
  ] as const) {
    if (arm.visits < thresholds.minVisits)
      lacking.push(`${label} has ${arm.visits}/${thresholds.minVisits} qualified visits`);
    if (arm.conversions < thresholds.minSuccesses)
      lacking.push(`${label} has ${arm.conversions}/${thresholds.minSuccesses} successes`);
  }
  if (lacking.length > 0) {
    return { outcome: "insufficient_data", reasons: lacking, stats };
  }

  if (!significant || dirZ === null || dirZ <= 0) {
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
  if (dirLift !== null && dirLift < WINNER_MIN_REL_LIFT) {
    return {
      outcome: "no_winner",
      reasons: [
        `improvement is significant but below the practical minimum (${(dirLift * 100).toFixed(1)}% < ${WINNER_MIN_REL_LIFT * 100}%) — not worth a baseline change`,
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
      `variant ${(vRate * 100).toFixed(1)}% vs control ${(cRate * 100).toFixed(1)}% (${better} is better)` +
        (dirLift !== null
          ? ` (${(dirLift * 100).toFixed(1)}% better, relative)`
          : " (control at 0%)") +
        ` at z=${z.toFixed(2)} — RECOMMENDATION ONLY: baseline swap requires manual approval`,
    ],
    stats,
  };
}

// ── False-winner guard (gap-audit Tier-1, 2026-07-22) ────────────────────────
// evaluateWinner has carried a SecondaryMetric guard since day one — but the
// live dashboard called it with `[]`, so "recommend_winner" never consulted the
// guard metrics the arms RPC already returns. These helpers are the ONE way the
// product should evaluate a live variant: guards built from the real arms, and
// — under the continuation proxy metric — the actual GOAL as a guard, so an
// engagement win can never silently ride over sinking conversions.

/** Per-arm counts exactly as the angel_variant_arms RPC returns them.
 *  `conversions` is ALWAYS the goal column (even when the test metric is
 *  continuation — the RPC reports both, and the goal guard needs the goal). */
/** Sajtens mätmål. `conversion` är målet självt; `continuation` och `bounce`
 *  är PROXIES som når signifikans långt tidigare — och som därför alltid
 *  körs med målet som vakt (se evaluateWinnerWithGuards). */
export type TestMetric = "conversion" | "continuation" | "bounce";

export interface GuardArmCounts {
  visits: number;
  conversions: number;
  continuations: number;
  engaged: number;
  /** Besökare som gjorde INGENTING: en sida, inga klick, inte engagerad
   *  (RPC-kolumnen, migration 20260815100000). Valfri: äldre anropare och
   *  äldre RPC-svar saknar den, och 0 blir då "för lite data" i grindarna. */
  bounces?: number;
}

const safeRate = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** The guard set for a live A/B, from the arms themselves: bounce (worse =
 *  more one-page exits) and engagement (worse = fewer engaged visitors).
 *  Coarse by design — evaluateWinner only consults these AFTER its volume
 *  gates, so the rates carry real n. */
export function guardSecondariesFromArms(
  variant: GuardArmCounts,
  control: GuardArmCounts,
): SecondaryMetric[] {
  return [
    {
      name: "bounce",
      variantRate: safeRate(Math.max(0, variant.visits - variant.continuations), variant.visits),
      controlRate: safeRate(Math.max(0, control.visits - control.continuations), control.visits),
      higherIsBetter: false,
    },
    {
      name: "engaged",
      variantRate: safeRate(variant.engaged, variant.visits),
      controlRate: safeRate(control.engaged, control.visits),
      higherIsBetter: true,
    },
  ];
}

/**
 * Evaluate a live variant with the guards the arms afford. This is what the
 * dashboard and the winner-promotion gate call — never bare evaluateWinner.
 *
 * Under test_metric='continuation' (the engagement proxy that reaches
 * significance ~20× sooner), the GOAL metric is handled honestly instead of
 * ignored (the audit's false-winner case — a proxy win over sinking
 * conversions):
 *   - goal arms POWERED + goal significantly WORSE (z ≤ −1.96) ⇒ the winner
 *     recommendation is withdrawn (no_winner) with the goal numbers in the
 *     reasons. Noise never blocks — only a significant goal loss does.
 *   - proxy recommends winner but the goal has NOT independently proven
 *     BETTER (unpowered counts, or powered-but-inconclusive z) ⇒ the
 *     recommendation STANDS but carries an explicit caveat reason: this is a
 *     proxy win, the goal itself is unproven, and promoting freezes the A/B
 *     before it ever could be proven.
 */
export function evaluateWinnerWithGuards(
  variant: GuardArmCounts,
  control: GuardArmCounts,
  testMetric: TestMetric,
): WinnerEvaluation {
  // Bounce (ägarbeslut 2026-08-15) är en PROXY precis som continuation, och
  // körs därför genom exakt samma mål-vakt nedan — men med två skillnader:
  // utfallet är "gjorde ingenting", och LÄGRE är bättre. Utan riktnings-
  // flaggan hade regeln utropat den variant som får fler att studsa.
  const proxy = testMetric === "continuation" || testMetric === "bounce";
  const primaryOf = (a: GuardArmCounts): VariantArm => ({
    visits: a.visits,
    conversions:
      testMetric === "continuation"
        ? a.continuations
        : testMetric === "bounce"
          ? (a.bounces ?? 0)
          : a.conversions,
  });
  const secondaries = guardSecondariesFromArms(variant, control);
  const thresholds = proxy
    ? { minVisits: ENGAGEMENT_MIN_VISITS, minSuccesses: ENGAGEMENT_MIN_SUCCESSES }
    : undefined;
  const ev = evaluateWinner(
    primaryOf(variant),
    primaryOf(control),
    secondaries,
    thresholds,
    testMetric !== "bounce",
  );
  if (!proxy) return ev;

  const goalV: VariantArm = { visits: variant.visits, conversions: variant.conversions };
  const goalC: VariantArm = { visits: control.visits, conversions: control.conversions };
  const goalPowered = armStatValid(goalV) && armStatValid(goalC);
  const goalZ = twoProportionZ(goalV.conversions, goalV.visits, goalC.conversions, goalC.visits);
  const goalRates = `${(safeRate(goalV.conversions, goalV.visits) * 100).toFixed(1)}% vs ${(safeRate(goalC.conversions, goalC.visits) * 100).toFixed(1)}%`;

  if (goalPowered && goalZ !== null && goalZ <= -WINNER_Z) {
    return {
      outcome: "no_winner",
      reasons: [
        `${testMetric} leads but GOAL conversions are significantly WORSE (${goalRates}, z=${goalZ.toFixed(2)}) — winner withdrawn: an engagement win must never ride over a sinking goal`,
        ...ev.reasons,
      ],
      stats: ev.stats,
    };
  }
  const goalProvenBetter = goalPowered && goalZ !== null && goalZ >= WINNER_Z;
  if (ev.outcome === "recommend_winner" && !goalProvenBetter) {
    const why = !goalPowered
      ? `still unpowered (${goalV.conversions}/${goalV.visits} vs ${goalC.conversions}/${goalC.visits})`
      : `inconclusive (${goalRates}, z=${goalZ === null ? "—" : goalZ.toFixed(2)})`;
    return {
      ...ev,
      reasons: [
        ...ev.reasons,
        `caveat: this is a PROXY win (continuation) — the goal itself is unproven: goal conversions ${why}, and promoting freezes the A/B before the goal is ever proven`,
      ],
    };
  }
  return ev;
}

/**
 * The winner-PROMOTION gate (serving → winner). Promotion freezes the A/B —
 * the control arm stops filling, so any live harm becomes invisible and the
 * nightly guardrail sweep loses its evidence. The machine therefore refuses
 * promotion when harm is DEMONSTRATED (and only then — absence of proof stays
 * the owner's call, per the Fas 4 rules 2026-07-12):
 *   - the success-contract ruling says guardrail_breach or loss, or
 *   - the winner evaluation says recommend_stop.
 * Returns the refusal reason, or null when promotion may proceed.
 */
export function promotionBlockReason(
  evaluation: WinnerEvaluation | null,
  ruling: { verdict: string; breachedMetrics: string[] } | null,
): string | null {
  if (ruling?.verdict === "guardrail_breach") {
    const which =
      ruling.breachedMetrics.length > 0 ? ruling.breachedMetrics.join(", ") : "guardrail";
    return `contract guardrail breached (${which}) — promoting would freeze the A/B with live harm; retire or keep measuring instead`;
  }
  if (ruling?.verdict === "loss") {
    return `the success contract judges the primary metric significantly WORSE — a loser cannot be promoted to winner`;
  }
  if (evaluation?.outcome === "recommend_stop") {
    return `the A/B evaluation recommends STOPPING this variant (significantly worse than control) — promotion refused`;
  }
  return null;
}
