// Measurement math — pinned against known statistical values.
import { describe, expect, it } from "vitest";

import {
  measureRule,
  normalCdf,
  twoProportionTest,
  wilsonInterval,
} from "../measure";

describe("normalCdf", () => {
  it("matches standard normal table values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
    expect(normalCdf(2.5758)).toBeCloseTo(0.995, 3);
  });
});

describe("wilsonInterval", () => {
  it("matches the textbook example (10/50)", () => {
    const [lo, hi] = wilsonInterval(10, 50);
    expect(lo).toBeCloseTo(0.112, 2);
    expect(hi).toBeCloseTo(0.331, 2);
  });
  it("stays inside [0,1] at the extremes", () => {
    expect(wilsonInterval(0, 20)[0]).toBe(0);
    expect(wilsonInterval(20, 20)[1]).toBe(1);
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });
});

describe("twoProportionTest", () => {
  it("z≈0 for identical arms", () => {
    const { z, p } = twoProportionTest({ n: 1000, conversions: 40 }, { n: 1000, conversions: 40 });
    expect(z).toBeCloseTo(0, 6);
    expect(p).toBeCloseTo(1, 6);
  });
  it("detects a large known difference", () => {
    // 6% vs 4% at n=5000/arm → z ≈ 4.55 (hand-checked)
    const { z, p } = twoProportionTest(
      { n: 5000, conversions: 300 },
      { n: 5000, conversions: 200 },
    );
    expect(z).toBeGreaterThan(4.3);
    expect(z).toBeLessThan(4.8);
    expect(p).toBeLessThan(0.0001);
  });
});

describe("measureRule verdict gates", () => {
  it("refuses verdicts on thin arms", () => {
    const r = measureRule({ n: 120, conversions: 9 }, { n: 118, conversions: 3 });
    expect(r.verdict).toBe("inconclusive");
    expect(r.reason).toContain("below");
  });
  it("refuses verdicts on too few conversions even with big arms", () => {
    const r = measureRule({ n: 5000, conversions: 4 }, { n: 5000, conversions: 3 });
    expect(r.verdict).toBe("inconclusive");
  });
  it("calls the win when the data is there", () => {
    const r = measureRule({ n: 5000, conversions: 300 }, { n: 5000, conversions: 200 });
    expect(r.verdict).toBe("win");
    expect(r.upliftRel).toBeCloseTo(0.5, 2);
  });
  it("calls the loss in the other direction", () => {
    const r = measureRule({ n: 5000, conversions: 200 }, { n: 5000, conversions: 300 });
    expect(r.verdict).toBe("loss");
  });
  it("calls no_effect for equal arms with plenty of data", () => {
    const r = measureRule({ n: 8000, conversions: 320 }, { n: 8000, conversions: 322 });
    expect(r.verdict).toBe("no_effect");
  });
});
