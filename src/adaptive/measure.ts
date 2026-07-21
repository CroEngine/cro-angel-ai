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
  upliftRel: number | null; // null when the holdout rate is 0
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
  const base = {
    served: { ...served, rate: sRate, ci: wilsonInterval(served.conversions, served.n) },
    holdout: { ...holdout, rate: hRate, ci: wilsonInterval(holdout.conversions, holdout.n) },
    upliftAbs: sRate - hRate,
    upliftRel: hRate > 0 ? (sRate - hRate) / hRate : null,
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
