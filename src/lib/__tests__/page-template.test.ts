import { describe, it, expect } from "vitest";

import { isTemplatePattern, templateMatches, templateOf } from "../page-template";

describe("templateOf — den deterministiska mallregeln", () => {
  it("artikelsidor får sitt första segment som mall", () => {
    expect(templateOf("/blogg/den-ultimata-guiden-till-glutenfri-kladdkaka")).toBe("/blogg/*");
    expect(templateOf("/restauranger/tavolo-goteborg-mo660hr9")).toBe("/restauranger/*");
    expect(templateOf("/matvaror/butik/estrella-damm")).toBe("/matvaror/*"); // djup 3 → första segmentet
  });

  it("startsidan och förstasegments-sidor är sina egna mallar (null)", () => {
    expect(templateOf("/")).toBeNull();
    expect(templateOf("/blogg")).toBeNull(); // listningen delar inte artikelmallen
    expect(templateOf("/blogg/")).toBeNull(); // trailing slash normaliseras först
  });

  it("query/hash och trailing slash påverkar inte mallen", () => {
    expect(templateOf("/blogg/x?utm_source=google")).toBe("/blogg/*");
    expect(templateOf("/blogg/x#kommentarer")).toBe("/blogg/*");
    expect(templateOf("/blogg/x/")).toBe("/blogg/*");
  });

  it("mönster och skräp ger null — aldrig en mall av en mall", () => {
    expect(templateOf("/blogg/*")).toBeNull();
    expect(templateOf("blogg/x")).toBeNull(); // relativ path
    expect(templateOf("")).toBeNull();
  });
});

describe("isTemplatePattern + templateMatches — serve-vägens matchning", () => {
  it("känner igen mönster och skiljer dem från konkreta sidor", () => {
    expect(isTemplatePattern("/blogg/*")).toBe(true);
    expect(isTemplatePattern("/blogg/kladdkaka")).toBe(false);
    expect(isTemplatePattern("/*")).toBe(false); // rot-mönster finns inte
  });

  it("matchar konkreta sidor via samma regel som bygget", () => {
    expect(templateMatches("/blogg/*", "/blogg/kladdkaka")).toBe(true);
    expect(templateMatches("/blogg/*", "/blogg")).toBe(false); // listningen ingår inte
    expect(templateMatches("/blogg/*", "/restauranger/tavolo")).toBe(false);
    expect(templateMatches("/blogg/kladdkaka", "/blogg/kladdkaka")).toBe(false); // ej mönster
  });
});
