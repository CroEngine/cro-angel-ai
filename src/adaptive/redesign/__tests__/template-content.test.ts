import { describe, it, expect } from "vitest";

import { filterToTemplateSections, sharedTemplateHeadings } from "../template-content";

import type { RedesignContentModel } from "../context";

const model = (headings: [string, string][]): RedesignContentModel => ({
  sections: headings.map(([type, heading], i) => ({
    id: `sec-${i + 1}-${type}`,
    type,
    position: i + 1,
    heading,
    aboveFold: i === 0,
    visualWeight: 80 - i * 10,
  })),
  trustSignals: [],
  ctas: [],
  hero: { headline: headings[0]?.[1] ?? "" },
});

// Glutenforum-formen: h1 är artikelns titel (sid-unik), "Vanliga frågor" och
// "Kommentarer" delas av mallen.
const A = model([
  ["hero", "Glutenfri kladdkaka – recept & guide"],
  ["section", "Ingredienser"],
  ["faq", "Vanliga frågor"],
  ["section", "Kommentarer"],
]);
const B = model([
  ["hero", "Guiden till fantastiskt glutenfritt bröd"],
  ["faq", "Vanliga  frågor"], // extra whitespace — normaliseras
  ["section", "Kommentarer"],
]);
const C = model([
  ["hero", "Korskontaminering – säkert kök"],
  ["faq", "VANLIGA FRÅGOR"], // annan casing — normaliseras
  ["section", "Kommentarer"],
  ["section", "Relaterade inlägg"],
]);

describe("sharedTemplateHeadings — mall-snittet", () => {
  it("ger rubrikerna som finns på ALLA exemplar, aldrig hero", () => {
    expect(sharedTemplateHeadings([A, B, C])).toEqual(["Vanliga frågor", "Kommentarer"]);
  });

  it("sid-unika sektioner ('Ingredienser', 'Relaterade inlägg') åker ut", () => {
    const shared = sharedTemplateHeadings([A, B, C]);
    expect(shared).not.toContain("Ingredienser");
    expect(shared).not.toContain("Relaterade inlägg");
  });

  it("behåller första modellens casing (läsbara lokatorer)", () => {
    expect(sharedTemplateHeadings([C, A])).toContain("VANLIGA FRÅGOR");
  });

  it("tomt snitt när inget delas — ärlig noll-designyta", () => {
    const other = model([
      ["hero", "X"],
      ["section", "Helt annat"],
    ]);
    expect(sharedTemplateHeadings([A, other])).toEqual([]);
    expect(sharedTemplateHeadings([])).toEqual([]);
  });
});

describe("filterToTemplateSections — designytan", () => {
  it("behåller bara snitt-sektionerna som op-mål; hero-fältet står kvar som kontext", () => {
    const shared = sharedTemplateHeadings([A, B, C]);
    const filtered = filterToTemplateSections(A, shared);
    expect(filtered.sections.map((s) => s.heading)).toEqual(["Vanliga frågor", "Kommentarer"]);
    expect(filtered.hero?.headline).toBe("Glutenfri kladdkaka – recept & guide");
    // Ursprungsmodellen orörd (ren funktion).
    expect(A.sections).toHaveLength(4);
  });

  it("normaliserad matchning: casing/whitespace i snittet fäller inte sektionen", () => {
    const filtered = filterToTemplateSections(B, ["vanliga frågor", "KOMMENTARER"]);
    expect(filtered.sections.map((s) => s.heading)).toEqual(["Vanliga  frågor", "Kommentarer"]);
  });
});
