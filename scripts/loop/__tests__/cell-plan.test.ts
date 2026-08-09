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
