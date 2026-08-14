import { describe, it, expect } from "vitest";

import {
  NEW_TOKEN,
  RETURNING_TOKEN,
  SEG_SEP,
  UNKNOWN_TOKEN,
  fullSegmentKey,
  isDimsPrefix,
  isSegmentPrefix,
  parentSegmentKey,
  segToken,
  segmentDepth,
  segmentDims,
  segmentKeyOf,
  segmentKeysRelated,
} from "../segment-key";

// Modulen är systemets lingua franca (task #89): rollupen, detektorn,
// serve-vägen och dashboarden bygger/matchar nycklar HÄR. Tokens är lagrad
// DATA (variant-nycklar i prod) — testerna pinnar de exakta strängarna så
// en välmenande "översättning" aldrig kan glida in.

describe("segToken — ärlig 'okänd'-hink", () => {
  it("behåller trimmad token och ersätter null/tom/blank med 'okänd'", () => {
    expect(segToken("google")).toBe("google");
    expect(segToken("  google  ")).toBe("google");
    expect(segToken(null)).toBe(UNKNOWN_TOKEN);
    expect(segToken(undefined)).toBe(UNKNOWN_TOKEN);
    expect(segToken("")).toBe(UNKNOWN_TOKEN);
    expect(segToken("   ")).toBe(UNKNOWN_TOKEN);
  });

  it("pinnar de lagrade tokensträngarna (data, inte UI)", () => {
    expect(UNKNOWN_TOKEN).toBe("okänd");
    expect(RETURNING_TOKEN).toBe("återkommande");
    expect(NEW_TOKEN).toBe("ny");
    expect(SEG_SEP).toBe("·");
  });
});

describe("fullSegmentKey — besökarnyckeln i rollupens format", () => {
  it("bygger kanal·enhet·land·ny/återkommande", () => {
    expect(fullSegmentKey("google", "mobile", "se", false)).toBe("google·mobile·se·ny");
    expect(fullSegmentKey("instagram", "mobile", "SE", true)).toBe(
      "instagram·mobile·SE·återkommande",
    );
  });

  it("saknade dimensioner blir 'okänd' — aldrig utelämnade (djupet är alltid 4)", () => {
    expect(fullSegmentKey(null, "", "us", false)).toBe("okänd·okänd·us·ny");
    expect(segmentDepth(fullSegmentKey(null, null, null, true))).toBe(4);
  });
});

describe("parse + bygge är inverser", () => {
  it("segmentDims ∘ segmentKeyOf = identitet", () => {
    const dims = ["google", "mobile", "se", "ny"];
    expect(segmentDims(segmentKeyOf(dims))).toEqual(dims);
    expect(segmentKeyOf(segmentDims("google·mobile"))).toBe("google·mobile");
  });

  it("segmentDepth räknar dimensioner", () => {
    expect(segmentDepth("google")).toBe(1);
    expect(segmentDepth("google·mobile·se·ny")).toBe(4);
  });
});

describe("isSegmentPrefix — dimension-vis, aldrig råsträng", () => {
  it("matchar hela tokens, grov→fin", () => {
    expect(isSegmentPrefix("google", "google·mobile·se·ny")).toBe(true);
    expect(isSegmentPrefix("google·mobile", "google·mobile·se·ny")).toBe(true);
    expect(isSegmentPrefix("google·mobile·se·ny", "google·mobile·se·ny")).toBe(true);
  });

  it("'go' matchar aldrig 'google' (serve-vägens säkerhetsregel)", () => {
    expect(isSegmentPrefix("go", "google·mobile")).toBe(false);
    expect(isSegmentPrefix("google·mob", "google·mobile")).toBe(false);
  });

  it("tom prefix-nyckel matchar ingenting; djupare-än-full matchar inte", () => {
    expect(isSegmentPrefix("", "google")).toBe(false);
    expect(isSegmentPrefix("google·mobile", "google")).toBe(false);
  });

  it("isDimsPrefix speglar samma regel på splittade dims", () => {
    expect(isDimsPrefix(["google"], ["google", "mobile"])).toBe(true);
    expect(isDimsPrefix(["google", "desktop"], ["google", "mobile"])).toBe(false);
    expect(isDimsPrefix([], ["google"])).toBe(true); // tom dims-lista är matematiskt prefix — nyckelvägen vaktar via isSegmentPrefix
  });
});

describe("parentSegmentKey — en dimension grövre", () => {
  it("kliver upp ett steg och stannar på null vid roten", () => {
    expect(parentSegmentKey("google·mobile·se·ny")).toBe("google·mobile·se");
    expect(parentSegmentKey("google·mobile")).toBe("google");
    expect(parentSegmentKey("google")).toBe(null);
  });
});

describe("segmentKeysRelated — dashboardens scoping-relation", () => {
  it("samma nyckel, finare under, och grövre över hör ihop", () => {
    expect(segmentKeysRelated("google", "google")).toBe(true);
    expect(segmentKeysRelated("google", "google·mobile")).toBe(true);
    expect(segmentKeysRelated("google·mobile·se", "google")).toBe(true);
  });

  it("syskon och främlingar hör inte ihop", () => {
    expect(segmentKeysRelated("google·mobile", "google·desktop")).toBe(false);
    expect(segmentKeysRelated("google", "direct")).toBe(false);
  });
});
