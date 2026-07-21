// Pure pieces of the performance feedback loop (increment 2): the micro
// nudge's hierarchy + directional guard (D2) and the segment-aware boost
// resolution (D4). No IO — supabase is never touched here.

import { describe, expect, it } from "vitest";

import { microNudge, resolveBoosts } from "../performance.server";
import type { MicroStats } from "@/lib/dashboard/aggregate";

const micro = (deepScroll: number, multiPage: number, returned: number): MicroStats => ({
  deepScroll,
  multiPage,
  returned,
});

const arm = (exposures: number, conversions: number) => ({
  exposures,
  conversions,
  rate: exposures > 0 ? conversions / exposures : 0,
});

describe("microNudge — hierarchical score with a directional guard (D2)", () => {
  it("fast-converting arms are not punished for their non-scrolling converters", () => {
    // Adapted converts 12/40 with quiet non-converters; control converts 5/40
    // but its non-converters browse around. The real goal must win: the
    // engagement gap may not drag the converting arm negative.
    const nudge = microNudge({
      adapted: arm(40, 12),
      control: arm(40, 5),
      adaptedMicro: micro(2, 2, 1), // among 28 non-converters
      controlMicro: micro(20, 22, 14), // among 35 non-converters
    });
    expect(nudge).toBeGreaterThanOrEqual(0);
  });

  it("still nudges negative when the conversion evidence is one-sided or absent", () => {
    // No conversions at all — pure engagement gap may point down.
    const nudge = microNudge({
      adapted: arm(40, 0),
      control: arm(40, 0),
      adaptedMicro: micro(2, 2, 1),
      controlMicro: micro(20, 22, 14),
    });
    expect(nudge).toBeLessThan(0);
  });

  it("conversion rate itself lifts the composite score", () => {
    // Identical (zero) engagement — the converting arm must score higher.
    const nudge = microNudge({
      adapted: arm(40, 20),
      control: arm(40, 0),
      adaptedMicro: micro(0, 0, 0),
      controlMicro: micro(0, 0, 0),
    });
    expect(nudge).toBeGreaterThan(0);
  });

  it("returns 0 below the exposure floor", () => {
    expect(
      microNudge({
        adapted: arm(5, 5),
        control: arm(40, 0),
        adaptedMicro: micro(0, 0, 0),
        controlMicro: micro(0, 0, 0),
      }),
    ).toBe(0);
  });
});

describe("resolveBoosts — segment verdicts override the sitewide blend (D4)", () => {
  const boosts = {
    overall: { clarify_cta: -1000, show_guarantee: 10 },
    bySegment: {
      linkedin: { clarify_cta: 25 },
    },
  };

  it("a segment where the pattern wins keeps running it despite a negative blend", () => {
    const linkedin = resolveBoosts(boosts, "linkedin");
    expect(linkedin.clarify_cta).toBe(25); // segment verdict wins
    expect(linkedin.show_guarantee).toBe(10); // overall carries through
  });

  it("other segments fall back to the sitewide verdict", () => {
    expect(resolveBoosts(boosts, "google_ads").clarify_cta).toBe(-1000);
    expect(resolveBoosts(boosts, null).clarify_cta).toBe(-1000);
  });
});
