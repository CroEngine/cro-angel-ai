// Nattloopens söm (steg 11): de tre besluten som avgör VAD som hamnar i
// plans.json. Förut låg de inbakade i loopens IO-kropp och kunde bara
// granskas med ögat — granskningsfynd 2026-08-08: den serverade vägens
// största ändring hade noll test.
import { describe, expect, it } from "vitest";

import { catalogEligible, cellWorkDir, freezePriority, planRow } from "../cell-plan";

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

describe("freezePriority — trafik-rankad frysning med mall-topp-upp", () => {
  const lv = (path: string, visits: number) => ({ path, visits });

  it("rankar på TRAFIK, aldrig databasens/alfabetets ordning", () => {
    // needs_freeze-svälten (2026-08-16): den gamla kapningen tog de 10 första
    // i inkommande ordning — alfabetet avgjorde vem som fick frysas.
    const leaves = [lv("/a-liten", 5), lv("/z-stor", 900), lv("/m-mellan", 50)];
    expect(freezePriority(leaves, { topPages: 2 })).toEqual(["/z-stor", "/m-mellan"]);
  });

  it("mall-topp-upp: topp-mallens två största exemplar garanteras plats", () => {
    // Glutenforum-formen: bloggsidorna fyller sidtoppen, restaurang-mallen
    // bär näst mest trafik SAMLAT men ingen enskild sida når toppen — utan
    // topp-uppen fryses aldrig två exemplar och malldetektorn kan inte köra.
    const leaves = [
      lv("/", 200),
      lv("/blogg/a", 130),
      lv("/blogg/b", 120),
      lv("/blogg/c", 110),
      lv("/restauranger/x", 40),
      lv("/restauranger/y", 35),
      lv("/restauranger/z", 30),
    ];
    const got = freezePriority(leaves, { topPages: 4, topTemplates: 2 });
    expect(got.slice(0, 4)).toEqual(["/", "/blogg/a", "/blogg/b", "/blogg/c"]);
    expect(got).toContain("/restauranger/x");
    expect(got).toContain("/restauranger/y");
    // ...men inte hela svansen — två exemplar räcker för malldetektorn.
    expect(got).not.toContain("/restauranger/z");
  });

  it("en ensam sida är ingen mall — ingen topp-upp för den", () => {
    const got = freezePriority([lv("/", 100), lv("/blogg/ensam", 10)], { topPages: 1 });
    expect(got).toEqual(["/"]);
  });

  it("samma besök ⇒ deterministisk ordning (path-tiebreak), query/hash strippas", () => {
    const got = freezePriority([lv("/b?x=1", 10), lv("/a#y", 10)], { topPages: 2 });
    expect(got).toEqual(["/a", "/b"]);
  });

  it("aggregerar per sida över segmentlöv — summan rankar, inte största lövet", () => {
    const got = freezePriority([lv("/x", 40), lv("/x", 40), lv("/y", 60)], { topPages: 1 });
    expect(got).toEqual(["/x"]); // 80 > 60
  });
});

describe("catalogEligible", () => {
  it("vanlig cell ⇒ katalogen äger den", () => {
    expect(catalogEligible({ crossPageSources: 0 })).toEqual({
      eligible: true,
      skip: null,
    });
  });

  it("mall-cell ⇒ KATALOGEN (carve-outen lyft 2026-08-16)", () => {
    // v1-skälet föll: designervägen bygger/mäter mot samma enda representant
    // som proben går mot, och diagnostiken visade att alla tre återkommande
    // döda celler på pilotsajten var designer-ägda (påhittade id:n,
    // artikelrubriken som mål). Mallceller går nu genom menyn som alla andra.
    expect(catalogEligible({ crossPageSources: 0 })).toEqual({
      eligible: true,
      skip: null,
    });
  });

  it("korssid-cell ⇒ designern (katalogen kan inte citera en annan sida)", () => {
    // Granskningsfynd 2026-08-08: utan carve-outen tog konvergensen tyst bort
    // korssid-lyftet för exakt de celler som FÖRTJÄNATS på pris-flödessignalen.
    expect(catalogEligible({ crossPageSources: 1 })).toEqual({
      eligible: false,
      skip: "cross-page",
    });
  });

  it("move-only ⇒ korssid-carve-outen FALLER: katalogen tar cellen", () => {
    // Ägarbeslut 2026-08-15: carve-outen finns för ett insert_snippet som
    // citerar en annan sida. Kan designern inte producera det draget skyddar
    // carve-outen ingenting — den hade bara bytt katalogens beteende-rankade
    // flyttar mot en fri designer med EXAKT samma vokabulär och ingen meny.
    expect(catalogEligible({ crossPageSources: 2, mayInsert: false })).toEqual({
      eligible: true,
      skip: null,
    });
    // Explicit mayInsert:true beter sig som förut (utelämnad ⇒ samma).
    expect(catalogEligible({ crossPageSources: 1, mayInsert: true })).toEqual({
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
