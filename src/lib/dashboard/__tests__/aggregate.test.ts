import { describe, it, expect } from "vitest";

import { aggregate, type DashEvent, type InventoryEntry } from "../aggregate";

function ev(
  type: string,
  payload: Record<string, unknown> = {},
  over: Partial<DashEvent> = {},
): DashEvent {
  return {
    type,
    payload,
    visitorHash: null,
    decisionId: null,
    createdAt: "2026-06-27T00:00:00Z",
    ...over,
  };
}

describe("aggregate", () => {
  const events: DashEvent[] = [
    ev(
      "pageview",
      { trafficSource: "linkedin", device: "desktop" },
      { visitorHash: "a", createdAt: "2026-06-27T10:00:00Z" },
    ),
    ev(
      "pageview",
      { trafficSource: "google", device: "mobile" },
      { visitorHash: "b", createdAt: "2026-06-27T11:00:00Z" },
    ),
    ev(
      "pageview",
      { trafficSource: "linkedin", device: "mobile" },
      { visitorHash: "a", createdAt: "2026-06-27T12:00:00Z" },
    ),
    ev(
      "adaptation_shown",
      {
        patterns: ["clarify_cta", "show_trust_badge"],
        trafficSource: "linkedin",
        device: "desktop",
      },
      { decisionId: "d1", createdAt: "2026-06-27T10:00:01Z" },
    ),
    ev(
      "adaptation_shown",
      { patterns: ["clarify_cta"], trafficSource: "google", device: "mobile" },
      { decisionId: "d2", createdAt: "2026-06-27T11:00:01Z" },
    ),
    ev("cta_click", { text: "Book a demo" }, { visitorHash: "a" }),
    ev("conversion", {}, { visitorHash: "a" }),
  ];

  const inventory: InventoryEntry[] = [
    { slot: "cta", id: "cta-0", text: "Book a demo", selector: "#cta", meta: { intent: "demo" } },
    {
      slot: "cta",
      id: "cta-1",
      text: "Start Free Trial",
      selector: "#cta",
      meta: { intent: "trial" },
    },
    { slot: "hero", id: "hero-0", text: null, selector: "#hero", meta: {} },
  ];

  const m = aggregate(events, inventory);

  it("computes overview counts", () => {
    expect(m.overview.pageviews).toBe(3);
    expect(m.overview.uniqueVisitors).toBe(2); // a, b
    expect(m.overview.adaptationsShown).toBe(2);
    expect(m.overview.ctaClicks).toBe(1);
    expect(m.overview.conversions).toBe(1);
    expect(m.overview.conversionRate).toBeCloseTo(1 / 3);
  });

  it("segments pageviews by traffic source and device (sorted desc)", () => {
    expect(m.segments.byTrafficSource[0]).toEqual({ key: "linkedin", pageviews: 2 });
    expect(m.segments.byTrafficSource.find((s) => s.key === "google")?.pageviews).toBe(1);
    expect(m.segments.byDevice.find((s) => s.key === "mobile")?.pageviews).toBe(2);
  });

  it("ranks adaptations by frequency", () => {
    expect(m.performance[0]).toEqual({ pattern: "clarify_cta", shown: 2 });
    expect(m.performance.find((p) => p.pattern === "show_trust_badge")?.shown).toBe(1);
  });

  it("lists live adaptations newest-first with their patterns", () => {
    expect(m.liveAdaptations[0].decisionId).toBe("d2"); // 11:00:01 > 10:00:01
    expect(m.liveAdaptations[0].patterns).toEqual(["clarify_cta"]);
    expect(m.liveAdaptations[1].decisionId).toBe("d1");
  });

  it("groups inventory by slot", () => {
    const cta = m.inventory.find((g) => g.slot === "cta");
    expect(cta?.items.length).toBe(2);
    expect(m.inventory.find((g) => g.slot === "hero")?.items.length).toBe(1);
  });

  it("handles an empty dataset without throwing", () => {
    const empty = aggregate([], []);
    expect(empty.overview.pageviews).toBe(0);
    expect(empty.overview.conversionRate).toBe(0);
    expect(empty.performance).toEqual([]);
    expect(empty.attribution).toEqual([]);
    expect(empty.inventory).toEqual([]);
  });
});

describe("aggregate — attribution (what's working)", () => {
  // Two patterns. show_trust_badge has a holdout (control) group; clarify_cta
  // has none. Conversions are joined to exposures by visitorHash within 24 h.
  const T = (h: number) => `2026-06-27T${String(h).padStart(2, "0")}:00:00Z`;
  const shown = (visitor: string, patterns: string[], hour: number): DashEvent =>
    ev("adaptation_shown", { patterns }, { visitorHash: visitor, createdAt: T(hour) });
  const withheld = (visitor: string, patterns: string[], hour: number): DashEvent =>
    ev("adaptation_withheld", { patterns }, { visitorHash: visitor, createdAt: T(hour) });
  const conv = (visitor: string, hour: number): DashEvent =>
    ev("conversion", {}, { visitorHash: visitor, createdAt: T(hour) });

  const events: DashEvent[] = [
    // adapted: v1,v2,v3 exposed to show_trust_badge; v1 & v2 convert -> 2/3
    shown("v1", ["show_trust_badge", "clarify_cta"], 9),
    shown("v2", ["show_trust_badge"], 9),
    shown("v3", ["show_trust_badge"], 9),
    conv("v1", 10),
    conv("v2", 11),
    // control (withheld): v4,v5 held out; only v4 converts -> 1/2
    withheld("v4", ["show_trust_badge"], 9),
    withheld("v5", ["show_trust_badge"], 9),
    conv("v4", 10),
    // clarify_cta adapted only: v1 exposed, v1 converted -> 1/1, no control
    // a conversion OUTSIDE the 24h window must not count
    shown("v6", ["clarify_cta"], 0),
    conv("v6", 23 /* +23h ok */),
  ];

  const m = aggregate(events, []);
  const badge = m.attribution.find((a) => a.pattern === "show_trust_badge")!;
  const cta = m.attribution.find((a) => a.pattern === "clarify_cta")!;

  it("counts distinct-visitor exposures and conversions per variant", () => {
    expect(badge.adapted.exposures).toBe(3);
    expect(badge.adapted.conversions).toBe(2);
    expect(badge.adapted.rate).toBeCloseTo(2 / 3);
    expect(badge.control.exposures).toBe(2);
    expect(badge.control.conversions).toBe(1);
    expect(badge.control.rate).toBeCloseTo(1 / 2);
  });

  it("computes lift = adapted − control when a control group exists", () => {
    expect(badge.lift).toBeCloseTo(2 / 3 - 1 / 2);
    expect(badge.z).not.toBeNull();
  });

  it("reports null lift and no significance when there is no control group", () => {
    expect(cta.control.exposures).toBe(0);
    expect(cta.lift).toBeNull();
    expect(cta.z).toBeNull();
    expect(cta.significant).toBe(false);
  });

  it("attributes a conversion within the 24h window", () => {
    expect(cta.adapted.exposures).toBe(2); // v1 (9h) + v6 (0h)
    // v1 converted at 10h (within window of its 9h exposure); v6 at 23h (within
    // 24h of its 0h exposure) -> both count
    expect(cta.adapted.conversions).toBe(2);
  });

  it("ignores exposures without a visitorHash", () => {
    const anon = aggregate(
      [
        ev("adaptation_shown", { patterns: ["clarify_cta"] }, { createdAt: T(9) }),
        ev("conversion", {}, { createdAt: T(10) }),
      ],
      [],
    );
    expect(anon.attribution).toEqual([]);
  });

  it("does not count a conversion that happened before the exposure", () => {
    const pre = aggregate(
      [
        ev("conversion", {}, { visitorHash: "z", createdAt: T(8) }),
        ev("adaptation_shown", { patterns: ["clarify_cta"] }, { visitorHash: "z", createdAt: T(9) }),
      ],
      [],
    );
    const row = pre.attribution.find((a) => a.pattern === "clarify_cta")!;
    expect(row.adapted.exposures).toBe(1);
    expect(row.adapted.conversions).toBe(0);
  });
});

describe("aggregate — significance requires an adequate sample", () => {
  const T = (h: number) => `2026-06-27T${String(h).padStart(2, "0")}:00:00Z`;
  // Build one pattern's arms from (exposures, conversions) per variant.
  function build(
    adapted: { n: number; c: number },
    control: { n: number; c: number },
  ): DashEvent[] {
    const out: DashEvent[] = [];
    const arm = (prefix: string, type: string, n: number, c: number) => {
      for (let i = 0; i < n; i++) {
        const v = `${prefix}${i}`;
        out.push(ev(type, { patterns: ["clarify_cta"] }, { visitorHash: v, createdAt: T(9) }));
        if (i < c) out.push(ev("conversion", {}, { visitorHash: v, createdAt: T(10) }));
      }
    };
    arm("a", "adaptation_shown", adapted.n, adapted.c);
    arm("c", "adaptation_withheld", control.n, control.c);
    return out;
  }
  const row = (evs: DashEvent[]) =>
    aggregate(evs, []).attribution.find((a) => a.pattern === "clarify_cta")!;

  it("is NOT significant on a tiny lucky sample (3/3 vs 0/3)", () => {
    // z here exceeds 1.96, but the sample fails the success–failure condition.
    const r = row(build({ n: 3, c: 3 }, { n: 3, c: 0 }));
    expect(r.z).not.toBeNull();
    expect(Math.abs(r.z as number)).toBeGreaterThan(1.96);
    expect(r.significant).toBe(false);
  });

  it("IS significant once both arms are adequately powered", () => {
    // 40 vs 40 exposures, 20 vs 5 conversions — valid arms + a real gap.
    const r = row(build({ n: 40, c: 20 }, { n: 40, c: 5 }));
    expect(r.lift).toBeCloseTo(20 / 40 - 5 / 40);
    expect(r.significant).toBe(true);
  });

  it("is NOT significant when an arm has too few outcomes (below-threshold conversions)", () => {
    // 40 vs 40 exposures but only 2 conversions in the adapted arm.
    const r = row(build({ n: 40, c: 2 }, { n: 40, c: 0 }));
    expect(r.significant).toBe(false);
  });
});
