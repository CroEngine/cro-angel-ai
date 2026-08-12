// Fejktrafikens kontrakt: dold sanning → census-payloads → produktionens
// aggregering/rollup → BehaviorInput. Sanningen får aldrig läcka på någon
// annan väg än dwell-mönstret, och samma frö ska ge samma värld.
import { describe, expect, it } from "vitest";

import { fakeTrafficForPage, seedForSite } from "../traffic-sim";

import type { RedesignContentModel } from "../../../src/adaptive/redesign/context";

const CONTENT: RedesignContentModel = {
  sections: [
    {
      id: "sec-1-hero",
      type: "hero",
      position: 1,
      heading: "Build faster",
      aboveFold: true,
      visualWeight: 85,
    },
    {
      id: "sec-2-testimonials",
      type: "testimonials",
      position: 2,
      heading: "Loved by teams everywhere",
      aboveFold: false,
      visualWeight: 56,
    },
    {
      id: "sec-3-pricing",
      type: "pricing",
      position: 3,
      heading: "Simple honest pricing",
      aboveFold: false,
      visualWeight: 52,
    },
  ],
  trustSignals: [],
  ctas: [{ text: "Start free", aboveFold: true }],
  hero: { headline: "Build faster" },
};

describe("fakeTrafficForPage — fejktrafik med dold sanning", () => {
  it("guldet är ett av KATALOGENS flyttmål, sanningen het på guldet och sval annars", () => {
    const { plan, skip } = fakeTrafficForPage(CONTENT, 42);
    expect(skip).toBeNull();
    expect(plan).not.toBeNull();
    expect(["sec-2-testimonials", "sec-3-pricing"]).toContain(plan!.goldSectionId);
    expect(plan!.truth[plan!.goldSectionId]).toBeGreaterThanOrEqual(0.75);
    for (const [id, t] of Object.entries(plan!.truth)) {
      if (id !== plan!.goldSectionId) expect(t).toBeLessThanOrEqual(0.38);
    }
  });

  it("sätet matas genom produktionens rollup: vikter nära sanningen, n = laddningarna", () => {
    const { plan } = fakeTrafficForPage(CONTENT, 42, 1200);
    const w = plan!.behavior.sectionWeight;
    const n = plan!.behavior.sectionVisits!;
    // Binomialbrus vid n=1200: SE ≈ 1,3 pp — 5 pp-toleransen är rymlig.
    expect(Math.abs(w[plan!.goldSectionId] - plan!.truth[plan!.goldSectionId])).toBeLessThan(0.05);
    for (const id of Object.keys(w)) expect(n[id]).toBe(1200);
  });

  it("deterministiskt: samma frö ⇒ samma guld, sanning och vikter", () => {
    const a = fakeTrafficForPage(CONTENT, 7).plan!;
    const b = fakeTrafficForPage(CONTENT, 7).plan!;
    expect(a).toEqual(b);
    // ...och olika frön kan ge olika guld (variation över flottan).
    const golds = new Set(
      Array.from({ length: 12 }, (_, i) => fakeTrafficForPage(CONTENT, i + 1).plan!.goldSectionId),
    );
    expect(golds.size).toBeGreaterThan(1);
  });

  it("sida utan flyttbara bevis-sektioner ⇒ ärligt skip, aldrig en gissning", () => {
    const heroOnly: RedesignContentModel = {
      ...CONTENT,
      sections: [CONTENT.sections[0]],
      trustSignals: [],
    };
    const { plan, skip } = fakeTrafficForPage(heroOnly, 1);
    expect(plan).toBeNull();
    expect(skip).toBe("no-movable-target");
  });

  it("payloaden är orörda laddningar (adapted: 0) — arm-stängslets kontrakt", () => {
    // Vikterna byggs bara av laddningar rollupens läsväg hade accepterat;
    // indirekt test: rollupen svarade (icke-null) trots stängslet.
    const { plan } = fakeTrafficForPage(CONTENT, 3, 60);
    expect(plan).not.toBeNull();
    expect(plan!.loads).toBe(60);
  });

  it("seedForSite är stabilt och skiljer namn åt", () => {
    expect(seedForSite("allbirds")).toBe(seedForSite("allbirds"));
    expect(seedForSite("allbirds")).not.toBe(seedForSite("aritzia"));
    expect(seedForSite("allbirds", 1)).not.toBe(seedForSite("allbirds", 2));
  });
});
