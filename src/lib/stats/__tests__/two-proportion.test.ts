// Den delade z-kärnan OCH bägge anroparnas grindkontrakt (städsvepet
// 2026-08-14). Grindarna testas här därför att de var otestade när formeln
// slogs ihop: measure.test.ts rörde aldrig n===0/se===0-grenarna, och
// twoProportionZ hade noll testreferenser. En sammanslagning vars enda bevis
// är läsning är inte bevisad — nu är den det.
import { describe, expect, it } from "vitest";

import { pooledTwoProportionZ } from "../two-proportion";
import { twoProportionZ } from "@/lib/dashboard/aggregate";
import { twoProportionTest } from "@/adaptive-lab/measure";

describe("pooledTwoProportionZ — kärnan", () => {
  it("räknar den poolade z-statistikan", () => {
    // 60/200 mot 40/200: pooled = 0,25, se = sqrt(0,25·0,75·0,01) ≈ 0,0433
    const z = pooledTwoProportionZ(60, 200, 40, 200)!;
    expect(z).toBeCloseTo(0.1 / Math.sqrt(0.25 * 0.75 * (1 / 200 + 1 / 200)), 12);
    expect(z).toBeGreaterThan(0);
  });

  it("tecknet följer argumentordningen", () => {
    expect(pooledTwoProportionZ(40, 200, 60, 200)!).toBeCloseTo(
      -pooledTwoProportionZ(60, 200, 40, 200)!,
      12,
    );
  });

  it("identiska proportioner ger exakt 0", () => {
    expect(pooledTwoProportionZ(50, 200, 25, 100)).toBe(0);
  });

  it("tom arm ⇒ null", () => {
    expect(pooledTwoProportionZ(0, 0, 5, 100)).toBeNull();
    expect(pooledTwoProportionZ(5, 100, 0, 0)).toBeNull();
    expect(pooledTwoProportionZ(0, -1, 5, 100)).toBeNull();
  });

  it("nolldivision (0 % eller 100 % i BÅDA armarna) ⇒ null", () => {
    expect(pooledTwoProportionZ(0, 100, 0, 100)).toBeNull();
    expect(pooledTwoProportionZ(100, 100, 50, 50)).toBeNull();
  });
});

// De två anroparnas grindar är OLIKA kontrakt mot olika konsumenter, och det
// är avsiktligt: aggregate svarar null ("ingen siffra att visa"), measure
// svarar { z: 0, p: 1 } ("ingen mätbar skillnad"). Sammanslagningen fick inte
// göra dem lika — testerna nedan låser bägge formerna.
describe("anroparnas grindkontrakt är oförändrade", () => {
  it("aggregate.twoProportionZ svarar null där kärnan gör det", () => {
    expect(twoProportionZ(0, 0, 5, 100)).toBeNull();
    expect(twoProportionZ(5, 100, 0, 0)).toBeNull();
    expect(twoProportionZ(0, 100, 0, 100)).toBeNull();
  });

  it("measure.twoProportionTest svarar { z: 0, p: 1 } där kärnan ger null", () => {
    expect(twoProportionTest({ n: 0, conversions: 0 }, { n: 100, conversions: 5 })).toEqual({
      z: 0,
      p: 1,
    });
    expect(twoProportionTest({ n: 100, conversions: 5 }, { n: 0, conversions: 0 })).toEqual({
      z: 0,
      p: 1,
    });
    // se === 0: bägge armarna 0 % — mätbar data, men ingen spridning att dela med.
    expect(twoProportionTest({ n: 100, conversions: 0 }, { n: 100, conversions: 0 })).toEqual({
      z: 0,
      p: 1,
    });
  });

  it("bägge anroparna räknar SAMMA z för samma data — dashboarden visar det motorn beslutar på", () => {
    for (const [c1, n1, c2, n2] of [
      [60, 200, 40, 200],
      [3, 31, 1, 29],
      [500, 10_000, 480, 10_000],
    ] as const) {
      const engine = twoProportionZ(c1, n1, c2, n2)!;
      const dashboard = twoProportionTest({ n: n1, conversions: c1 }, { n: n2, conversions: c2 }).z;
      expect(dashboard).toBe(engine);
    }
  });
});
