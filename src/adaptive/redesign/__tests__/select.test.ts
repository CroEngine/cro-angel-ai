// Väljarens kontrakt: menyfiltret följer proben, valet valideras hårt mot
// menyn, golvet är deterministiskt, prompten bär alla id:n.
import { describe, it, expect } from "vitest";

import type { Candidate } from "../candidates";
import {
  applyProbe,
  buildSelectionPrompt,
  resolveSelection,
  floorSelection,
} from "../select";

const menuOf = (): Candidate[] => [
  {
    id: "mv-sec-3",
    kind: "move_up",
    targetId: "sec-3",
    detail: "",
    score: 3,
    basis: "testimonials under folden",
  },
  {
    id: "ins-trusted_by-0",
    kind: "insert_snippet",
    targetId: "hero",
    detail: "Trusted by the world's best",
    score: 2.8,
    basis: 'trusted_by: "Trusted by the world\'s best"',
  },
  {
    id: "insh-sec-3",
    kind: "insert_snippet",
    targetId: "hero",
    detail: "Don't just take our word for it",
    score: 1.8,
    basis: "rubriken",
  },
];

describe("applyProbe", () => {
  it("filtrerar oapplicerbara och binder after_h1 när default är täckt", () => {
    const menu = applyProbe(menuOf(), [
      { id: "mv-sec-3", applicable: false, reason: "ovanför hjälten" },
      { id: "ins-trusted_by-0", applicable: true, placements: ["after_h1"] },
      { id: "insh-sec-3", applicable: true, placements: ["default", "after_h1"] },
    ]);
    expect(menu.map((c) => c.id)).toEqual(["ins-trusted_by-0", "insh-sec-3"]);
    expect(menu[0].placement).toBe("after_h1");
    expect(menu[1].placement).toBeUndefined();
  });

  it("insert utan någon oskymd placering försvinner ur menyn", () => {
    const menu = applyProbe(menuOf(), [
      { id: "mv-sec-3", applicable: true },
      { id: "ins-trusted_by-0", applicable: true, placements: [] },
      { id: "insh-sec-3", applicable: false },
    ]);
    expect(menu.map((c) => c.id)).toEqual(["mv-sec-3"]);
  });
});

describe("resolveSelection", () => {
  const menu = applyProbe(
    menuOf(),
    menuOf().map((c) => ({ id: c.id, applicable: true })),
  );

  it("giltigt val ⇒ vald först, ranking sedan, resten i poängordning", () => {
    const s = resolveSelection(
      { chosenId: "ins-trusted_by-0", ranking: ["insh-sec-3"], why: "Socialt bevis direkt under rubriken." },
      menu,
    )!;
    expect(s.source).toBe("selector");
    expect(s.ordered.map((c) => c.id)).toEqual(["ins-trusted_by-0", "insh-sec-3", "mv-sec-3"]);
  });

  it("id utanför menyn, trasig form eller tom why ⇒ null (golvet tar över)", () => {
    expect(resolveSelection({ chosenId: "hittepå-id", why: "lång nog motivering" }, menu)).toBeNull();
    expect(resolveSelection("inte ett objekt", menu)).toBeNull();
    expect(resolveSelection({ chosenId: "mv-sec-3", why: "kort" }, menu)).toBeNull();
  });

  it("golvet är poängordningen, märkt regelvald", () => {
    const s = floorSelection(menu)!;
    expect(s.source).toBe("floor");
    expect(s.ordered[0].id).toBe("mv-sec-3");
    expect(s.why).toContain("Rule-selected");
    expect(floorSelection([])).toBeNull();
  });
});

describe("buildSelectionPrompt", () => {
  it("bär alla meny-id:n och det obetrodda-kontraktet", () => {
    const p = buildSelectionPrompt({
      heroHeadline: "Describe who you want to hire",
      segmentLabel: "google · mobile",
      observations: ["FÖRHANDSVISNING: ingen riktig besöksdata."],
      menu: menuOf(),
    });
    for (const c of menuOf()) expect(p).toContain(`[${c.id}]`);
    expect(p).toContain("untrusted page content");
    expect(p).toContain('"chosenId"');
  });
});
