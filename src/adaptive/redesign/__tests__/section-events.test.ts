// Steg 10-bryggan: events → observationer. Ren aritmetik, CI-grindad.
import { describe, expect, it } from "vitest";

import { aggregateSectionObservations } from "../section-events";

const load = (
  ...sections: { h: string; n?: number; d?: number }[]
): { sections: { h: string; n?: number; d?: number }[] } => ({ sections });

describe("aggregateSectionObservations", () => {
  it("visits = laddningar som bar sektionen; engagement = andel med d ≥ tröskeln", () => {
    const obs = aggregateSectionObservations([
      load({ h: "Simple pricing", d: 2500 }, { h: "Loved by teams", d: 0 }),
      load({ h: "Simple pricing", d: 300 }, { h: "Loved by teams", d: 1400 }),
      load({ h: "Simple pricing", d: 1000 }), // exakt tröskeln räknas som sedd
    ]);
    const pricing = obs.find((o) => o.heading === "Simple pricing")!;
    expect(pricing.visits).toBe(3);
    expect(pricing.engagement).toBeCloseTo(2 / 3, 10);
    const loved = obs.find((o) => o.heading === "Loved by teams")!;
    expect(loved.visits).toBe(2);
    expect(loved.engagement).toBeCloseTo(1 / 2, 10);
  });

  it("nyckeln är den delade normaliseringen — case/blanksteg poolas, EN räkning per laddning", () => {
    const obs = aggregateSectionObservations([
      load({ h: "Our  Plans", d: 1500 }, { h: "our plans", d: 0 }), // samma nyckel — en räkning
      load({ h: "OUR PLANS", d: 0 }),
    ]);
    expect(obs).toHaveLength(1);
    expect(obs[0].visits).toBe(2);
    expect(obs[0].engagement).toBeCloseTo(1 / 2, 10);
  });

  it("instances = max n över laddningarna (drift ⇒ osäkerhet ⇒ FLERTYDIG-dom)", () => {
    const obs = aggregateSectionObservations([
      load({ h: "Our plans", n: 1, d: 1200 }),
      load({ h: "Our plans", n: 2, d: 1200 }), // sidan ändrades — dubblerad rubrik
    ]);
    expect(obs[0].instances).toBe(2);
  });

  it("trasiga poster släpps tyst; tom input ⇒ tom lista", () => {
    const obs = aggregateSectionObservations([
      { sections: undefined },
      load({ h: "", d: 5000 }),
      load({ h: "Real heading", d: 1500 }, { h: 123 as unknown as string, d: 1 }),
    ]);
    expect(obs).toHaveLength(1);
    expect(obs[0].heading).toBe("Real heading");
    expect(aggregateSectionObservations([])).toEqual([]);
  });

  it("deterministisk ordning: flest besök först, sedan rubrik", () => {
    const obs = aggregateSectionObservations([
      load({ h: "Beta", d: 0 }, { h: "Alfa", d: 0 }),
      load({ h: "Beta", d: 0 }),
    ]);
    expect(obs.map((o) => o.heading)).toEqual(["Beta", "Alfa"]);
  });
});
