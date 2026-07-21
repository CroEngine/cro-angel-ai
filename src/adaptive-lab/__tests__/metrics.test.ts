// Metric catalog + success spec — the contract layer over the measurement math.
import { describe, expect, it } from "vitest";

import {
  DEEP_SCROLL_PCT,
  ENGAGED_MS,
  ENGAGED_SCROLL_PCT,
  METRIC_CATALOG,
  SITE_TYPE_PRESETS,
  defaultSuccessSpec,
  deriveViewMetrics,
  estimateVerdictTime,
  evaluateRuleWithSpec,
  metricById,
  validateSuccessSpec,
} from "../metrics";

describe("METRIC_CATALOG", () => {
  it("has unique ids and a direction on every metric", () => {
    const ids = METRIC_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of METRIC_CATALOG) expect(m.direction === "up" || m.direction === "down").toBe(true);
  });
  it("bounce is the lower-is-better one", () => {
    expect(metricById("bounce")?.direction).toBe("down");
    expect(metricById("conversion")?.direction).toBe("up");
  });
  it("every preset references only catalog metrics", () => {
    for (const spec of Object.values(SITE_TYPE_PRESETS)) {
      expect(metricById(spec.primary)).not.toBeNull();
      for (const g of spec.guardrails) expect(metricById(g)).not.toBeNull();
    }
  });
});

describe("validateSuccessSpec", () => {
  it("accepts and normalizes a valid spec", () => {
    const s = validateSuccessSpec({
      primary: "conversion",
      guardrails: ["bounce", "bounce", "conversion", "engaged"],
      mdeRel: 0.15,
    });
    expect(s).toEqual({ primary: "conversion", guardrails: ["bounce", "engaged"], mdeRel: 0.15 });
  });
  it("rejects unknown metric ids", () => {
    expect(validateSuccessSpec({ primary: "revenue", guardrails: [] })).toBeNull();
    expect(validateSuccessSpec({ primary: "conversion", guardrails: ["happiness"] })).toBeNull();
  });
  it("rejects broken shapes and bad MDE", () => {
    expect(validateSuccessSpec(null)).toBeNull();
    expect(validateSuccessSpec({ primary: "conversion" })).toBeNull();
    expect(validateSuccessSpec({ primary: "conversion", guardrails: [], mdeRel: 0 })).toBeNull();
    expect(validateSuccessSpec({ primary: "conversion", guardrails: [], mdeRel: 2 })).toBeNull();
  });
  it("defaultSuccessSpec: saas judges on conversion, protected by bounce+engagement", () => {
    const s = defaultSuccessSpec();
    expect(s.primary).toBe("conversion");
    expect(s.guardrails).toEqual(["bounce", "engaged"]);
    expect(s.mdeRel).toBeGreaterThan(0);
  });
});

describe("estimateVerdictTime", () => {
  it("matches the hand math for a 4% conversion primary", () => {
    // +30% MDE on 4% base at 80% power → ~4 187/arm; 300/day at ramp 50 → 28 d.
    const est = estimateVerdictTime({ dailyMatchedVisitors: 300, baseRate: 0.04, mdeRel: 0.3 });
    expect(est.nPerArm).toBeGreaterThan(4100);
    expect(est.nPerArm).toBeLessThan(4300);
    expect(est.days).toBe(Math.ceil(est.nPerArm / 150));
  });
  it("shows the proxy speedup: engagement needs ~20× fewer visitors than conversion", () => {
    const conv = estimateVerdictTime({ dailyMatchedVisitors: 300, baseRate: 0.04, mdeRel: 0.3 });
    const engaged = estimateVerdictTime({ dailyMatchedVisitors: 300, baseRate: 0.4, mdeRel: 0.3 });
    expect(engaged.nPerArm).toBeLessThan(conv.nPerArm / 10);
  });
  it("never estimates below the verdict gates' own floor", () => {
    const est = estimateVerdictTime({ dailyMatchedVisitors: 10_000, baseRate: 0.5, mdeRel: 0.9 });
    expect(est.nPerArm).toBeGreaterThanOrEqual(300);
  });
});

describe("deriveViewMetrics", () => {
  it("derives the client-decidable metrics from a view's events + profile", () => {
    const m = deriveViewMetrics(
      [
        { type: "pageview" },
        { type: "cta_click" },
        { type: "scroll_depth", value: ENGAGED_SCROLL_PCT + 5 },
        { type: "time_on_page", value: 12_000 },
      ],
      { seenPricing: true, visits: 3 },
    );
    expect(m).toEqual({
      conversion: false,
      form_submit: false,
      cta_click: true,
      engaged: true,
      deep_scroll: false,
      pricing_view: true,
      return_visit: true,
    });
  });
  it("goal + form_submit events flip their metrics; dwell alone can engage", () => {
    const m = deriveViewMetrics([
      { type: "goal" },
      { type: "form_submit" },
      { type: "scroll_depth", value: DEEP_SCROLL_PCT },
      { type: "time_on_page", value: ENGAGED_MS },
    ]);
    expect(m.conversion).toBe(true);
    expect(m.form_submit).toBe(true);
    expect(m.deep_scroll).toBe(true);
    expect(m.engaged).toBe(true);
    expect(m.pricing_view).toBe(false);
    expect(m.return_visit).toBe(false);
  });
});

describe("evaluateRuleWithSpec", () => {
  it("rules the gamed proxy through a declared spec: primary win + bounce harm → pause", () => {
    const ruling = evaluateRuleWithSpec(
      { primary: "cta_click", guardrails: ["bounce", "conversion"] },
      {
        cta_click: {
          served: { n: 5000, conversions: 340 },
          holdout: { n: 5000, conversions: 250 },
        },
        bounce: {
          served: { n: 5000, conversions: 2700 },
          holdout: { n: 5000, conversions: 2250 },
        },
        conversion: {
          served: { n: 5000, conversions: 225 },
          holdout: { n: 5000, conversions: 225 },
        },
      },
    );
    expect(ruling.primary.verdict).toBe("win");
    expect(ruling.verdict).toBe("guardrail_breach");
    expect(ruling.action).toBe("pause");
    // Direction came from the catalog: bounce breached because UP is harm.
    expect(ruling.guardrails.find((g) => g.metric === "bounce")?.breached).toBe(true);
  });
  it("a guardrail with no data yet is 'not enough data', never a fabricated breach", () => {
    const ruling = evaluateRuleWithSpec(
      { primary: "conversion", guardrails: ["bounce"] },
      {
        conversion: {
          served: { n: 5000, conversions: 300 },
          holdout: { n: 5000, conversions: 200 },
        },
      },
    );
    expect(ruling.verdict).toBe("win");
    expect(ruling.guardrails[0].breached).toBe(false);
    expect(ruling.guardrails[0].reason).toContain("not enough data");
  });
});
