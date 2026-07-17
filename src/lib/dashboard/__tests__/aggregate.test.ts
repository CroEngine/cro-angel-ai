import { describe, it, expect } from "vitest";

import {
  aggregate,
  proofSummary,
  sessionSummaries,
  segmentSummaries,
  expandSegmentLeaves,
  attachRecent,
  rageSignals,
  clickHeat,
  bucketByTime,
  summarizeVisitors,
  MAX_DAY_POINTS,
  MAX_VISITORS,
  MAX_RAGE_SIGNALS,
  SEGMENT_MIN_VISITS,
  SEGMENT_MIN_CONVERSIONS,
  SEGMENT_MIN_DISPLAY,
  type DashEvent,
  type InventoryEntry,
  type SessionSummary,
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
    // Per-visitor rate (D1): 1 converted visitor of 2 identified — the same
    // species as the lift table's arms, not conversions/pageviews.
    expect(m.overview.conversionRate).toBeCloseTo(1 / 2);
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

describe("attribute — per-segment rows (D4) and non-converter micro stats (D2)", () => {
  const T0 = Date.parse("2026-06-25T09:00:00Z");
  const at = (offsetH: number) => new Date(T0 + offsetH * 3600_000).toISOString();
  const ev4 = (
    type: string,
    offsetH: number,
    visitorHash: string,
    payload: Record<string, unknown> = {},
  ): DashEvent => ({ type, payload, visitorHash, decisionId: null, createdAt: at(offsetH) });

  it("emits segment rows only where an arm is adequately powered", () => {
    const events: DashEvent[] = [];
    // 30 adapted + 30 control linkedin visitors → powered segment.
    for (let i = 0; i < 30; i++) {
      events.push(
        ev4("adaptation_shown", 0, `la${i}`, {
          patterns: ["clarify_cta"],
          trafficSource: "linkedin",
        }),
        ev4("adaptation_withheld", 0, `lc${i}`, {
          patterns: ["clarify_cta"],
          trafficSource: "linkedin",
        }),
      );
    }
    // 2 google_ads visitors → below MIN_ARM_EXPOSURES, no segment row.
    events.push(
      ev4("adaptation_shown", 0, "g1", { patterns: ["clarify_cta"], trafficSource: "google_ads" }),
      ev4("adaptation_shown", 0, "g2", { patterns: ["clarify_cta"], trafficSource: "google_ads" }),
    );

    const rows = aggregate(events, []).attribution.filter((r) => r.pattern === "clarify_cta");
    const overall = rows.find((r) => r.segment === null)!;
    expect(overall.adapted.exposures).toBe(32); // all traffic blended
    const segments = rows.filter((r) => r.segment !== null).map((r) => r.segment);
    expect(segments).toEqual(["linkedin"]); // google_ads too thin for a row
    const linkedin = rows.find((r) => r.segment === "linkedin")!;
    expect(linkedin.adapted.exposures).toBe(30);
    expect(linkedin.control.exposures).toBe(30);
  });

  it("does not count a converted visitor's engagement (they already gave the terminal signal)", () => {
    const row = aggregate(
      [
        // v1 converts AND deep-scrolls → must NOT count in micro stats.
        ev4("adaptation_shown", 0, "v1", { patterns: ["emphasize_goal"] }),
        ev4("scroll_depth", 1, "v1", { depth: 90 }),
        ev4("conversion", 2, "v1"),
        // v2 doesn't convert but deep-scrolls → counts.
        ev4("adaptation_shown", 0, "v2", { patterns: ["emphasize_goal"] }),
        ev4("scroll_depth", 1, "v2", { depth: 90 }),
      ],
      [],
    ).attribution.find((r) => r.pattern === "emphasize_goal" && r.segment === null)!;
    expect(row.adapted.conversions).toBe(1);
    expect(row.adaptedMicro.deepScroll).toBe(1); // v2 only — v1 is a converter
  });
});

describe("proofSummary — v1-beviset (adapterad vs hold-out)", () => {
  const T0 = "2026-07-01T10:00:00Z";
  const plus = (h: number) => new Date(Date.parse(T0) + h * 3600_000).toISOString();

  it("räknar armar per besökares FÖRSTA exponering med utfall i fönstret", () => {
    const events: DashEvent[] = [
      // Adapterad besökare: klickar CTA + konverterar + återkommer dag 2.
      ev("adaptation_shown", { patterns: ["emphasize_goal"] }, { visitorHash: "a", createdAt: T0 }),
      ev("cta_click", {}, { visitorHash: "a", createdAt: plus(0.1) }),
      ev("conversion", {}, { visitorHash: "a", createdAt: plus(0.2) }),
      ev("pageview", {}, { visitorHash: "a", createdAt: plus(26) }), // återbesök
      // Kontroll-besökare: tittar, gör inget, kommer inte tillbaka.
      ev("adaptation_withheld", { patterns: ["emphasize_goal"] }, { visitorHash: "b", createdAt: T0 }),
      ev("pageview", {}, { visitorHash: "b", createdAt: plus(0.01) }), // < 6h — inte återbesök
    ];
    const p = proofSummary(events)!;
    expect(p.holdoutActive).toBe(true);
    expect(p.adapted).toMatchObject({ visitors: 1, ctaClicks: 1, conversions: 1, returns: 1 });
    expect(p.control).toMatchObject({ visitors: 1, ctaClicks: 0, conversions: 0, returns: 0 });
    // Evidensgrinden: EN besökare per arm är långt under tröskeln — pWin ska
    // vara null ("för tidigt att säga"), inte en prior-driven procentsiffra.
    expect(p.pWin).toBeNull();
  });

  it("assist-klick (Angels genvägar) räknas separat och aldrig in i pWin-underlaget", () => {
    const events: DashEvent[] = [
      ev("adaptation_shown", {}, { visitorHash: "a", createdAt: T0 }),
      ev("cta_click", { path: "assist" }, { visitorHash: "a", createdAt: plus(0.1) }),
      ev("adaptation_shown", {}, { visitorHash: "b", createdAt: T0 }),
      ev("cta_click", { path: "goal" }, { visitorHash: "b", createdAt: plus(0.1) }),
      // Saknad path (äldre event) räknas som mål-klick.
      ev("adaptation_shown", {}, { visitorHash: "c", createdAt: T0 }),
      ev("cta_click", {}, { visitorHash: "c", createdAt: plus(0.1) }),
      ev("adaptation_withheld", {}, { visitorHash: "k", createdAt: T0 }),
    ];
    const p = proofSummary(events)!;
    expect(p.adapted).toMatchObject({ visitors: 3, ctaClicks: 2, assistClicks: 1 });
    expect(p.control).toMatchObject({ visitors: 1, ctaClicks: 0, assistClicks: 0 });
  });

  it("noll klick i olikstora armar ger pWin=null — inte en prior-lögn (~19 %)", () => {
    // 88/12-splitten med noll klick var det verifierade felläget: Beta(1,1)-
    // posteriorerna gav ~0.19 ur ren prior. Grinden ska stoppa avläsningen.
    const many: DashEvent[] = [];
    for (let i = 0; i < 88; i++)
      many.push(ev("adaptation_shown", {}, { visitorHash: `a${i}`, createdAt: T0 }));
    for (let i = 0; i < 12; i++)
      many.push(ev("adaptation_withheld", {}, { visitorHash: `c${i}`, createdAt: T0 }));
    const p = proofSummary(many)!;
    expect(p.holdoutActive).toBe(true);
    expect(p.pWin).toBeNull();
  });

  it("utan hold-out: holdoutActive=false och pWin=null — aldrig låtsas-bevis", () => {
    const events: DashEvent[] = [
      ev("adaptation_shown", { patterns: ["emphasize_goal"] }, { visitorHash: "a", createdAt: T0 }),
      ev("cta_click", {}, { visitorHash: "a", createdAt: plus(0.1) }),
    ];
    const p = proofSummary(events)!;
    expect(p.holdoutActive).toBe(false);
    expect(p.pWin).toBeNull();
  });

  it("returnerar null helt utan exponeringar, och mer data ger säkrare pWin", () => {
    expect(proofSummary([ev("pageview", {}, { visitorHash: "x" })])).toBeNull();
    // 40/50 adapterade klickar vs 10/50 kontroll → hög visshet.
    const many: DashEvent[] = [];
    for (let i = 0; i < 50; i++) {
      many.push(ev("adaptation_shown", {}, { visitorHash: `a${i}`, createdAt: T0 }));
      if (i < 40) many.push(ev("cta_click", {}, { visitorHash: `a${i}`, createdAt: plus(0.1) }));
      many.push(ev("adaptation_withheld", {}, { visitorHash: `c${i}`, createdAt: T0 }));
      if (i < 10) many.push(ev("cta_click", {}, { visitorHash: `c${i}`, createdAt: plus(0.1) }));
    }
    const p = proofSummary(many)!;
    expect(p.adapted.ctaClickRate).toBeCloseTo(0.8);
    expect(p.control.ctaClickRate).toBeCloseTo(0.2);
    expect(p.pWin).toBeGreaterThan(0.99);
  });

  it("risk-mätaren: per-arm median-LCP från page_perf (null under tröskeln)", () => {
    const build = (n: number, armType: string, lcp: number) => {
      const out: DashEvent[] = [];
      for (let i = 0; i < n; i++) {
        const vh = `${armType}${i}`;
        out.push(ev(armType, {}, { visitorHash: vh, createdAt: T0 }));
        out.push(ev("page_perf", { lcp }, { visitorHash: vh, createdAt: plus(0.05) }));
      }
      return out;
    };
    // Under MIN_PERF_SAMPLES (8) → null.
    const few = proofSummary([
      ...build(3, "adaptation_shown", 2000),
      ...build(3, "adaptation_withheld", 1900),
    ])!;
    expect(few.adapted.lcpMedianMs).toBeNull();

    // Adapterade armen ~2500ms, kontroll ~1800ms → adapterad median högre.
    const many = proofSummary([
      ...build(10, "adaptation_shown", 2500),
      ...build(10, "adaptation_withheld", 1800),
    ])!;
    expect(many.adapted.lcpMedianMs).toBe(2500);
    expect(many.control.lcpMedianMs).toBe(1800);
    // page_perf med ogiltig/saknad lcp ignoreras (räknas ej mot medianen).
    expect(proofSummary([...build(8, "adaptation_shown", 0)])!.adapted.lcpMedianMs).toBeNull();
  });
});

describe("sessionSummaries — nivå 2 (anonym besöksresa)", () => {
  const T0 = "2026-07-08T10:00:00Z";
  const at = (s: number) => new Date(Date.parse(T0) + s * 1000).toISOString();
  const sev = (
    type: string,
    payload: Record<string, unknown>,
    over: Partial<DashEvent> = {},
  ): DashEvent => ev(type, payload, { visitorHash: "v1", ...over });

  it("rekonstruerar kanal, sidordning, klickordning, tid och utfall per session", () => {
    const events: DashEvent[] = [
      sev("pageview", { sessionId: "s1", path: "/features", trafficSource: "linkedin", device: "mobile" }, { createdAt: at(0) }),
      sev("element_click", { sessionId: "s1", seq: 1, ref: "Watch demo" }, { createdAt: at(2) }),
      sev("pageview", { sessionId: "s1", path: "/pricing", trafficSource: "linkedin", device: "mobile" }, { createdAt: at(5) }),
      sev("element_click", { sessionId: "s1", seq: 1, ref: "Pricing FAQ" }, { createdAt: at(7) }),
      sev("form_start", { sessionId: "s1", ref: "#book", kind: "other" }, { createdAt: at(9) }),
      sev("form_abandon", { sessionId: "s1", ref: "#book", kind: "other" }, { createdAt: at(12) }),
      sev("page_leave", { sessionId: "s1", engagedMs: 42000, exit: true }, { createdAt: at(12) }),
    ];
    const [s] = sessionSummaries(events);
    expect(s.sessionId).toBe("s1");
    expect(s.channel).toBe("linkedin");
    expect(s.device).toBe("mobile");
    expect(s.landingPath).toBe("/features");
    expect(s.pageOrder).toEqual(["/features", "/pricing"]);
    expect(s.clickOrder).toEqual(["Watch demo", "Pricing FAQ"]);
    expect(s.engagedMs).toBe(42000);
    expect(s.formStarted).toBe(true);
    expect(s.formAbandoned).toBe(true); // klientens form_abandon-event
    expect(s.converted).toBe(false);
  });

  it("flaggar INTE ett pågående formulär som övergivet pga en tidigare sidas page_leave", () => {
    // Granskningsfynd: en form_start på sida /b, med en page_leave från /a
    // tidigare i sessionen, får inte bli formAbandoned (formuläret pågår).
    const events: DashEvent[] = [
      sev("pageview", { sessionId: "s", path: "/a" }, { createdAt: at(0) }),
      sev("page_leave", { sessionId: "s", engagedMs: 5000 }, { createdAt: at(3) }),
      sev("pageview", { sessionId: "s", path: "/b" }, { createdAt: at(4) }),
      sev("form_start", { sessionId: "s", ref: "#f", kind: "other" }, { createdAt: at(6) }),
    ];
    const [s] = sessionSummaries(events);
    expect(s.formStarted).toBe(true);
    expect(s.formAbandoned).toBe(false); // inget form_abandon → pågående
  });

  it("chronologisk ordning även när mikrosekunderna utelämnas (PostgREST-tid)", () => {
    // '…:00+00:00' (bråkdel utelämnad) är den SANNA landningen men sorteras
    // lexikalt efter '…:00.240000+00:00'. Numerisk sortering ger rätt.
    const events: DashEvent[] = [
      sev("pageview", { sessionId: "s", path: "/a", trafficSource: "google" }, { createdAt: "2026-07-08T10:00:00+00:00" }),
      sev("element_click", { sessionId: "s", seq: 1, ref: "X" }, { createdAt: "2026-07-08T10:00:00.240000+00:00" }),
      sev("pageview", { sessionId: "s", path: "/b" }, { createdAt: "2026-07-08T10:00:00.900000+00:00" }),
    ];
    const [s] = sessionSummaries(events);
    expect(s.landingPath).toBe("/a"); // inte "/b"
    expect(s.pageOrder).toEqual(["/a", "/b"]);
    expect(s.channel).toBe("google"); // från den RIKTIGA landningen
  });

  it("sawAdaptation scopas till sessionens fönster, inte hela besökarens historik", () => {
    // Besökaren adapterades i en TIDIGARE session (t=0) men inte i den här
    // (t=100..102) → sawAdaptation ska vara false för den nya sessionen.
    const events: DashEvent[] = [
      ev("adaptation_shown", { patterns: ["emphasize_goal"] }, { visitorHash: "v", createdAt: at(0) }),
      ev("pageview", { sessionId: "later", path: "/x", trafficSource: "direct" }, { visitorHash: "v", createdAt: at(100) }),
      ev("page_leave", { sessionId: "later", engagedMs: 2000 }, { visitorHash: "v", createdAt: at(102) }),
    ];
    const [s] = sessionSummaries(events);
    expect(s.sawAdaptation).toBe(false);
  });

  it("collapsar upprepad path och markerar konvertering + adapterad arm", () => {
    const events: DashEvent[] = [
      ev("pageview", { sessionId: "s2", path: "/", trafficSource: "google" }, { visitorHash: "v9", createdAt: at(1) }),
      // Exponering loggas server-side under sessionen (vid decide på pageview).
      ev("adaptation_shown", { patterns: ["emphasize_goal"] }, { visitorHash: "v9", createdAt: at(1) }),
      ev("pageview", { sessionId: "s2", path: "/" }, { visitorHash: "v9", createdAt: at(2) }), // hydrerings-dubblett
      ev("conversion", { sessionId: "s2" }, { visitorHash: "v9", createdAt: at(3) }),
    ];
    const [s] = sessionSummaries(events);
    expect(s.pageOrder).toEqual(["/"]); // dubbletten collapsad
    expect(s.converted).toBe(true);
    expect(s.sawAdaptation).toBe(true); // exponering inom sessionens fönster
  });

  it("hoppar över events utan sessionId och sorterar nyaste först", () => {
    const events: DashEvent[] = [
      sev("pageview", { path: "/a" }, { createdAt: at(0) }), // ingen sessionId → ignoreras
      sev("pageview", { sessionId: "old", path: "/x" }, { createdAt: at(1) }),
      sev("pageview", { sessionId: "new", path: "/y" }, { createdAt: at(100) }),
    ];
    const out = sessionSummaries(events);
    expect(out.map((s) => s.sessionId)).toEqual(["new", "old"]);
  });
});

describe("rageSignals — frustrationssignaler (diagnostik)", () => {
  it("rullar upp bursts och distinkta besökare per ref, mest frustrerande först", () => {
    const events: DashEvent[] = [
      ev("rage_click", { ref: "button#buy", count: 3 }, { visitorHash: "a" }),
      ev("rage_click", { ref: "button#buy", count: 4 }, { visitorHash: "b" }),
      ev("rage_click", { ref: "button#buy", count: 3 }, { visitorHash: "a" }), // samma besökare igen
      ev("rage_click", { ref: "a[href=/faq]", count: 3 }, { visitorHash: "c" }),
      ev("cta_click", { text: "Buy" }, { visitorHash: "a" }), // ovidkommande typ ignoreras
    ];
    const out = rageSignals(events);
    expect(out).toEqual([
      { ref: "button#buy", bursts: 3, visitors: 2 },
      { ref: "a[href=/faq]", bursts: 1, visitors: 1 },
    ]);
  });

  it("hoppar över events utan ref och kapar till MAX_RAGE_SIGNALS", () => {
    const many: DashEvent[] = [];
    for (let i = 0; i < MAX_RAGE_SIGNALS + 5; i++) {
      many.push(ev("rage_click", { ref: `el-${i}`, count: 3 }, { visitorHash: `v${i}` }));
    }
    many.push(ev("rage_click", {}, { visitorHash: "x" })); // ingen ref → ignoreras
    const out = rageSignals(many);
    expect(out.length).toBe(MAX_RAGE_SIGNALS);
    expect(out.every((r) => typeof r.ref === "string" && r.ref.length > 0)).toBe(true);
  });

  it("tom lista när inga rage_click-events finns", () => {
    expect(rageSignals([ev("pageview", { path: "/" })])).toEqual([]);
  });
});

describe("clickHeat — klick-heatmapens rollup", () => {
  // Enhets-attributionen går via besökarens pageview (klick bär ingen enhet).
  const mobVisit = ev("pageview", { path: "/", device: "mobile" }, { visitorHash: "v-mob" });
  const deskVisit = ev("pageview", { path: "/", device: "desktop" }, { visitorHash: "v-desk" });

  it("bucketar positionsbärande klick i 5%-rutor per layoutklass på mest klickade sidan", () => {
    const events: DashEvent[] = [
      mobVisit,
      deskVisit,
      ev("element_click", { path: "/", x: 51, y: 42 }, { visitorHash: "v-mob" }),
      ev("element_click", { path: "/", x: 52, y: 43 }, { visitorHash: "v-mob" }), // samma 5%-ruta
      ev("element_click", { path: "/", x: 12, y: 80 }, { visitorHash: "v-desk" }),
      ev("element_click", { path: "/pricing", x: 10, y: 10 }, { visitorHash: "v-mob" }), // annan sida — färre klick
      ev("element_click", { path: "/" }), // gammalt event utan koordinater → ignoreras
    ];
    const heat = clickHeat(events);
    expect(heat.path).toBe("/");
    expect(heat.mobile.sampled).toBe(2);
    expect(heat.mobile.clicks[0]).toEqual({ x: 52, y: 42, n: 2 }); // ruta 10:8 → center 52,42
    expect(heat.desktop.sampled).toBe(1);
    expect(heat.desktop.clicks).toEqual([{ x: 12, y: 82, n: 1 }]);
    expect(heat.unattributed).toBe(0);
  });

  it("query-strippar sidvägen — klick lagrade före sidvägs-normaliseringen bär ?fbclid", () => {
    const events: DashEvent[] = [
      mobVisit,
      ev("element_click", { path: "/blogg/x?fbclid=abc", x: 10, y: 10 }, { visitorHash: "v-mob" }),
      ev("element_click", { path: "/blogg/x?fbclid=def", x: 11, y: 11 }, { visitorHash: "v-mob" }),
      ev("element_click", { path: "/", x: 50, y: 50 }, { visitorHash: "v-mob" }),
    ];
    const heat = clickHeat(events);
    // De två fbclid-varianterna räknas ihop och vinner över "/" (1 klick).
    expect(heat.path).toBe("/blogg/x");
    expect(heat.mobile.sampled).toBe(2);
  });

  it("grupperar rage-punkter per element med medelposition + bursts, i besökarens layoutvy", () => {
    const events: DashEvent[] = [
      mobVisit,
      ev("element_click", { path: "/", x: 50, y: 50 }, { visitorHash: "v-mob" }),
      ev("rage_click", { path: "/", ref: "button#buy", x: 40, y: 60 }, { visitorHash: "v-mob" }),
      ev("rage_click", { path: "/", ref: "button#buy", x: 60, y: 80 }, { visitorHash: "v-mob" }),
      ev("rage_click", { path: "/", ref: "a.nav", x: 10, y: 5 }, { visitorHash: "v-mob" }),
    ];
    const heat = clickHeat(events);
    expect(heat.mobile.rage).toEqual([
      { ref: "button#buy", x: 50, y: 70, n: 2 },
      { ref: "a.nav", x: 10, y: 5, n: 1 },
    ]);
    expect(heat.desktop.rage).toEqual([]);
  });

  it("klick utan enhets-attribution räknas i unattributed och ritas inte", () => {
    const heat = clickHeat([
      ev("element_click", { path: "/", x: 50, y: 50 }), // ingen visitorHash
      ev("element_click", { path: "/", x: 10, y: 10 }, { visitorHash: "v-okänd" }), // ingen pageview
    ]);
    expect(heat.mobile.sampled).toBe(0);
    expect(heat.desktop.sampled).toBe(0);
    expect(heat.unattributed).toBe(2);
  });

  it("tablet räknas till desktop-layouten (närmast den layoutbredden)", () => {
    const heat = clickHeat([
      ev("pageview", { path: "/", device: "tablet" }, { visitorHash: "v-tab" }),
      ev("element_click", { path: "/", x: 50, y: 50 }, { visitorHash: "v-tab" }),
    ]);
    expect(heat.desktop.sampled).toBe(1);
    expect(heat.mobile.sampled).toBe(0);
  });

  it("ärligt tomt läge: inga koordinater → sampled 0 och inga punkter", () => {
    const heat = clickHeat([
      ev("element_click", { path: "/", ref: "a" }),
      ev("rage_click", { path: "/", ref: "b", count: 3 }),
    ]);
    expect(heat.mobile.sampled).toBe(0);
    expect(heat.desktop.sampled).toBe(0);
    expect(heat.mobile.clicks).toEqual([]);
    expect(heat.desktop.rage).toEqual([]);
    expect(heat.unattributed).toBe(0);
  });

  it("avvisar koordinater utanför 0–100", () => {
    const heat = clickHeat([ev("element_click", { path: "/", x: 120, y: 50 })]);
    expect(heat.mobile.sampled + heat.desktop.sampled).toBe(0);
    expect(heat.unattributed).toBe(0);
  });
});

describe("segmentSummaries — Fas 2 besökargrupper (grov→fin + volymgrind)", () => {
  let sid = 0;
  const sess = (over: Partial<SessionSummary> = {}): SessionSummary => ({
    sessionId: `s${++sid}`,
    startedAt: "2026-06-27T10:00:00Z",
    endedAt: "2026-06-27T10:05:00Z",
    channel: "google",
    device: "mobile",
    country: "se",
    isReturning: false,
    landingPath: "/",
    pageOrder: ["/"],
    clickOrder: [],
    engagedMs: 1000,
    formStarted: false,
    formSubmitted: false,
    formAbandoned: false,
    converted: false,
    sawAdaptation: false,
    ...over,
  });
  const byKey = (out: ReturnType<typeof segmentSummaries>) =>
    new Map(out.map((s) => [s.key, s]));

  it("varje session bidrar till ALLA sina prefix (grov→fin) med rätt utfall", () => {
    // 6 google·mobile·se-sessioner, 2 konverterade.
    const sessions = Array.from({ length: 6 }, (_, i) => sess({ converted: i < 2 }));
    const m = byKey(segmentSummaries(sessions));
    for (const key of ["google", "google·mobile", "google·mobile·se", "google·mobile·se·ny"]) {
      expect(m.get(key)?.visits).toBe(6);
      expect(m.get(key)?.conversions).toBe(2);
      expect(m.get(key)?.conversionRate).toBeCloseTo(2 / 6);
    }
    expect(m.get("google·mobile")?.depth).toBe(2);
    expect(m.get("google·mobile")?.device).toBe("mobile");
    expect(m.get("google·mobile·se·ny")?.returning).toBe(false);
  });

  it("grov grupp aggregerar finare (låna styrka); för tunna finare grupper döljs", () => {
    // 5 se + 5 us, alla google·mobile → coarse google·mobile = 10 (visas),
    // country-splittarna = 5 var (precis på display-tröskeln → visas).
    const sessions = [
      ...Array.from({ length: 5 }, () => sess({ country: "se" })),
      ...Array.from({ length: 5 }, () => sess({ country: "us" })),
    ];
    const m = byKey(segmentSummaries(sessions));
    expect(m.get("google·mobile")?.visits).toBe(10);
    expect(m.get("google·mobile·se")?.visits).toBe(5);
    expect(m.get("google·mobile·us")?.visits).toBe(5);

    // En finare grupp under display-tröskeln (< SEGMENT_MIN_DISPLAY) döljs helt.
    const thin = [
      ...Array.from({ length: 6 }, () => sess({ country: "se" })),
      ...Array.from({ length: 2 }, () => sess({ country: "no" })), // 2 < 5 → dold
    ];
    const m2 = byKey(segmentSummaries(thin));
    expect(m2.has("google·mobile·no")).toBe(false);
    expect(m2.get("google·mobile")?.visits).toBe(8); // men räknas i den grova
  });

  it("adequate-flaggan följer volymgrinden (SEGMENT_MIN_VISITS/CONVERSIONS)", () => {
    const big = Array.from({ length: SEGMENT_MIN_VISITS }, (_, i) =>
      sess({ converted: i < SEGMENT_MIN_CONVERSIONS }),
    );
    expect(byKey(segmentSummaries(big)).get("google")?.adequate).toBe(true);

    // Nog besök men för få konverteringar → inte tillräckligt.
    const fewConv = Array.from({ length: SEGMENT_MIN_VISITS }, (_, i) =>
      sess({ converted: i < SEGMENT_MIN_CONVERSIONS - 1 }),
    );
    expect(byKey(segmentSummaries(fewConv)).get("google")?.adequate).toBe(false);

    // Liten pilot-grupp → aldrig tillräcklig.
    expect(byKey(segmentSummaries(Array.from({ length: 6 }, () => sess()))).get("google")?.adequate).toBe(
      false,
    );
  });

  it("sorterar grovast först, sedan störst volym; null-dimensioner blir 'okänd'", () => {
    const sessions = [
      ...Array.from({ length: 6 }, () => sess({ channel: "google" })),
      ...Array.from({ length: 8 }, () => sess({ channel: "direct" })),
      ...Array.from({ length: 5 }, () => sess({ channel: null })), // → "okänd"
    ];
    const out = segmentSummaries(sessions);
    // Alla depth-1 kommer före alla depth-2.
    const firstDepth2 = out.findIndex((s) => s.depth === 2);
    expect(out.slice(0, firstDepth2).every((s) => s.depth === 1)).toBe(true);
    // Inom depth 1: störst volym först (direct 8 > google 6 > okänd 5).
    const depth1 = out.filter((s) => s.depth === 1).map((s) => s.key);
    expect(depth1).toEqual(["direct", "google", "okänd"]);
  });
});

describe("expandSegmentLeaves — server-rollup-löv → grov→fin prefix", () => {
  const leaf = (over: Partial<Parameters<typeof expandSegmentLeaves>[0][number]> = {}) => ({
    channel: "google",
    device: "mobile",
    country: "se",
    returning: false,
    visits: 0,
    conversions: 0,
    formStarts: 0,
    formAbandons: 0,
    ...over,
  });
  const byKey = (out: ReturnType<typeof expandSegmentLeaves>) => new Map(out.map((s) => [s.key, s]));

  it("summerar PRE-AGGREGERADE löv (visits>1) till alla prefix (låna styrka)", () => {
    // Ett löv representerar redan MÅNGA sessioner (server-rollupen aggregerade dem).
    const m = byKey(
      expandSegmentLeaves([
        leaf({ country: "se", visits: 8, conversions: 3, formAbandons: 2 }),
        leaf({ country: "us", visits: 6, conversions: 1 }),
      ]),
    );
    expect(m.get("google·mobile")?.visits).toBe(14); // 8 + 6, grov grupp får mest data
    expect(m.get("google·mobile")?.conversions).toBe(4);
    expect(m.get("google·mobile")?.formAbandons).toBe(2);
    expect(m.get("google")?.visits).toBe(14);
    expect(m.get("google·mobile·se")?.visits).toBe(8);
    expect(m.get("google·mobile·us")?.visits).toBe(6);
    expect(m.get("google·mobile")?.conversionRate).toBeCloseTo(4 / 14);
  });

  it("adequate följer volymgrinden på summerade löv", () => {
    const m = byKey(
      expandSegmentLeaves([
        leaf({ visits: SEGMENT_MIN_VISITS, conversions: SEGMENT_MIN_CONVERSIONS }),
      ]),
    );
    expect(m.get("google")?.adequate).toBe(true);
    // Ett tunt löv under display-tröskeln göms.
    expect(byKey(expandSegmentLeaves([leaf({ visits: 3, conversions: 1 })])).has("google")).toBe(
      false,
    );
  });

  it("sätter recent=null (fylls i av attachRecent)", () => {
    const [s] = expandSegmentLeaves([leaf({ visits: 6, conversions: 1 })]);
    expect(s.recent).toBeNull();
  });
});

describe("attachRecent — livstid + senaste fönster per segment", () => {
  const leaf = (over: Partial<Parameters<typeof expandSegmentLeaves>[0][number]> = {}) => ({
    channel: "google",
    device: "mobile",
    country: "se",
    returning: false,
    visits: 0,
    conversions: 0,
    formStarts: 0,
    formAbandons: 0,
    ...over,
  });

  it("kopplar nyligt fönster per nyckel; saknad nyligt → recent=null; visar samma rader", () => {
    const allTime = expandSegmentLeaves([
      leaf({ visits: 100, conversions: 10 }),
      leaf({ channel: "direct", device: "desktop", visits: 50, conversions: 2 }),
    ]);
    const recent = expandSegmentLeaves([
      leaf({ visits: 20, conversions: 4 }), // bara google·mobile·se finns i fönstret
    ]);
    const merged = attachRecent(allTime, recent);
    const m = new Map(merged.map((s) => [s.key, s]));

    expect(m.get("google")?.recent).toEqual({
      visits: 20,
      conversions: 4,
      conversionRate: 4 / 20,
      adequate: false,
    });
    expect(m.get("direct")?.recent).toBeNull(); // saknas i det nyliga fönstret
    expect(m.get("google")?.visits).toBe(100); // livstidssiffrorna orörda
    expect(merged.length).toBe(allTime.length); // recent ändrar aldrig VILKA rader som visas
  });
});
