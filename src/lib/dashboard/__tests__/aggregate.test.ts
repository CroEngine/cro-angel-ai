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
    expect(empty.inventory).toEqual([]);
  });
});
