import { describe, it, expect } from "vitest";

import { normalizeDomain, headerHost, originVerdict } from "../domain";

describe("normalizeDomain — inmatning i alla former blir en kanonisk domän", () => {
  it("URL, värdnamn, www., port, sökväg, versaler", () => {
    expect(normalizeDomain("https://www.Exempel.se/sida?x=1")).toBe("exempel.se");
    expect(normalizeDomain("Exempel.se")).toBe("exempel.se");
    expect(normalizeDomain("www.exempel.se")).toBe("exempel.se");
    expect(normalizeDomain("exempel.se:8080")).toBe("exempel.se");
    expect(normalizeDomain("shop.exempel.se")).toBe("shop.exempel.se");
  });
  it("skräp blir null — aldrig en halv domän i databasen", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain("exempel")).toBeNull(); // ingen tld
    expect(normalizeDomain("not a url")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe("originVerdict — fail-closed på motbevis, fail-open på frånvaro", () => {
  it("ingen registrerad domän (legacy/labb) → tillåt utan bevis", () => {
    expect(originVerdict(null, "https://vemsomhelst.se", null)).toEqual({
      allowed: true,
      proved: false,
    });
  });
  it("matchande Origin → tillåt + BEVISAD (stämpelbar)", () => {
    expect(originVerdict("exempel.se", "https://exempel.se", null)).toEqual({
      allowed: true,
      proved: true,
    });
    // www. och underdomäner är samma sajt
    expect(originVerdict("exempel.se", "https://www.exempel.se", null).proved).toBe(true);
    expect(originVerdict("exempel.se", "https://shop.exempel.se", null).proved).toBe(true);
  });
  it("AVVIKANDE Origin → neka (nyckeln i HTML:en räcker aldrig)", () => {
    expect(originVerdict("exempel.se", "https://angripare.se", null).allowed).toBe(false);
    // suffix-fusk: "elakexempel.se" är INTE en underdomän till exempel.se
    expect(originVerdict("exempel.se", "https://elakexempel.se", null).allowed).toBe(false);
  });
  it("ingen Origin/Referer alls → tillåt men ALDRIG bevisad", () => {
    expect(originVerdict("exempel.se", null, null)).toEqual({ allowed: true, proved: false });
    expect(originVerdict("exempel.se", "null", null).proved).toBe(false); // Origin: null
  });
  it("Referer används som fallback när Origin saknas", () => {
    expect(originVerdict("exempel.se", null, "https://exempel.se/sida").proved).toBe(true);
    expect(originVerdict("exempel.se", null, "https://angripare.se/x").allowed).toBe(false);
  });
  it("loopback (dev) → tillåt utan bevis", () => {
    expect(originVerdict("exempel.se", "http://localhost:3000", null)).toEqual({
      allowed: true,
      proved: false,
    });
  });
});

describe("headerHost", () => {
  it("plockar värd ur Origin/Referer och normaliserar www.", () => {
    expect(headerHost("https://www.Exempel.se")).toBe("exempel.se");
    expect(headerHost("https://exempel.se/djup/sida")).toBe("exempel.se");
    expect(headerHost("null")).toBeNull();
    expect(headerHost("inte en url")).toBeNull();
  });
});
