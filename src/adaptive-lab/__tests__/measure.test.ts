// Measurement math — pinned against known statistical values.
import { describe, expect, it } from "vitest";

import {
  GUARDRAIL_ALPHA,
  checkGuardrail,
  evaluateRuleMetrics,
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

describe("checkGuardrail", () => {
  it("breaches when a lower-is-better metric rises sharply (bounce up)", () => {
    // 54% vs 45% bounce at 5000/arm — unmistakable harm.
    const g = checkGuardrail("bounce", "down", { n: 5000, conversions: 2700 }, { n: 5000, conversions: 2250 });
    expect(g.breached).toBe(true);
    expect(g.pHarm).toBeLessThan(0.0001);
  });
  it("does not breach when the same metric improves, however significantly", () => {
    const g = checkGuardrail("bounce", "down", { n: 5000, conversions: 2000 }, { n: 5000, conversions: 2250 });
    expect(g.breached).toBe(false);
    expect(g.pHarm).toBeGreaterThan(0.5);
  });
  it("breaches when a higher-is-better metric drops (engagement down)", () => {
    const g = checkGuardrail("engaged", "up", { n: 5000, conversions: 1650 }, { n: 5000, conversions: 1900 });
    expect(g.breached).toBe(true);
  });
  it("does not breach when a higher-is-better metric rises", () => {
    const g = checkGuardrail("engaged", "up", { n: 5000, conversions: 1900 }, { n: 5000, conversions: 1650 });
    expect(g.breached).toBe(false);
  });
  it("never breaches on thin arms", () => {
    const g = checkGuardrail("bounce", "down", { n: 200, conversions: 150 }, { n: 200, conversions: 50 });
    expect(g.breached).toBe(false);
    expect(g.reason).toContain("not enough data");
  });
  it("holds the stricter bar: harm significant at 5% but not at 1% is NOT a breach", () => {
    // 46% vs 44% bounce at 4000/arm → one-sided p ≈ 0.036: would trip a 5%
    // test, must not trip the guardrail.
    const g = checkGuardrail("bounce", "down", { n: 4000, conversions: 1840 }, { n: 4000, conversions: 1760 });
    expect(g.pHarm).toBeGreaterThan(GUARDRAIL_ALPHA);
    expect(g.pHarm).toBeLessThan(0.05);
    expect(g.breached).toBe(false);
  });
});

describe("evaluateRuleMetrics", () => {
  const flat = (rate: number, n = 5000) => ({
    served: { n, conversions: Math.round(rate * n) },
    holdout: { n, conversions: Math.round(rate * n) },
  });

  it("pauses a gamed proxy: primary win + guardrail harm → guardrail_breach", () => {
    const ruling = evaluateRuleMetrics(
      "cta_click",
      { served: { n: 5000, conversions: 340 }, holdout: { n: 5000, conversions: 250 } },
      [
        { metric: "bounce", direction: "down", served: { n: 5000, conversions: 2700 }, holdout: { n: 5000, conversions: 2250 } },
        { metric: "conversion", direction: "up", ...flat(0.045) },
      ],
    );
    expect(ruling.primary.verdict).toBe("win"); // the naive read
    expect(ruling.verdict).toBe("guardrail_breach");
    expect(ruling.action).toBe("pause");
    expect(ruling.reason).toContain('"win"');
  });
  it("clean win with quiet guardrails → win + extend", () => {
    const ruling = evaluateRuleMetrics(
      "conversion",
      { served: { n: 5000, conversions: 300 }, holdout: { n: 5000, conversions: 200 } },
      [
        { metric: "bounce", direction: "down", ...flat(0.45) },
        { metric: "engaged", direction: "up", ...flat(0.4) },
      ],
    );
    expect(ruling.verdict).toBe("win");
    expect(ruling.action).toBe("extend");
  });
  it("a significant primary loss pauses even with quiet guardrails", () => {
    const ruling = evaluateRuleMetrics(
      "conversion",
      { served: { n: 5000, conversions: 200 }, holdout: { n: 5000, conversions: 300 } },
      [{ metric: "bounce", direction: "down", ...flat(0.45) }],
    );
    expect(ruling.verdict).toBe("loss");
    expect(ruling.action).toBe("pause");
  });
  it("thin primary with no breach keeps measuring", () => {
    const ruling = evaluateRuleMetrics(
      "conversion",
      { served: { n: 150, conversions: 8 }, holdout: { n: 140, conversions: 5 } },
      [{ metric: "bounce", direction: "down", ...flat(0.45) }],
    );
    expect(ruling.verdict).toBe("inconclusive");
    expect(ruling.action).toBe("keep_measuring");
  });
  it("no_effect with real precision (CI excludes ±MDE) → retire_or_redesign", () => {
    // 4.0% both arms at 25k/arm → rel CI ≈ ±8.6%, inside the ±10% MDE.
    const ruling = evaluateRuleMetrics(
      "conversion",
      { served: { n: 25000, conversions: 1000 }, holdout: { n: 25000, conversions: 1002 } },
      [],
    );
    expect(ruling.verdict).toBe("no_effect");
    expect(ruling.action).toBe("retire_or_redesign");
    expect(ruling.reason).toContain("excludes");
  });
  it("no_effect but underpowered vs MDE → keep_measuring, never retire", () => {
    // Same flat rates at 8k/arm → rel CI ≈ ±15%: a true +10-30% winner could
    // hide in there, so an unlucky world must not retire it.
    const ruling = evaluateRuleMetrics(
      "conversion",
      { served: { n: 8000, conversions: 320 }, holdout: { n: 8000, conversions: 322 } },
      [],
    );
    expect(ruling.verdict).toBe("no_effect");
    expect(ruling.action).toBe("keep_measuring");
    expect(ruling.reason).toContain("underpowered");
  });
});
