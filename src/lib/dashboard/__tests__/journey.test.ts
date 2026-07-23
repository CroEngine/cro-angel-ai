import { describe, it, expect } from "vitest";

import { buildJourney, JOURNEY_PROFILE_MIN, type JourneyInput } from "../journey";
import { SEGMENT_MIN_VISITS, SEGMENT_MIN_VISITS_ENGAGEMENT } from "../aggregate";

const base = (over: Partial<JourneyInput> = {}): JourneyInput => ({
  pageviews: 0,
  uniqueVisitors: 0,
  inventoryCount: 0,
  segmentGroups: [],
  variants: [],
  testMetric: "conversion",
  ...over,
});

const states = (input: JourneyInput) =>
  Object.fromEntries(buildJourney(input).map((m) => [m.id, m.state]));

describe("buildJourney — the stay-until-proven story", () => {
  it("fresh site: install is current, everything else upcoming", () => {
    const s = states(base());
    expect(s.install).toBe("current");
    expect(s.mapped).toBe("upcoming");
    expect(s.verdict).toBe("upcoming");
  });

  it("collecting: counts flow into the details, profiled shows honest progress", () => {
    const ms = buildJourney(base({ pageviews: 420, uniqueVisitors: 37, inventoryCount: 24 }));
    const byId = Object.fromEntries(ms.map((m) => [m.id, m]));
    expect(byId.install.state).toBe("done");
    expect(byId.install.detail).toContain("420");
    expect(byId.mapped.state).toBe("done");
    expect(byId.mapped.detail).toContain("24");
    expect(byId.profiled.state).toBe("current");
    expect(byId.profiled.detail).toContain(`37/${JOURNEY_PROFILE_MIN}`);
  });

  it("segments forming: the largest group is named with its volume", () => {
    const ms = buildJourney(
      base({
        pageviews: 5000,
        uniqueVisitors: 900,
        inventoryCount: 30,
        segmentGroups: [
          { label: "google · mobile", depth: 2, visits: 400, conversions: 12 },
          { label: "direct · desktop", depth: 2, visits: 90, conversions: 2 },
          { label: "google", depth: 1, visits: 800, conversions: 20 },
        ],
      }),
    );
    const seg = ms.find((m) => m.id === "segments")!;
    expect(seg.state).toBe("done");
    expect(seg.detail).toContain("google · mobile");
    expect(seg.detail).toContain("400");
    // depth-1 groups never count as "forming" — they're too coarse to design for
    expect(seg.detail).not.toContain("800");
  });

  it("earned (current): names the CLOSEST group and the honest bar (conversion metric)", () => {
    const ms = buildJourney(
      base({
        pageviews: 9000,
        uniqueVisitors: 2000,
        inventoryCount: 30,
        segmentGroups: [
          { label: "google · mobile", depth: 2, visits: 700, conversions: 60 },
          { label: "direct · desktop", depth: 2, visits: 300, conversions: 4 },
        ],
      }),
    );
    const earned = ms.find((m) => m.id === "earned")!;
    expect(earned.state).toBe("current");
    expect(earned.detail).toContain("google · mobile");
    expect(earned.detail).toContain(
      `${(700).toLocaleString("en-US")}/${SEGMENT_MIN_VISITS.toLocaleString("en-US")}`,
    );
    expect(earned.detail).toContain("conversions");
  });

  it("earned (continuation metric): the bar is the engagement floor, no conversion demand", () => {
    const ms = buildJourney(
      base({
        pageviews: 900,
        uniqueVisitors: 200,
        inventoryCount: 10,
        testMetric: "continuation",
        segmentGroups: [{ label: "google · mobile", depth: 2, visits: 60, conversions: 0 }],
      }),
    );
    const earned = ms.find((m) => m.id === "earned")!;
    expect(earned.detail).toContain(`60/${SEGMENT_MIN_VISITS_ENGAGEMENT}`);
    expect(earned.detail).not.toContain("conversions");
  });

  it("variant lifecycle advances the story: earned → verified → measuring → verdict", () => {
    const withStatus = (status: JourneyInput["variants"][number]["status"], abOutcome?: string) =>
      states(
        base({
          pageviews: 10_000,
          uniqueVisitors: 3000,
          inventoryCount: 30,
          segmentGroups: [{ label: "google · mobile", depth: 2, visits: 2000, conversions: 200 }],
          variants: [{ status, segmentKey: "google·mobile", abOutcome: abOutcome ?? null }],
        }),
      );
    expect(withStatus("candidate").earned).toBe("done");
    expect(withStatus("candidate").verified).toBe("current");
    expect(withStatus("verified").verified).toBe("done");
    expect(withStatus("verified").measuring).toBe("current");
    expect(withStatus("serving").measuring).toBe("done");
    expect(withStatus("serving").verdict).toBe("current");
    expect(withStatus("serving", "recommend_winner").verdict).toBe("done");
    expect(withStatus("winner").verdict).toBe("done");
  });

  it("retired variants tell no story — they neither earn nor verify", () => {
    const s = states(
      base({
        pageviews: 10_000,
        uniqueVisitors: 3000,
        inventoryCount: 30,
        segmentGroups: [{ label: "google · mobile", depth: 2, visits: 2000, conversions: 200 }],
        variants: [{ status: "retired", segmentKey: "google" }],
      }),
    );
    expect(s.earned).toBe("current");
  });

  it("insufficient_data is NOT a verdict — the honest read has not arrived", () => {
    const s = states(
      base({
        pageviews: 10_000,
        uniqueVisitors: 3000,
        inventoryCount: 30,
        segmentGroups: [{ label: "google · mobile", depth: 2, visits: 2000, conversions: 200 }],
        variants: [{ status: "serving", segmentKey: "google", abOutcome: "insufficient_data" }],
      }),
    );
    expect(s.verdict).toBe("current");
  });
});
