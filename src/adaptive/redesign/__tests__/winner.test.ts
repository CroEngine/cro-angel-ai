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
    const r = evaluateWinner(arm(WINNER_MIN_VISITS, WINNER_MIN_CONVERSIONS), arm(WINNER_MIN_VISITS, WINNER_MIN_CONVERSIONS));
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
      { name: "return-visit rate", variantRate: 0.10, controlRate: 0.20, higherIsBetter: true },
    ];
    expect(evaluateWinner(arm(5000, 350), arm(5000, 250), dropInGoodMetric).outcome).toBe("no_winner");
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
