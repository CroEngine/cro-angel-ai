import { describe, it, expect } from "vitest";

import {
  aggregate,
  bucketByTime,
  summarizeVisitors,
  MAX_DAY_POINTS,
  MAX_VISITORS,
  type DashEvent,
  type InventoryEntry,
} from "../aggregate";

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

describe("bucketByTime — visitors over time", () => {
  const ev2 = (
    type: string,
    createdAt: string,
    visitorHash: string | null = null,
    payload: Record<string, unknown> = {},
  ): DashEvent => ({ type, payload, visitorHash, decisionId: null, createdAt });

  it("buckets exposures per day, counts identified visitors distinct, gap-fills", () => {
    const { daily } = bucketByTime([
      ev2("adaptation_shown", "2026-06-25T10:00:00Z", "a"),
      ev2("adaptation_shown", "2026-06-25T11:00:00Z", "a"), // same visitor, 2 visits
      ev2("adaptation_withheld", "2026-06-25T12:00:00Z", null), // anonymous still a visit
      // 26th has no events — must appear as a zero bucket
      ev2("adaptation_shown", "2026-06-27T09:00:00Z", "b"),
      ev2("conversion", "2026-06-27T10:00:00Z", "b"),
    ]);
    expect(daily.map((d) => d.day)).toEqual(["2026-06-25", "2026-06-26", "2026-06-27"]);
    expect(daily[0]).toEqual({ day: "2026-06-25", visits: 3, identified: 1, conversions: 0 });
    expect(daily[1]).toEqual({ day: "2026-06-26", visits: 0, identified: 0, conversions: 0 });
    expect(daily[2]).toEqual({ day: "2026-06-27", visits: 1, identified: 1, conversions: 1 });
  });

  it("produces a full 24-hour profile with visits in the right buckets", () => {
    const { hourly } = bucketByTime([
      ev2("adaptation_shown", "2026-06-25T09:15:00Z", "a"),
      ev2("adaptation_shown", "2026-06-26T09:45:00Z", "b"), // different day, same hour
      ev2("adaptation_shown", "2026-06-25T22:00:00Z", "a"),
    ]);
    expect(hourly).toHaveLength(24);
    expect(hourly[9]).toEqual({ hour: 9, visits: 2, identified: 2 });
    expect(hourly[22]).toEqual({ hour: 22, visits: 1, identified: 1 });
    expect(hourly[0].visits).toBe(0);
  });

  it("shifts buckets into the display timezone (Stockholm summer = −120)", () => {
    // 23:30 UTC on the 25th is 01:30 local on the 26th.
    const { daily, hourly } = bucketByTime(
      [ev2("adaptation_shown", "2026-06-25T23:30:00Z", "a")],
      -120,
    );
    expect(daily).toEqual([{ day: "2026-06-26", visits: 1, identified: 1, conversions: 0 }]);
    expect(hourly[1].visits).toBe(1);
    expect(hourly[23].visits).toBe(0);
  });

  it("caps the daily series at MAX_DAY_POINTS (newest kept)", () => {
    const { daily } = bucketByTime([
      ev2("adaptation_shown", "2025-01-01T10:00:00Z", "old"),
      ev2("adaptation_shown", "2026-06-27T10:00:00Z", "new"),
    ]);
    expect(daily).toHaveLength(MAX_DAY_POINTS);
    expect(daily[daily.length - 1].day).toBe("2026-06-27");
  });

  it("returns empty daily and a zero hourly profile for no events", () => {
    const { daily, hourly } = bucketByTime([]);
    expect(daily).toEqual([]);
    expect(hourly.every((h) => h.visits === 0 && h.identified === 0)).toBe(true);
  });
});

describe("summarizeVisitors — per-visitor footprints", () => {
  const ev2 = (
    type: string,
    createdAt: string,
    visitorHash: string | null,
    payload: Record<string, unknown> = {},
  ): DashEvent => ({ type, payload, visitorHash, decisionId: null, createdAt });

  it("groups one visitor's events into a footprint", () => {
    const [v] = summarizeVisitors([
      ev2("adaptation_shown", "2026-06-25T10:00:00Z", "a", { patterns: ["emphasize_goal"] }),
      ev2("pageview", "2026-06-25T10:00:01Z", "a", {
        device: "mobile",
        country: "SE",
        trafficSource: "google",
        browser: "Chrome",
      }),
      ev2("scroll_depth", "2026-06-25T10:01:00Z", "a", { depth: 50 }),
      ev2("scroll_depth", "2026-06-25T10:02:00Z", "a", { depth: 75 }),
      ev2("cta_click", "2026-06-25T10:03:00Z", "a", { text: "Skapa konto" }),
      ev2("conversion", "2026-06-25T10:04:00Z", "a"),
    ]);
    expect(v.hash).toBe("a");
    expect(v.firstSeen).toBe("2026-06-25T10:00:00Z");
    expect(v.lastSeen).toBe("2026-06-25T10:04:00Z");
    expect(v.pageviews).toBe(1);
    expect(v.ctaClicks).toBe(1);
    expect(v.maxScroll).toBe(75);
    expect(v.conversions).toBe(1);
    expect(v.patterns).toEqual(["emphasize_goal"]);
    expect(v.arm).toBe("adapted");
    expect(v.device).toBe("mobile");
    expect(v.country).toBe("SE");
  });

  it("takes context columns from the NEWEST pageview regardless of input order", () => {
    // getDashboard feeds events newest-first — the newer pageview's context
    // must win even when it is processed before the older one.
    const [v] = summarizeVisitors([
      ev2("pageview", "2026-06-26T10:00:00Z", "a", { device: "desktop", trafficSource: "direct" }),
      ev2("pageview", "2026-06-25T10:00:00Z", "a", { device: "mobile", trafficSource: "google" }),
    ]);
    expect(v.device).toBe("desktop");
    expect(v.trafficSource).toBe("direct");
    expect(v.firstSeen).toBe("2026-06-25T10:00:00Z");
    expect(v.lastSeen).toBe("2026-06-26T10:00:00Z");
  });

  it("marks the control arm and excludes anonymous events", () => {
    const out = summarizeVisitors([
      ev2("adaptation_withheld", "2026-06-25T10:00:00Z", "c", { patterns: ["emphasize_goal"] }),
      ev2("adaptation_shown", "2026-06-25T10:00:00Z", null, { patterns: ["emphasize_goal"] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].arm).toBe("control");
  });

  it("sorts by most recent activity and caps at MAX_VISITORS", () => {
    const events: DashEvent[] = [];
    for (let i = 0; i < MAX_VISITORS + 10; i++) {
      const hh = String(Math.floor(i / 60)).padStart(2, "0");
      const mm = String(i % 60).padStart(2, "0");
      events.push(ev2("pageview", `2026-06-25T${hh}:${mm}:00Z`, `v${i}`));
    }
    const out = summarizeVisitors(events);
    expect(out).toHaveLength(MAX_VISITORS);
    expect(out[0].hash).toBe(`v${MAX_VISITORS + 9}`); // newest first
  });

  it("rides along in aggregate() with the timeseries", () => {
    const m = aggregate(
      [ev2("adaptation_shown", "2026-06-25T10:00:00Z", "a", { patterns: [] })],
      [],
      { tzOffsetMinutes: 0 },
    );
    expect(m.timeseries.daily).toHaveLength(1);
    expect(m.visitors).toHaveLength(1);
  });
});

describe("attribute — micro-conversions (engagement on the way to the goal)", () => {
  const T0 = Date.parse("2026-06-25T09:00:00Z");
  const at = (offsetH: number) => new Date(T0 + offsetH * 3600_000).toISOString();
  const ev3 = (
    type: string,
    offsetH: number,
    visitorHash: string,
    payload: Record<string, unknown> = {},
  ): DashEvent => ({ type, payload, visitorHash, decisionId: null, createdAt: at(offsetH) });

  it("counts deep scroll, multi-page and return per exposed visitor and arm", () => {
    const rows = aggregate(
      [
        // v1 (adapted): deep scroll + two pageviews inside 24h + a return on day 3
        ev3("adaptation_shown", 0, "v1", { patterns: ["emphasize_goal"] }),
        ev3("scroll_depth", 1, "v1", { depth: 75 }),
        ev3("pageview", 1, "v1"),
        ev3("pageview", 2, "v1"),
        ev3("pageview", 70, "v1"), // day 3 → returned
        // v2 (adapted): shallow scroll only — no micro-conversions
        ev3("adaptation_shown", 0, "v2", { patterns: ["emphasize_goal"] }),
        ev3("scroll_depth", 1, "v2", { depth: 50 }),
        ev3("pageview", 1, "v2"),
        // v3 (control): deep scroll only
        ev3("adaptation_withheld", 0, "v3", { patterns: ["emphasize_goal"] }),
        ev3("scroll_depth", 2, "v3", { depth: 100 }),
      ],
      [],
    ).attribution.find((r) => r.pattern === "emphasize_goal")!;

    expect(rows.adapted.exposures).toBe(2);
    expect(rows.adaptedMicro).toEqual({ deepScroll: 1, multiPage: 1, returned: 1 });
    expect(rows.control.exposures).toBe(1);
    expect(rows.controlMicro).toEqual({ deepScroll: 1, multiPage: 0, returned: 0 });
  });

  it("ignores activity outside the windows", () => {
    const row = aggregate(
      [
        ev3("adaptation_shown", 0, "v1", { patterns: ["emphasize_goal"] }),
        ev3("scroll_depth", 30, "v1", { depth: 100 }), // after 24h window
        ev3("pageview", 24 * 8, "v1"), // after the 7-day return horizon
      ],
      [],
    ).attribution.find((r) => r.pattern === "emphasize_goal")!;
    expect(row.adaptedMicro).toEqual({ deepScroll: 0, multiPage: 0, returned: 0 });
  });
});
