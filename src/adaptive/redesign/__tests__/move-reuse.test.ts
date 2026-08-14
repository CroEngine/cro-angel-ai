// Flytt-vinnarnas transferform (steg 4, ägarbeslut 2026-08-14 "Flytta!") —
// vakternas kontrakt. Skillnaden mot textblockens är hela poängen: fröet bär
// bara TYPKLASSEN, viabiliteten är målsidans EGEN katalog, och ingen text
// importeras någonsin (D2 håller by construction).
import { describe, expect, it } from "vitest";

import {
  REUSE_MAX_SPREAD,
  MAX_REUSE_OFFERS_PER_CELL,
  blockTransferRecords,
  decorateMoveSeedsWithTransfer,
  harvestMoveSeeds,
  moveReuseSurvived,
  moveSectionType,
  moveSeedSaturated,
  moveTransferRecords,
  offerMoveSeedsForCell,
  partitionFalsifiedMoves,
  type ReuseVariantRow,
} from "../reuse";

const moveWinner = (over: Partial<ReuseVariantRow> = {}): ReuseVariantRow => ({
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  path: "/priser",
  status: "winner",
  held_reason: null,
  ops: [{ op: "move_up", targetId: "sec-4-testimonials", detail: "", why: "won" }],
  ...over,
});

describe("moveSectionType — typklassen ur targetId", () => {
  it("plockar typen ur extract.ts sec-N-typ-form", () => {
    expect(moveSectionType("sec-4-testimonials")).toBe("testimonials");
    expect(moveSectionType("sec-12-social_proof_count")).toBe("social_proof_count");
  });

  it("allt som inte bär formen ger null — hellre inget frö än ett gissat", () => {
    for (const bad of ["hero", "sec-testimonials", "testimonials", "", null, 42, undefined]) {
      expect(moveSectionType(bad)).toBeNull();
    }
  });
});

describe("harvestMoveSeeds — vem är en bevisad flytt", () => {
  it("skördar vinnarens typklass med proveniens", () => {
    expect(harvestMoveSeeds([moveWinner()])).toEqual([
      {
        variantId: "11111111-aaaa-bbbb-cccc-000000000001",
        provedOnPath: "/priser",
        sectionType: "testimonials",
      },
    ]);
  });

  it("bara vinnare: candidate/verified/serving/retired skördas aldrig", () => {
    for (const status of ["candidate", "verified", "serving", "retired"]) {
      expect(harvestMoveSeeds([moveWinner({ status })])).toEqual([]);
    }
  });

  it("hållna och drift-uppdaterade vinnare skördas inte — samma dom som textskörden", () => {
    expect(harvestMoveSeeds([moveWinner({ held_reason: "guardrail: skada" })])).toEqual([]);
    expect(
      harvestMoveSeeds([moveWinner({ evidence: { refreshedAt: "2026-08-13T02:00:00Z" } })]),
    ).toEqual([]);
  });

  it("otypade klasser (section/content) och hero skördas ALDRIG — de reser inte", () => {
    // "section" är rubrikklassificeringens ärliga "vet inte": två otypade
    // sektioner på olika sidor delar ingenting, så hypotesen är innehållslös.
    for (const t of ["section", "content", "hero"]) {
      expect(
        harvestMoveSeeds([moveWinner({ ops: [{ op: "move_up", targetId: `sec-2-${t}` }] })]),
      ).toEqual([]);
    }
  });

  it("textblocks-vinnare skördas inte som flytt", () => {
    const textWinner = moveWinner({
      ops: [{ op: "insert_snippet", targetId: "hero", detail: "Från 299 kr", sourcePath: "/p" }],
    });
    expect(harvestMoveSeeds([textWinner])).toEqual([]);
  });

  it("två vinnare av samma typklass är ETT frö — äldsta vinnaren äger det", () => {
    const second = moveWinner({
      id: "22222222-aaaa-bbbb-cccc-000000000002",
      path: "/enterprise",
      ops: [{ op: "move_up", targetId: "sec-7-testimonials" }],
    });
    const seeds = harvestMoveSeeds([moveWinner(), second]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].provedOnPath).toBe("/priser");
  });

  it("trasiga ops-former släpps tyst", () => {
    expect(harvestMoveSeeds([moveWinner({ ops: "garbage" })])).toEqual([]);
    expect(harvestMoveSeeds([moveWinner({ ops: null })])).toEqual([]);
    expect(harvestMoveSeeds([moveWinner({ ops: [{ op: "move_up" }] })])).toEqual([]);
    expect(harvestMoveSeeds([moveWinner({ ops: [{ op: "move_up", targetId: 7 }] })])).toEqual([]);
  });
});

describe("moveTransferRecords — flyttens meritlista", () => {
  const retiredMove = (over: Partial<ReuseVariantRow> = {}): ReuseVariantRow => ({
    id: "33333333-aaaa-bbbb-cccc-000000000003",
    path: "/blogg",
    status: "retired",
    ops: [{ op: "move_up", targetId: "sec-5-testimonials" }],
    evidence: { reuse: { kind: "move", provedOnPath: "/priser", variantId: "x" } },
    ...over,
  });

  it("vinster per typklass, distinkta sidor", () => {
    const second = moveWinner({
      id: "22222222-aaaa-bbbb-cccc-000000000002",
      path: "/enterprise",
      ops: [{ op: "move_up", targetId: "sec-2-testimonials" }],
    });
    const recs = moveTransferRecords([moveWinner(), second]);
    expect(recs.get("testimonials")?.wonOnPaths).toEqual(["/priser", "/enterprise"]);
  });

  it("pensionerade FLYTT-återbruk är misslyckanden", () => {
    const recs = moveTransferRecords([retiredMove()]);
    expect(recs.get("testimonials")?.failedOnPaths).toEqual(["/blogg"]);
  });

  it("vunnen-och-tillbakadragen är neutral (wasWinner) — inte ett misslyckande", () => {
    const recs = moveTransferRecords([
      retiredMove({
        evidence: { reuse: { kind: "move", provedOnPath: "/priser" }, wasWinner: true },
      }),
    ]);
    expect(recs.get("testimonials")?.failedOnPaths ?? []).toEqual([]);
  });

  it("organiskt pensionerade flyttar (utan reuse-märke) är inte misslyckanden", () => {
    expect(moveTransferRecords([retiredMove({ evidence: {} })]).size).toBe(0);
  });

  it("TEXT-återbrukets pensioneringar smittar aldrig flyttens meritlista", () => {
    // Kind-gränsen (steg 4): en pensionerad textblocks-variant som RÅKAR
    // bära en move-op säger ingenting om typklassens överförbarhet.
    const textReuseRetired = retiredMove({
      evidence: { reuse: { provedOnPath: "/priser", variantId: "x" } },
      ops: [
        { op: "insert_snippet", targetId: "hero", detail: "Från 299 kr", sourcePath: "/priser" },
        { op: "move_up", targetId: "sec-5-testimonials" },
      ],
    });
    expect(moveTransferRecords([textReuseRetired]).size).toBe(0);
    // …och åt andra hållet: flytt-återbrukets pensionering dömer inget block.
    const moveReuseRetired = retiredMove({
      ops: [
        { op: "move_up", targetId: "sec-5-testimonials" },
        { op: "insert_snippet", targetId: "hero", detail: "Från 299 kr", sourcePath: "/priser" },
      ],
    });
    const textRecs = blockTransferRecords([moveReuseRetired]);
    expect(textRecs.get("från 299 kr")?.failedOnPaths ?? []).toEqual([]);
  });
});

describe("decorateMoveSeedsWithTransfer — meriter + rankning", () => {
  it("listar ANDRA vunna sidor sorterat och rankar bevisade resenärer först", () => {
    const single = moveWinner({ ops: [{ op: "move_up", targetId: "sec-3-pricing" }] });
    const traveller = moveWinner({
      id: "44444444-aaaa-bbbb-cccc-000000000004",
      path: "/a",
      ops: [{ op: "move_up", targetId: "sec-3-testimonials" }],
    });
    const seeds = harvestMoveSeeds([single, traveller]);
    const recs = new Map([
      ["pricing", { wonOnPaths: ["/priser"], failedOnPaths: [] }],
      ["testimonials", { wonOnPaths: ["/a", "/z", "/b"], failedOnPaths: [] }],
    ]);
    const out = decorateMoveSeedsWithTransfer(seeds, recs);
    expect(out[0].sectionType).toBe("testimonials");
    expect(out[0].alsoWonOn).toEqual(["/b", "/z"]);
    expect(out[1].alsoWonOn).toBeUndefined();
  });
});

describe("partitionFalsifiedMoves — typklassen kan motbevisas", () => {
  it("fallen på REUSE_FALSIFIED_AT distinkta sidor ⇒ lämnar biblioteket", () => {
    const seeds = harvestMoveSeeds([moveWinner()]);
    const recs = new Map([
      ["testimonials", { wonOnPaths: ["/priser"], failedOnPaths: ["/a", "/b"] }],
    ]);
    const { kept, falsified } = partitionFalsifiedMoves(seeds, recs);
    expect(kept).toEqual([]);
    expect(falsified).toHaveLength(1);
  });

  it("ett enda fall är sidbundet, inte ett mönster", () => {
    const seeds = harvestMoveSeeds([moveWinner()]);
    const recs = new Map([["testimonials", { wonOnPaths: [], failedOnPaths: ["/a"] }]]);
    expect(partitionFalsifiedMoves(seeds, recs).kept).toHaveLength(1);
  });
});

describe("offerMoveSeedsForCell — vakterna", () => {
  const seeds = harvestMoveSeeds([moveWinner()]);
  const catalog = new Set(["testimonials", "pricing"]);
  const offer = (over: Partial<Parameters<typeof offerMoveSeedsForCell>[0]> = {}) =>
    offerMoveSeedsForCell({
      seeds,
      cellPath: "/kunder",
      catalogMoveTypes: catalog,
      rows: [],
      ...over,
    });

  it("erbjuder typklassen på en systersida vars katalog bär den", () => {
    expect(offer()).toHaveLength(1);
  });

  it("aldrig sidan flytten vann på", () => {
    expect(offer({ cellPath: "/priser" })).toEqual([]);
  });

  it("VIABILITETEN är målsidans egen katalog — utan matchande move-kandidat, inget erbjudande", () => {
    // Täcker också "sektionen står redan över folden": då genererar katalogen
    // ingen move-kandidat för den, så typen finns inte i mängden.
    expect(offer({ catalogMoveTypes: new Set(["pricing"]) })).toEqual([]);
    expect(offer({ catalogMoveTypes: new Set() })).toEqual([]);
  });

  it("aldrig en sida där typklassen redan prövats och pensionerats", () => {
    const records = new Map([["testimonials", { wonOnPaths: [], failedOnPaths: ["/kunder"] }]]);
    expect(offer({ records })).toEqual([]);
    // …men ett fall på en ANNAN sida stoppar inte den här cellen.
    expect(
      offer({ records: new Map([["testimonials", { wonOnPaths: [], failedOnPaths: ["/x"] }]]) }),
    ).toHaveLength(1);
  });

  it("aldrig en sida som redan har en levande flytt-variant av typen", () => {
    const rows: ReuseVariantRow[] = [
      {
        id: "r1",
        path: "/kunder",
        status: "verified",
        ops: [{ op: "move_up", targetId: "sec-9-testimonials" }],
      },
    ];
    expect(offer({ rows })).toEqual([]);
    // Pensionerad rad räknas inte som "redan här" (den vakten är records).
    expect(offer({ rows: [{ ...rows[0], status: "retired" }] })).toHaveLength(1);
  });

  it("mättnadstaket: högst REUSE_MAX_SPREAD andra sidor bär typklassen samtidigt", () => {
    const rows: ReuseVariantRow[] = Array.from({ length: REUSE_MAX_SPREAD }, (_, i) => ({
      id: `r${i}`,
      path: `/annan-${i}`,
      status: "serving",
      ops: [{ op: "move_up", targetId: "sec-3-testimonials" }],
    }));
    expect(offer({ rows })).toEqual([]);
    expect(offer({ rows: rows.slice(0, REUSE_MAX_SPREAD - 1) })).toHaveLength(1);
  });

  it("vinnarens EGEN sida räknas inte mot mättnadstaket", () => {
    const rows: ReuseVariantRow[] = [
      {
        id: "w",
        path: "/priser",
        status: "winner",
        ops: [{ op: "move_up", targetId: "sec-4-testimonials" }],
      },
    ];
    expect(moveSeedSaturated(seeds[0], rows)).toBe(false);
  });

  it("högst MAX_REUSE_OFFERS_PER_CELL frön per cell", () => {
    const many = harvestMoveSeeds([
      moveWinner({ id: "a", path: "/a", ops: [{ op: "move_up", targetId: "sec-1-testimonials" }] }),
      moveWinner({ id: "b", path: "/b", ops: [{ op: "move_up", targetId: "sec-1-pricing" }] }),
      moveWinner({ id: "c", path: "/c", ops: [{ op: "move_up", targetId: "sec-1-logos" }] }),
    ]);
    expect(many).toHaveLength(3);
    const out = offerMoveSeedsForCell({
      seeds: many,
      cellPath: "/kunder",
      catalogMoveTypes: new Set(["testimonials", "pricing", "logos"]),
      rows: [],
    });
    expect(out).toHaveLength(MAX_REUSE_OFFERS_PER_CELL);
  });
});

describe("moveReuseSurvived — proveniensens ärlighet", () => {
  const offer = { sectionType: "testimonials" };

  it("sant när slutvarianten flyttar en sektion av typen", () => {
    expect(moveReuseSurvived([{ op: "move_up", targetId: "sec-9-testimonials" }], offer)).toBe(
      true,
    );
  });

  it("falskt när alt-stegen bytte till en annan typklass", () => {
    expect(moveReuseSurvived([{ op: "move_up", targetId: "sec-2-pricing" }], offer)).toBe(false);
  });

  it("falskt när bevis-lyftet bytte flytten mot en insert", () => {
    expect(moveReuseSurvived([{ op: "insert_snippet", targetId: "hero" }], offer)).toBe(false);
  });

  it("falskt för tomma/trasiga slut-ops", () => {
    expect(moveReuseSurvived([], offer)).toBe(false);
    expect(moveReuseSurvived([{ op: "move_up" }], offer)).toBe(false);
  });
});
