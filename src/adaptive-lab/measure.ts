// Angel Adaptive — MEASUREMENT (E4/E5): served vs holdout, honestly.
//
// The one question real visitors are ultimately for — "does the new design
// convert better?" — answered with the standard machinery: two-proportion
// z-test for the p-value, Wilson score intervals per arm, relative uplift,
// and verdict gates that refuse to call winners on thin data. Pure functions
// so the exact same math runs in the simulator today and on collector data
// later; anything murky is "inconclusive", never a win.

export type ArmStats = { n: number; conversions: number };

export type MeasureResult = {
  served: ArmStats & { rate: number; ci: [number, number] };
  holdout: ArmStats & { rate: number; ci: [number, number] };
  upliftAbs: number;
  upliftAbsCi: [number, number]; // unpooled 95% CI on the rate difference
  upliftRel: number | null; // null when the holdout rate is 0
  upliftRelCi: [number, number] | null;
  zScore: number;
  pValue: number;
  verdict: "win" | "loss" | "no_effect" | "inconclusive";
  reason: string;
};

// Minimum per-arm sample before any verdict beyond "inconclusive" — calling
// winners on a handful of visitors is how CRO tools lie.
export const MIN_ARM_N = 300;
export const MIN_ARM_CONVERSIONS = 10;
export const ALPHA = 0.05;

// Standard normal CDF via the Abramowitz–Stegun erf approximation (max abs
// error ~1.5e-7 — far below anything a verdict depends on).
export function normalCdf(z: number): number {
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  const erf = x >= 0 ? y : -y;
  return 0.5 * (1 + erf);
}

/** Wilson score interval — behaves at small n and near 0/1 where Wald lies. */
export function wilsonInterval(conversions: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = conversions / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Two-proportion z-test (pooled). Returns z and the two-sided p-value. */
export function twoProportionTest(a: ArmStats, b: ArmStats): { z: number; p: number } {
  if (a.n === 0 || b.n === 0) return { z: 0, p: 1 };
  const p1 = a.conversions / a.n;
  const p2 = b.conversions / b.n;
  const pooled = (a.conversions + b.conversions) / (a.n + b.n);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.n + 1 / b.n));
  if (se === 0) return { z: 0, p: 1 };
  const z = (p1 - p2) / se;
  return { z, p: 2 * (1 - normalCdf(Math.abs(z))) };
}

/**
 * Measure a rule: served arm vs holdout arm. The verdict gates:
 *   inconclusive — either arm below MIN_ARM_N or too few conversions total
 *                  to say anything (the honest default);
 *   win / loss   — significant at ALPHA in that direction;
 *   no_effect    — enough data, no significant difference.
 */
export function measureRule(served: ArmStats, holdout: ArmStats): MeasureResult {
  const sRate = served.n ? served.conversions / served.n : 0;
  const hRate = holdout.n ? holdout.conversions / holdout.n : 0;
  const { z, p } = twoProportionTest(served, holdout);
  const seDiff =
    served.n && holdout.n
      ? Math.sqrt((sRate * (1 - sRate)) / served.n + (hRate * (1 - hRate)) / holdout.n)
      : 0;
  const diff = sRate - hRate;
  const upliftAbsCi: [number, number] = [diff - 1.96 * seDiff, diff + 1.96 * seDiff];
  const base = {
    served: { ...served, rate: sRate, ci: wilsonInterval(served.conversions, served.n) },
    holdout: { ...holdout, rate: hRate, ci: wilsonInterval(holdout.conversions, holdout.n) },
    upliftAbs: diff,
    upliftAbsCi,
    upliftRel: hRate > 0 ? diff / hRate : null,
    upliftRelCi:
      hRate > 0
        ? ([upliftAbsCi[0] / hRate, upliftAbsCi[1] / hRate] as [number, number])
        : null,
    zScore: z,
    pValue: p,
  };

  if (served.n < MIN_ARM_N || holdout.n < MIN_ARM_N) {
    return {
      ...base,
      verdict: "inconclusive",
      reason: `arm below ${MIN_ARM_N} visitors (served ${served.n}, holdout ${holdout.n})`,
    };
  }
  if (served.conversions + holdout.conversions < MIN_ARM_CONVERSIONS) {
    return {
      ...base,
      verdict: "inconclusive",
      reason: `fewer than ${MIN_ARM_CONVERSIONS} total conversions`,
    };
  }
  if (p < ALPHA) {
    return {
      ...base,
      verdict: z > 0 ? "win" : "loss",
      reason: `p=${p.toFixed(4)} at n=${served.n}/${holdout.n}`,
    };
  }
  return {
    ...base,
    verdict: "no_effect",
    reason: `p=${p.toFixed(4)} — no significant difference at n=${served.n}/${holdout.n}`,
  };
}

// ── Metric hierarchy: one primary, few guardrails ──────────────────────────
//
// A site cares about hundreds of metrics; a rule may be JUDGED on exactly
// one — its pre-declared primary. Testing every dashboard metric at alpha
// guarantees fake wins (20 metrics ≈ 64% chance of at least one), so the
// rest of the metrics split into GUARDRAILS — which can never produce a win,
// only catch harm — and diagnostics, which decide nothing. Proxy primaries
// (clicks, scroll) buy measurement speed but can be gamed: a popup can raise
// clicks while chasing visitors away. Guardrails are what make that trade
// safe to offer.
//
// Guardrails are tested one-sided in the harm direction at a STRICTER alpha
// than the primary: a breach only ever pauses serving (the conservative
// direction), but pausing genuinely good rules has a cost too, so the bar
// for claiming harm is higher than the bar for claiming effect.

export type MetricDirection = "up" | "down"; // which way is GOOD for the site

export const GUARDRAIL_ALPHA = 0.01;

export type GuardrailResult = {
  metric: string;
  direction: MetricDirection;
  breached: boolean;
  z: number; // signed: positive = served rate above holdout
  pHarm: number; // one-sided p in the harm direction
  servedRate: number;
  holdoutRate: number;
  reason: string;
};

/**
 * Test one guardrail metric for HARM only. `conversions` in ArmStats reads
 * as "visitors with the metric event" (bounced, engaged, clicked…). Thin
 * arms never breach — the primary's own gates already hold the verdict back.
 */
export function checkGuardrail(
  metric: string,
  direction: MetricDirection,
  served: ArmStats,
  holdout: ArmStats,
): GuardrailResult {
  const { z } = twoProportionTest(served, holdout);
  const zHarm = direction === "up" ? -z : z; // positive = harm
  const pHarm = 1 - normalCdf(zHarm);
  const enoughData =
    served.n >= MIN_ARM_N &&
    holdout.n >= MIN_ARM_N &&
    served.conversions + holdout.conversions >= MIN_ARM_CONVERSIONS;
  const breached = enoughData && pHarm < GUARDRAIL_ALPHA;
  const sRate = served.n ? served.conversions / served.n : 0;
  const hRate = holdout.n ? holdout.conversions / holdout.n : 0;
  return {
    metric,
    direction,
    breached,
    z,
    pHarm,
    servedRate: sRate,
    holdoutRate: hRate,
    reason: breached
      ? `${metric} harmed: ${(100 * sRate).toFixed(1)}% vs ${(100 * hRate).toFixed(1)}% (worse-is-${direction === "up" ? "lower" : "higher"}, p=${pHarm.toFixed(4)} < ${GUARDRAIL_ALPHA})`
      : !enoughData
        ? `${metric}: not enough data to evaluate`
        : `${metric}: no evidence of harm (p=${pHarm.toFixed(4)})`,
  };
}

export type RuleRuling = {
  primaryMetric: string;
  primary: MeasureResult;
  guardrails: GuardrailResult[];
  verdict: "win" | "loss" | "no_effect" | "inconclusive" | "guardrail_breach";
  action: "extend" | "pause" | "retire_or_redesign" | "keep_measuring";
  reason: string;
};

// Minimum relative effect the site would care about. "no_effect" only turns
// into retire_or_redesign when the uplift CI EXCLUDES effects this big —
// otherwise the world was simply underpowered and the honest action is to
// keep measuring, not to retire what might be a true winner. (A single
// fixed-horizon test misses 1−power of true effects; the miss must land in
// keep_measuring, never in retire.) Time-boxing rules that never reach
// precision is loop policy, not verdict math.
export const MDE_REL = 0.1;

/**
 * The full ruling for one rule: primary verdict + guardrail harm checks.
 * Any breached guardrail overrides everything — ESPECIALLY a primary win,
 * because that is exactly the gamed-proxy case the hierarchy exists for.
 * A significant primary LOSS also pauses (it is hurting now, not later).
 */
export function evaluateRuleMetrics(
  primaryMetric: string,
  primaryArms: { served: ArmStats; holdout: ArmStats },
  guardrailArms: Array<{
    metric: string;
    direction: MetricDirection;
    served: ArmStats;
    holdout: ArmStats;
  }>,
  opts: { mdeRel?: number } = {},
): RuleRuling {
  const mdeRel = opts.mdeRel ?? MDE_REL;
  const primary = measureRule(primaryArms.served, primaryArms.holdout);
  const guardrails = guardrailArms.map((g) =>
    checkGuardrail(g.metric, g.direction, g.served, g.holdout),
  );
  const breached = guardrails.filter((g) => g.breached);
  const base = { primaryMetric, primary, guardrails };

  if (breached.length > 0) {
    return {
      ...base,
      verdict: "guardrail_breach",
      action: "pause",
      reason: `guardrail ${breached.map((b) => b.metric).join("+")} harmed — primary (${primaryMetric}) said "${primary.verdict}", pausing regardless: a primary win may not buy guardrail damage`,
    };
  }
  if (primary.verdict === "no_effect") {
    const ci = primary.upliftRelCi;
    const underpowered = ci === null || ci[1] >= mdeRel || ci[0] <= -mdeRel;
    return {
      ...base,
      verdict: "no_effect",
      action: underpowered ? "keep_measuring" : "retire_or_redesign",
      reason: underpowered
        ? `no significant difference, but rel CI [${ci ? `${(100 * ci[0]).toFixed(0)}%…${(100 * ci[1]).toFixed(0)}%` : "unbounded"}] still allows ±${100 * mdeRel}% — underpowered, keep measuring`
        : `no significant difference and rel CI [${(100 * ci![0]).toFixed(0)}%…${(100 * ci![1]).toFixed(0)}%] excludes ±${100 * mdeRel}% — genuinely flat`,
    };
  }
  const action =
    primary.verdict === "win"
      ? "extend"
      : primary.verdict === "loss"
        ? "pause"
        : "keep_measuring";
  return { ...base, verdict: primary.verdict, action, reason: primary.reason };
}
