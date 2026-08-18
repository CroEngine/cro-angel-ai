// Startsidans siffer-formning: regeln nollor döljs (sant men säljer emot ⇒
// utelämna, aldrig höj), singular/plural, och att fetch-fel ger tom lista i
// stället för hittepå-tiles. Ärlighetsregeln (ägarbeslut 2026-08-18) bor i
// den här formningen — testet låser den.
import { describe, expect, it } from "vitest";

import { LAB_SITES, statTiles, type PublicStats } from "../stats";

const stats = (over: Partial<PublicStats>): PublicStats => ({
  awaitingApproval: 0,
  measuringNow: 0,
  provenWinners: 0,
  previewsBuilt: 0,
  lastEngineActionAt: null,
  ...over,
});

describe("statTiles — ärliga live-siffror", () => {
  it("null (hämtningen föll) ⇒ tom lista, aldrig hittepå", () => {
    expect(statTiles(null)).toEqual([]);
  });

  it("nollor döljs — allt noll ⇒ inga tiles", () => {
    expect(statTiles(stats({}))).toEqual([]);
  });

  it("bara siffror > 0 renderas, vinnare först (starkaste beviset överst)", () => {
    const tiles = statTiles(
      stats({ provenWinners: 1, awaitingApproval: 2, measuringNow: 1, previewsBuilt: 9 }),
    );
    expect(tiles.map((t) => t.value)).toEqual(["1", "2", "1", "9"]);
    expect(tiles[0].label).toBe("proven winner");
  });

  it("singular/plural följer värdet", () => {
    const one = statTiles(stats({ awaitingApproval: 1, measuringNow: 1 }));
    expect(one.map((t) => t.label)).toEqual([
      "proposal awaiting an owner's click",
      "change measuring against control right now",
    ]);
    const many = statTiles(stats({ awaitingApproval: 2, previewsBuilt: 9 }));
    expect(many.map((t) => t.label)).toEqual([
      "proposals awaiting an owner's click",
      "free examples built on real sites",
    ]);
  });

  it("labb-exkluderingen känner till synthetic-lab", () => {
    // Byter labbet slug utan att uppdatera listan ⇒ labbvarianter blåser upp
    // publika siffror. Listan är kontraktet mellan formning och hämtning.
    expect(LAB_SITES).toContain("synthetic-lab");
  });
});
