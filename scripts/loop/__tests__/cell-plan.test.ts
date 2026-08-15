// Nattloopens söm (steg 11): de tre besluten som avgör VAD som hamnar i
// plans.json. Förut låg de inbakade i loopens IO-kropp och kunde bara
// granskas med ögat — granskningsfynd 2026-08-08: den serverade vägens
// största ändring hade noll test.
import { describe, expect, it } from "vitest";

import { catalogEligible, cellWorkDir, planRow } from "../cell-plan";

import type { RedesignOp } from "../../../src/adaptive/redesign/generate";

const op = (targetId: string): RedesignOp => ({ op: "move_up", targetId, detail: "", why: "w" });

describe("cellWorkDir", () => {
  it("två olika celler kan ALDRIG dela katalog (saniteringen ensam är inte injektiv)", () => {
    // Exakt kollisionen: bindestrecket i path respektive nyckel byter plats.
    const a = cellWorkDir("/run", "/a-b", "c");
    const b = cellWorkDir("/run", "/a", "b-c");
    expect(a).not.toBe(b);
    // Samma cell ⇒ samma katalog (idempotent mellan nätter).
    expect(cellWorkDir("/run", "/a-b", "c")).toBe(a);
  });

  it("nyckelns segment-separator och tomma paths ger fortfarande ett läsbart namn", () => {
    const home = cellWorkDir("/run", "/", "google·mobile");
    expect(home.startsWith("/run/cell-")).toBe(true);
    expect(home).toMatch(/-[0-9a-f]{8}$/); // hash-suffixet finns alltid
    // Rena skräptecken får inte ge ett namnlöst "cell--<hash>".
    expect(cellWorkDir("/run", "···", "···")).toMatch(/\/cell-home-[0-9a-f]{8}$/);
  });
});

describe("catalogEligible", () => {
  it("vanlig cell ⇒ katalogen äger den", () => {
    expect(catalogEligible({ isTemplate: false, crossPageSources: 0 })).toEqual({
      eligible: true,
      skip: null,
    });
  });

  it("mall-cell ⇒ designern (v1: alt-stegen avstängd, proben går mot EN fil)", () => {
    expect(catalogEligible({ isTemplate: true, crossPageSources: 0 })).toEqual({
      eligible: false,
      skip: "template",
    });
  });

  it("korssid-cell ⇒ designern (katalogen kan inte citera en annan sida)", () => {
    // Granskningsfynd 2026-08-08: utan carve-outen tog konvergensen tyst bort
    // korssid-lyftet för exakt de celler som FÖRTJÄNATS på pris-flödessignalen.
    expect(catalogEligible({ isTemplate: false, crossPageSources: 1 })).toEqual({
      eligible: false,
      skip: "cross-page",
    });
  });

  it("move-only ⇒ korssid-carve-outen FALLER: katalogen tar cellen", () => {
    // Ägarbeslut 2026-08-15: carve-outen finns för ett insert_snippet som
    // citerar en annan sida. Kan designern inte producera det draget skyddar
    // carve-outen ingenting — den hade bara bytt katalogens beteende-rankade
    // flyttar mot en fri designer med EXAKT samma vokabulär och ingen meny.
    expect(catalogEligible({ isTemplate: false, crossPageSources: 2, mayInsert: false })).toEqual({
      eligible: true,
      skip: null,
    });
    // Mall-carve-outen är oberoende av vokabulären och står kvar.
    expect(catalogEligible({ isTemplate: true, crossPageSources: 2, mayInsert: false })).toEqual({
      eligible: false,
      skip: "template",
    });
    // Explicit mayInsert:true beter sig som förut (utelämnad ⇒ samma).
    expect(catalogEligible({ isTemplate: false, crossPageSources: 1, mayInsert: true })).toEqual({
      eligible: false,
      skip: "cross-page",
    });
  });
});

describe("planRow — producentsidan av plans.json-kontraktet", () => {
  const base = {
    path: "/",
    key: "google·mobile",
    total: { visits: 900, conversions: 30 },
    observations: ["obs"],
    ops: [op("sec-2")],
  };

  it("härkomsten är ALLTID med — ingen variant föds utan känd källa", () => {
    const row = planRow({ ...base, planSource: "katalog/floor" });
    expect(row.planSource).toBe("katalog/floor");
    expect(row.ops).toEqual([op("sec-2")]);
    expect(row.sourcePaths).toEqual([]);
  });

  it("tom reservlista utelämnas helt (verify läser plan.altOps ?? [])", () => {
    expect("altOps" in planRow({ ...base, planSource: "designer", altOps: [] })).toBe(false);
    const withAlts = planRow({
      ...base,
      planSource: "katalog/selector",
      altOps: [[op("sec-3")], [op("sec-4")]],
    });
    expect(withAlts.altOps).toEqual([[op("sec-3")], [op("sec-4")]]);
  });

  it("mall-fälten följer med bara för äkta mall-celler (≥2 exemplar)", () => {
    const tpl = planRow({
      ...base,
      path: "/blogg/*",
      planSource: "designer",
      templatePages: ["/blogg/a", "/blogg/b"],
      repPath: "/blogg/a",
    });
    expect(tpl.templatePages).toEqual(["/blogg/a", "/blogg/b"]);
    expect(tpl.repPath).toBe("/blogg/a");
    // path FÖRBLIR mönstret — det är värdet decide-vägen matchar via templateOf.
    expect(tpl.path).toBe("/blogg/*");
    // Ett ensamt "exemplar" är ingen mall.
    const notTpl = planRow({ ...base, planSource: "designer", templatePages: ["/blogg/a"] });
    expect("templatePages" in notTpl).toBe(false);
  });
});

describe("planRow — återbrukserbjudandena (blockbiblioteket steg 2)", () => {
  const base = {
    path: "/om-oss",
    key: "google·mobile",
    total: { visits: 100, conversions: 5 },
    observations: [],
    ops: [{ op: "move_up" as const, targetId: "sec-2", detail: "", why: "w" }],
    planSource: "katalog/selector",
  };
  const offer = {
    variantId: "11111111-aaaa-bbbb-cccc-000000000001",
    provedOnPath: "/priser",
    sourcePath: "/priser",
    text: "Från 299 kr per månad",
  };

  it("erbjudandena följer med KATALOG-raden — och källsidorna unionas in i sourcePaths", () => {
    // Unionen är verify-whitelistens kontrakt: utan källsidan i sourcePaths
    // hade validateOps fällt ett drag som proben redan grind-godkänt.
    const row = planRow({ ...base, sourcePaths: ["/flode"], reuseOffers: [offer] });
    expect(row.reuseOffers).toEqual([offer]);
    expect(row.sourcePaths).toEqual(["/flode", "/priser"]);
    // Dubbletter unionas bort.
    const dup = planRow({ ...base, sourcePaths: ["/priser"], reuseOffers: [offer] });
    expect(dup.sourcePaths).toEqual(["/priser"]);
  });

  it("designer-planer bär ALDRIG erbjudanden — gaten sitter i planRow, inte hos anroparen", () => {
    const row = planRow({ ...base, planSource: "designer", reuseOffers: [offer] });
    expect("reuseOffers" in row).toBe(false);
    expect(row.sourcePaths).toEqual([]); // ingen union heller
  });

  it("tom/utelämnad lista utelämnas helt (verify läser plan.reuseOffers ?? [])", () => {
    expect("reuseOffers" in planRow({ ...base })).toBe(false);
    expect("reuseOffers" in planRow({ ...base, reuseOffers: [] })).toBe(false);
  });

  // ── Flytt-erbjudandena (transferformen steg 4) ────────────────────────────
  const moveOffer = {
    variantId: "22222222-aaaa-bbbb-cccc-000000000002",
    provedOnPath: "/enterprise",
    sectionType: "testimonials",
  };

  it("flytt-erbjudandena följer med katalog-raden UTAN att vidga whitelisten", () => {
    // En flytt citerar ingen källsida: en union här hade tyst mjukat upp
    // D2-kontrollen (verify:s whitelist byggs ur sourcePaths).
    const row = planRow({ ...base, sourcePaths: ["/flode"], moveReuseOffers: [moveOffer] });
    expect(row.moveReuseOffers).toEqual([moveOffer]);
    expect(row.sourcePaths).toEqual(["/flode"]);
  });

  it("designer-planer bär aldrig flytt-erbjudanden heller", () => {
    const row = planRow({ ...base, planSource: "designer", moveReuseOffers: [moveOffer] });
    expect("moveReuseOffers" in row).toBe(false);
  });

  it("tom/utelämnad flyttlista utelämnas helt", () => {
    expect("moveReuseOffers" in planRow({ ...base })).toBe(false);
    expect("moveReuseOffers" in planRow({ ...base, moveReuseOffers: [] })).toBe(false);
  });

  it("bägge formerna kan bäras samtidigt — bara textens källsida unionas", () => {
    const row = planRow({ ...base, reuseOffers: [offer], moveReuseOffers: [moveOffer] });
    expect(row.reuseOffers).toEqual([offer]);
    expect(row.moveReuseOffers).toEqual([moveOffer]);
    expect(row.sourcePaths).toEqual(["/priser"]);
  });
});
