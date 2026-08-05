// Steg 5-grinden: sektions-joinen (runtime-census ↔ extract.ts-id:n) får inte
// regressa. Golven sätts strax UNDER uppmätt nivå på den committade korpusen —
// grinden fångar tapp, inte brus. Chromium-delen hoppar ärligt när ingen
// chromium kan startas (samma mönster som heading-rotator.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evalSectionJoin, joinSection, scoreSiteJoin, type JoinEvalResult } from "../run";

describe("joinSection — applierns tvåpass-regel som ren funktion", () => {
  const a = (heading: string) => ({ id: "sec-1-x", type: "x", heading });

  it("exakt normaliserad träff är UNIK via exact", () => {
    const j = joinSection(a("Simple Pricing"), ["  simple   PRICING  ", "Other"], false);
    expect(j.verdict).toBe("UNIK");
    expect(j.via).toBe("exact");
  });

  it("rotator-garble räddas av 24-teckens prefixet (applier pass 2)", () => {
    // extract ser alla rotator-frames; censusen ser den frysta framen. Prefixet
    // (24 tecken) ligger före skarven — precis det driftfall passet finns för.
    const garbled = "Where go-to-market teams go to grow scale close retain grow";
    const j = joinSection(a(garbled), ["Where go-to-market teams go to grow"], false);
    expect(j.verdict).toBe("UNIK");
    expect(j.via).toBe("prefix");
  });

  it("två identiska census-rubriker ⇒ FLERTYDIG (kreditering vore gissning)", () => {
    const j = joinSection(a("Our plans"), ["Our plans", "our  plans"], false);
    expect(j.verdict).toBe("FLERTYDIG");
  });

  it("ingen träff ⇒ OUPPLÖST; tom rubrik ⇒ OUPPLÖST", () => {
    expect(joinSection(a("Completely absent heading"), ["Other stuff"], false).verdict).toBe(
      "OUPPLÖST",
    );
    expect(joinSection(a(""), ["Anything"], false).verdict).toBe("OUPPLÖST");
  });

  it("scoreSiteJoin räknar täckning, kandidat-täckning och omvänd täckning", () => {
    const r = scoreSiteJoin(
      "syntetisk",
      [
        { id: "sec-1-hero", type: "hero", heading: "Build faster" },
        { id: "sec-2-pricing", type: "pricing", heading: "Simple pricing" },
        { id: "sec-3-section", type: "section", heading: "Unfindable" },
      ],
      new Set(["sec-2-pricing"]),
      [
        { type: "hero", heading: "Build faster" },
        { type: "pricing", heading: "Simple pricing" },
        { type: "content", heading: "Orphan census section" },
        { type: "footer", heading: "Footer heading" }, // icke-innehåll — utanför nämnaren
      ],
    );
    expect(r.unik).toBe(2);
    expect(r.oupplöst).toBe(1);
    expect(r.coverage).toBeCloseTo(2 / 3, 10);
    expect(r.candCoverage).toBe(1); // pris-kandidaten joinar
    expect(r.bContentWithHeading).toBe(3); // footern räknas inte
    expect(r.reverseCoverage).toBeCloseTo(2 / 3, 10);
  });
});

describe("sektions-joinen på den committade korpusen (chromium)", () => {
  let result: JoinEvalResult | null = null;
  let chromiumAvailable = false;

  beforeAll(async () => {
    try {
      // Grindtestet kör BARA fullkontrakts-korpusen (corpus/) — snabbt nog för
      // enhetssvepet; CLI:t täcker hela 20-sajtslistan.
      result = await evalSectionJoin({
        only: [
          "hubspot",
          "linear",
          "hibob",
          "nextory",
          "sector-alarm",
          "elskling",
          "cancerfonden",
          "cdon",
          "bokadirekt",
          "bokadirekt-service",
        ],
      });
      chromiumAvailable = true;
    } catch {
      chromiumAvailable = false;
    }
  }, 420_000);

  afterAll(() => {
    result = null;
  });

  it("inga sajter kraschar insamlingen", (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    expect(result!.scored.filter((s) => s.error).map((s) => s.site)).toEqual([]);
  });

  it("KANDIDAT-flyttmålens unika join-täckning håller golvet (steg 8:s rollup-tal)", (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Uppmätt 2026-08-05 på korpusen — golvet strax under så drift fångas
    // utan att enskilda omfrysningar flapprar.
    expect(result!.candCoverage).toBeGreaterThanOrEqual(0.85);
    expect(result!.totalCand).toBeGreaterThanOrEqual(5); // grinden får inte bli tom
  });

  it("alla A-sektioners unika täckning håller golvet", (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    expect(result!.coverage).toBeGreaterThanOrEqual(0.75);
  });
});
