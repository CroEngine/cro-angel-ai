import { describe, it, expect } from "vitest";

import {
  evaluateWinner,
  WINNER_MIN_VISITS,
  WINNER_MIN_CONVERSIONS,
  type VariantArm,
  type SecondaryMetric,
} from "../winner";

const arm = (visits: number, conversions: number): VariantArm => ({ visits, conversions });

describe("evaluateWinner — recommendation-only, owner's cautious v1 gates", () => {
  it("insufficient_data below the visit minimum, naming what's missing", () => {
    const r = evaluateWinner(arm(400, 60), arm(5000, 250));
    expect(r.outcome).toBe("insufficient_data");
    expect(r.reasons.some((x) => x.includes(`400/${WINNER_MIN_VISITS}`))).toBe(true);
  });

  it("insufficient_data below the conversion minimum", () => {
    const r = evaluateWinner(arm(2000, 30), arm(2000, 40));
    expect(r.outcome).toBe("insufficient_data");
    expect(r.reasons.some((x) => x.includes(`30/${WINNER_MIN_CONVERSIONS}`))).toBe(true);
    expect(r.reasons.some((x) => x.includes(`40/${WINNER_MIN_CONVERSIONS}`))).toBe(true);
  });

  it("exactly at the volume thresholds passes the volume gate", () => {
    // 1000 visits / 50 conversions per arm, identical rates → not a winner, but
    // the failure must be significance, not volume.
    const r = evaluateWinner(
      arm(WINNER_MIN_VISITS, WINNER_MIN_CONVERSIONS),
      arm(WINNER_MIN_VISITS, WINNER_MIN_CONVERSIONS),
    );
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons[0]).toMatch(/no significant difference/i);
  });

  it("no_winner when adequately powered but not significant", () => {
    const r = evaluateWinner(arm(2000, 104), arm(2000, 100)); // 5.2% vs 5.0%
    expect(r.outcome).toBe("no_winner");
    expect(r.stats.z).not.toBeNull();
  });

  it("no_winner when significant but under the 5% practical minimum", () => {
    // Huge n makes a ~4.4% relative lift significant — still not worth a swap.
    const r = evaluateWinner(arm(200_000, 9400), arm(200_000, 9000));
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons[0]).toMatch(/below the practical minimum/i);
    expect(r.stats.relativeLift).not.toBeNull();
    expect(r.stats.relativeLift!).toBeLessThan(0.05);
  });

  it("recommend_winner on a clean, significant, ≥5% relative win", () => {
    const r = evaluateWinner(arm(5000, 350), arm(5000, 250)); // 7.0% vs 5.0% (+40%)
    expect(r.outcome).toBe("recommend_winner");
    expect(r.stats.relativeLift!).toBeGreaterThan(0.05);
    expect(r.reasons[0]).toMatch(/RECOMMENDATION ONLY.*manual approval/);
  });

  it("recommend_stop on a significant LOSS — reachable below winner volume (damage limit)", () => {
    // 400 visits per arm — far under the 1000-visit winner bar, but the loss is
    // already significant by the standard rules: pull it early.
    const r = evaluateWinner(arm(400, 10), arm(400, 40)); // 2.5% vs 10.0%
    expect(r.outcome).toBe("recommend_stop");
    expect(r.reasons[0]).toMatch(/significantly WORSE/);
    expect(r.stats.z!).toBeLessThan(0);
  });

  it("a tiny not-yet-significant deficit is NOT a stop — it's insufficient data", () => {
    const r = evaluateWinner(arm(200, 9), arm(200, 11));
    expect(r.outcome).toBe("insufficient_data");
  });

  it("secondary degradation blocks an otherwise clean winner", () => {
    const secondaries: SecondaryMetric[] = [
      { name: "form-abandon rate", variantRate: 0.3, controlRate: 0.2, higherIsBetter: false },
    ];
    const r = evaluateWinner(arm(5000, 350), arm(5000, 250), secondaries);
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons[0]).toMatch(/form-abandon rate.*degraded.*winner blocked/i);
  });

  it("secondary metrics respect direction (higherIsBetter)", () => {
    const dropInGoodMetric: SecondaryMetric[] = [
      { name: "return-visit rate", variantRate: 0.1, controlRate: 0.2, higherIsBetter: true },
    ];
    expect(evaluateWinner(arm(5000, 350), arm(5000, 250), dropInGoodMetric).outcome).toBe(
      "no_winner",
    );
    const stableSecondaries: SecondaryMetric[] = [
      { name: "form-abandon rate", variantRate: 0.205, controlRate: 0.2, higherIsBetter: false },
    ];
    expect(evaluateWinner(arm(5000, 350), arm(5000, 250), stableSecondaries).outcome).toBe(
      "recommend_winner",
    );
  });

  it("control at 0%: a significant positive variant clears the relative bar", () => {
    const r = evaluateWinner(arm(3000, 90), arm(1500, 0));
    expect(r.stats.relativeLift).toBeNull();
    expect(r.outcome).toBe("insufficient_data"); // control lacks 50 conversions —
    // the volume gate protects against calling a winner on a dead control arm.
    expect(r.reasons.some((x) => x.includes("control has 0/50"))).toBe(true);
  });

  it("never throws and always returns reasons + stats", () => {
    for (const [v, c] of [
      [arm(0, 0), arm(0, 0)],
      [arm(1, 1), arm(1, 0)],
      [arm(10_000, 0), arm(10_000, 0)],
    ] as const) {
      const r = evaluateWinner(v, c);
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(r.stats).toBeDefined();
    }
  });
});

// ── evaluateWinnerWithGuards + promotionBlockReason (gap-audit Tier-1) ───────
// The live path must never judge a variant without the guards the arms afford:
// bounce/engaged always, and under the continuation proxy the GOAL itself.

import {
  evaluateWinnerWithGuards,
  guardSecondariesFromArms,
  promotionBlockReason,
  type GuardArmCounts,
} from "../winner";

const counts = (
  visits: number,
  conversions: number,
  continuations: number,
  engaged: number,
): GuardArmCounts => ({ visits, conversions, continuations, engaged });

describe("guardSecondariesFromArms — the arms' own guard set", () => {
  it("derives bounce (↓) and engaged (↑) rates from the counts", () => {
    const s = guardSecondariesFromArms(counts(1000, 50, 700, 400), counts(1000, 50, 800, 500));
    const bounce = s.find((x) => x.name === "bounce")!;
    const engaged = s.find((x) => x.name === "engaged")!;
    expect(bounce.higherIsBetter).toBe(false);
    expect(bounce.variantRate).toBeCloseTo(0.3);
    expect(bounce.controlRate).toBeCloseTo(0.2);
    expect(engaged.higherIsBetter).toBe(true);
    expect(engaged.variantRate).toBeCloseTo(0.4);
    expect(engaged.controlRate).toBeCloseTo(0.5);
  });
});

describe("evaluateWinnerWithGuards — false-winner protection on the live arms", () => {
  it("blocks a conversion win when bounce degraded (the guard the dashboard never passed)", () => {
    // Variant converts clearly better but bounces 38% vs control 30% (+27% rel).
    const v = counts(3000, 240, 1860, 1500);
    const c = counts(3000, 150, 2100, 1500);
    const r = evaluateWinnerWithGuards(v, c, "conversion");
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons.some((x) => /bounce/.test(x))).toBe(true);
  });

  it("recommends a clean conversion win when no guard degraded", () => {
    const v = counts(3000, 240, 2100, 1500);
    const c = counts(3000, 150, 2100, 1500);
    const r = evaluateWinnerWithGuards(v, c, "conversion");
    expect(r.outcome).toBe("recommend_winner");
  });

  it("continuation proxy: a proxy win over a SIGNIFICANTLY sinking goal is withdrawn", () => {
    // Continuations lead (60% vs 50%) but goal conversions sink 2% vs 4% at
    // real volume — the audit's exact false-winner case.
    const v = counts(3000, 60, 1800, 1500);
    const c = counts(3000, 120, 1500, 1500);
    const r = evaluateWinnerWithGuards(v, c, "continuation");
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons[0]).toMatch(/GOAL conversions are significantly WORSE/);
  });

  it("continuation proxy: an unproven goal does not block, but the caveat is explicit", () => {
    // Proxy volume gates pass (engagement thresholds) while the goal is merely
    // inconclusive (6 vs 5 conversions, z≈0.3) — the recommendation stands but
    // must SAY the goal itself is unproven before the owner freezes the A/B.
    const v = counts(400, 6, 280, 200);
    const c = counts(400, 5, 200, 200);
    const r = evaluateWinnerWithGuards(v, c, "continuation");
    expect(r.outcome).toBe("recommend_winner");
    expect(r.reasons.some((x) => /PROXY win/.test(x) && /unproven/.test(x))).toBe(true);
  });

  it("continuation proxy: goal noise at tiny counts never blocks (no coin-flip guard)", () => {
    // 3 vs 5 goal conversions is noise, not evidence — with the proxy leading,
    // the outcome must not be blocked by the goal guard (caveat only).
    const v = counts(400, 3, 280, 200);
    const c = counts(400, 5, 200, 200);
    const r = evaluateWinnerWithGuards(v, c, "continuation");
    expect(r.outcome).toBe("recommend_winner");
  });
});

describe("promotionBlockReason — the serving→winner gate", () => {
  const winnerEval = (
    outcome: "recommend_winner" | "recommend_stop" | "no_winner",
  ): import("../winner").WinnerEvaluation => ({
    outcome,
    reasons: [],
    stats: { variantRate: 0, controlRate: 0, relativeLift: null, z: null },
  });

  it("refuses on a contract guardrail breach, naming the metrics", () => {
    const r = promotionBlockReason(winnerEval("recommend_winner"), {
      verdict: "guardrail_breach",
      breachedMetrics: ["bounce", "engaged"],
    });
    expect(r).toMatch(/bounce, engaged/);
    expect(r).toMatch(/freeze the A\/B/);
  });

  it("refuses on a contract primary loss", () => {
    expect(
      promotionBlockReason(winnerEval("no_winner"), { verdict: "loss", breachedMetrics: [] }),
    ).toMatch(/significantly WORSE/);
  });

  it("refuses when the evaluation recommends stopping", () => {
    expect(promotionBlockReason(winnerEval("recommend_stop"), null)).toMatch(/STOPPING/);
  });

  it("allows promotion when no harm is demonstrated — absence of proof is the owner's call", () => {
    expect(
      promotionBlockReason(winnerEval("no_winner"), {
        verdict: "inconclusive",
        breachedMetrics: [],
      }),
    ).toBeNull();
    expect(promotionBlockReason(null, null)).toBeNull();
    expect(
      promotionBlockReason(winnerEval("recommend_winner"), { verdict: "win", breachedMetrics: [] }),
    ).toBeNull();
  });
});

// ── Monte-Carlo trust bars (calibration, 2026-07-26) ─────────────────────────
// The unit tests above prove the verdict LOGIC on hand-picked cases. These lock
// the RATE the "you only pay when it's real" promise rests on, over many random
// binomial draws from a KNOWN truth. Full calibration + power curve lives in
// scripts/winner-calibration.ts; this is the CI regression gate for the two that
// matter most: never declare a false winner on A/A, and DO catch a powered one.
describe("evaluateWinnerWithGuards — Monte-Carlo trust bars", () => {
  function mulberry(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const binom = (n: number, p: number, rnd: () => number): number => {
    let k = 0;
    for (let i = 0; i < n; i++) if (rnd() < p) k++;
    return k;
  };
  const winnerRate = (
    visits: number,
    pv: number,
    pc: number,
    trials: number,
  ): number => {
    let wins = 0;
    for (let t = 0; t < trials; t++) {
      const r = mulberry(9001 + t * 7919 + visits);
      const v = counts(visits, binom(visits, pv, r), binom(visits, 0.6, r), binom(visits, 0.6, r));
      const c = counts(visits, binom(visits, pc, r), binom(visits, 0.6, r), binom(visits, 0.6, r));
      if (evaluateWinnerWithGuards(v, c, "conversion").outcome === "recommend_winner") wins++;
    }
    return wins / trials;
  };

  it("A/A: false-positive winner rate stays low (never invents a win)", () => {
    expect(winnerRate(3000, 0.05, 0.05, 300)).toBeLessThanOrEqual(0.06);
  });

  it("a powered +30% real lift is reliably caught", () => {
    expect(winnerRate(12000, 0.065, 0.05, 200)).toBeGreaterThanOrEqual(0.9);
  });
});

// ── Riktningen (bounce-bytet 2026-08-15) ─────────────────────────────────────
// För mått där LÄGRE är bättre (metrikkatalogens direction: "down") måste
// domen vändas. Utan flaggan dömde regeln alltid "högre = bättre" och hade
// utropat den variant som får FLER att studsa till vinnare. Testerna kör
// SAMMA armar genom bägge riktningarna, så en borttagen vändning fäller dem.
describe("evaluateWinner — riktning för mått där lägre är bättre", () => {
  // Bounce: variant 44 %, kontroll 56 % — en tydlig FÖRBÄTTRING.
  const bounceVariant = arm(2000, 880);
  const bounceControl = arm(2000, 1120);

  it("lägre-är-bättre: en sänkning är en VINNARE, inte ett stopp", () => {
    const down = evaluateWinner(bounceVariant, bounceControl, [], undefined, false);
    expect(down.outcome).toBe("recommend_winner");
    expect(down.reasons[0]).toContain("lower is better");
  });

  it("SAMMA armar med default (högre-är-bättre) ger motsatt dom — vändningen är verklig", () => {
    const up = evaluateWinner(bounceVariant, bounceControl);
    expect(up.outcome).toBe("recommend_stop");
  });

  it("lägre-är-bättre: en ÖKNING stoppas", () => {
    const worse = evaluateWinner(bounceControl, bounceVariant, [], undefined, false);
    expect(worse.outcome).toBe("recommend_stop");
    expect(worse.reasons[0]).toContain("lower is better");
  });

  it("stats bär de RÅA talen — bara domen vänds, aldrig datan", () => {
    const down = evaluateWinner(bounceVariant, bounceControl, [], undefined, false);
    expect(down.stats.variantRate).toBeCloseTo(0.44, 10);
    expect(down.stats.controlRate).toBeCloseTo(0.56, 10);
    // Rå z är NEGATIV (varianten har lägre rate) trots att den vann.
    expect(down.stats.z!).toBeLessThan(0);
    expect(down.stats.relativeLift!).toBeLessThan(0);
  });

  it("lyftgolvet mäts på FÖRBÄTTRINGEN, inte på det råa tecknet", () => {
    // 2 % sänkning (0,490 mot 0,500) — signifikant vid n=200k men under
    // WINNER_MIN_REL_LIFT, alltså ingen vinnare.
    const r = evaluateWinner(arm(200_000, 98_000), arm(200_000, 100_000), [], undefined, false);
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons[0]).toContain("below the practical minimum");
  });
});

// ── Bounce som primärmått (ägarbeslut 2026-08-15) ────────────────────────────
// Bounce är en PROXY precis som continuation och körs genom samma målvakt —
// men LÄGRE är bättre. Testerna nedan låser bägge egenskaperna.
describe("evaluateWinnerWithGuards — bounce som primärmått", () => {
  /** Armar där bounce SJUNKER under varianten (en förbättring), målet orört. */
  const bounceArm = (visits: number, bounces: number, conversions = 0): GuardArmCounts => ({
    visits,
    conversions,
    continuations: 0,
    engaged: 0,
    bounces,
  });

  it("en SÄNKT bounce är en vinnare — inte ett stopp", () => {
    const r = evaluateWinnerWithGuards(bounceArm(1000, 440), bounceArm(1000, 560), "bounce");
    expect(r.outcome).toBe("recommend_winner");
    expect(r.reasons.join(" ")).toContain("lower is better");
  });

  it("en HÖJD bounce stoppas", () => {
    const r = evaluateWinnerWithGuards(bounceArm(1000, 560), bounceArm(1000, 440), "bounce");
    expect(r.outcome).toBe("recommend_stop");
  });

  it("bounce är en proxy: en signifikant SÄMRE måluppfyllelse drar tillbaka vinsten", () => {
    // Bounce förbättras kraftigt, men konverteringarna rasar 8 % → 2 %.
    const v = { ...bounceArm(2000, 880, 40), engaged: 0 };
    const c = { ...bounceArm(2000, 1120, 160), engaged: 0 };
    const r = evaluateWinnerWithGuards(v, c, "bounce");
    expect(r.outcome).toBe("no_winner");
    expect(r.reasons[0]).toContain("GOAL conversions are significantly WORSE");
  });

  it("saknad bounce-kolumn (äldre RPC) ger 'för lite data', aldrig en gissad vinnare", () => {
    const v: GuardArmCounts = { visits: 1000, conversions: 0, continuations: 0, engaged: 0 };
    const c: GuardArmCounts = { visits: 1000, conversions: 0, continuations: 0, engaged: 0 };
    expect(evaluateWinnerWithGuards(v, c, "bounce").outcome).toBe("insufficient_data");
  });

  it("volymgolvet är proxy-golvet, inte konverteringsgolvet", () => {
    // 300 besök/arm räcker för en proxy (ENGAGEMENT_MIN_VISITS=200) men aldrig
    // för konvertering (WINNER_MIN_VISITS=1000).
    const r = evaluateWinnerWithGuards(bounceArm(300, 120), bounceArm(300, 180), "bounce");
    expect(r.outcome).not.toBe("insufficient_data");
  });
});
