import { describe, it, expect } from "vitest";

import { previewPagePath } from "../preview-path";

// "Se live"-vägen för mall-varianter (buggfynd 2026-07-27): mönstret /blogg/*
// är ingen riktig URL — spegeln blev vit. Förhandsvisningen ska öppna
// representant-sidan ur bevisblocket, aldrig mönstret.

describe("previewPagePath — mall-varianter öppnas på representant-sidan", () => {
  const evidence = {
    template: {
      pattern: "/blogg/*",
      pages: [
        "/blogg/den-ultimata-guiden-till-glutenfri-kladdkaka",
        "/blogg/korskontaminering-gluten-sakert-kok",
      ],
      repPath: "/blogg/den-ultimata-guiden-till-glutenfri-kladdkaka",
    },
  };

  it("mall-variant → repPath (glutenforum-fallet)", () => {
    expect(previewPagePath("/blogg/*", evidence)).toBe(
      "/blogg/den-ultimata-guiden-till-glutenfri-kladdkaka",
    );
  });

  it("per-sida-variant → pathen orörd, bevisblocket ignoreras", () => {
    expect(previewPagePath("/recept/glutenfri-kladdkaka", evidence)).toBe(
      "/recept/glutenfri-kladdkaka",
    );
  });

  it("utan repPath → första mall-sidan", () => {
    const e = { template: { pages: ["/blogg/a", "/blogg/b"] } };
    expect(previewPagePath("/blogg/*", e)).toBe("/blogg/a");
  });

  it("skräp eller tomt bevisblock → mönstret oförändrat (spegelns felväg får tala)", () => {
    expect(previewPagePath("/blogg/*", null)).toBe("/blogg/*");
    expect(previewPagePath("/blogg/*", {})).toBe("/blogg/*");
    expect(previewPagePath("/blogg/*", { template: { repPath: 7, pages: "x" } })).toBe("/blogg/*");
    // en repPath som SJÄLV är ett mönster eller relativ duger inte
    expect(previewPagePath("/blogg/*", { template: { repPath: "/blogg/*" } })).toBe("/blogg/*");
    expect(previewPagePath("/blogg/*", { template: { repPath: "blogg/a" } })).toBe("/blogg/*");
  });
});
