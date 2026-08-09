// Serverings-säkerhetens smalaste kontrakt: DET SOM SERVERAS ÄR DET SOM
// GRINDADES. Kollisions-retryn lägger ETT extra lyft per unik lokator och
// grindar om — passerar andra försöket måste serve_ops bära samma antal lyft.
// Räknas de olika på de två sidorna servas exakt den layout som försök 1
// mätte som UNDERKÄND (granskningsfynd 2026-08-08).
import { describe, expect, it } from "vitest";

import { extraLiftFinds } from "../../../../scripts/redesign/measure";
import { uniqueLiftTargets, withExtraLift } from "../extra-lift";

import type { RedesignOp } from "../generate";
import type { MeasureOp } from "../../../../scripts/redesign/measure";

const HEADINGS: Record<string, string> = {
  "sec-2-testimonials": "Loved by teams everywhere",
  "sec-3-pricing": "Simple honest pricing",
  // Dubblett-rubriken: två sektioner, EN lokatortext.
  "sec-4-pricing-again": "Simple honest pricing",
};
const locatorTextFor = (id: string) => HEADINGS[id] ?? null;

const move = (targetId: string): RedesignOp => ({
  op: "move_up",
  targetId,
  detail: "",
  why: "proof above the fold",
});

describe("withExtraLift", () => {
  it("utan retry är planen orörd (identitet — inga fantomlyft)", () => {
    const ops = [move("sec-3-pricing")];
    expect(
      withExtraLift(ops, {
        extraLiftApplied: false,
        locatorTextFor,
        overlapAttempt1: 140,
        overlapAttempt2: 0,
      }),
    ).toEqual(ops);
  });

  it("med retry: ETT extra lyft per unik lokator, med grindtalen i why", () => {
    const ops = [move("sec-3-pricing"), move("sec-2-testimonials")];
    const out = withExtraLift(ops, {
      extraLiftApplied: true,
      locatorTextFor,
      overlapAttempt1: 140,
      overlapAttempt2: 0,
    });
    expect(out).toHaveLength(4);
    expect(out.slice(0, 2)).toEqual(ops);
    expect(out[2].detail).toContain("extra move 1/2");
    expect(out[2].why).toBe("attempt 1 introduced +140px overlap; attempt 2 +0px");
    expect(out.map((o) => o.targetId)).toEqual([
      "sec-3-pricing",
      "sec-2-testimonials",
      "sec-3-pricing",
      "sec-2-testimonials",
    ]);
  });

  it("två sektioner med SAMMA rubrik ger ETT extra lyft — lokatortexten dedupar", () => {
    const ops = [move("sec-3-pricing"), move("sec-4-pricing-again")];
    const out = withExtraLift(ops, {
      extraLiftApplied: true,
      locatorTextFor,
      overlapAttempt1: 120,
      overlapAttempt2: 10,
    });
    expect(out).toHaveLength(3); // 2 plan-ops + 1 lyft, inte 2
    expect(out[2].detail).toContain("extra move 1/1");
  });

  it("okänd lokator faller tillbaka på targetId — aldrig en tappad rad", () => {
    expect(uniqueLiftTargets([move("sec-okänd")], () => null)).toEqual([
      { targetId: "sec-okänd", text: "sec-okänd" },
    ]);
  });
});

describe("grind-loopen ⇄ serve-vägen räknar SAMMA antal lyft", () => {
  // Den faktiska buggens form: grind-loopen körde N lyft, serve-vägen skrev M.
  // Här jämförs de två räkningarna på samma plan, inte var för sig.
  const cases: { name: string; ops: RedesignOp[] }[] = [
    { name: "en flytt", ops: [move("sec-3-pricing")] },
    { name: "två olika flyttar", ops: [move("sec-3-pricing"), move("sec-2-testimonials")] },
    {
      name: "två flyttar med samma rubrik",
      ops: [move("sec-3-pricing"), move("sec-4-pricing-again")],
    },
    { name: "inga flyttar", ops: [] },
  ];
  for (const c of cases) {
    it(`${c.name}: mätsidans unika finds == serve-sidans extra ops`, () => {
      const measureOps: MeasureOp[] = c.ops.map((o) => ({
        op: "move_up",
        tag: "h2",
        find: locatorTextFor(o.targetId)!,
      }));
      const gatedLifts = extraLiftFinds(measureOps).length;
      const served = withExtraLift(c.ops, {
        extraLiftApplied: true,
        locatorTextFor,
        overlapAttempt1: 130,
        overlapAttempt2: 0,
      });
      expect(served.length - c.ops.length).toBe(gatedLifts);
    });
  }
});
