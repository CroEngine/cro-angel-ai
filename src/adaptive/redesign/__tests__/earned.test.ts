import { describe, it, expect } from "vitest";

import type { SegmentLeaf } from "@/lib/dashboard/aggregate";
import { findEarnedSegments } from "../earned";

const leaf = (
  channel: string,
  device: string,
  country: string,
  returning: boolean,
  visits: number,
  conversions: number,
): SegmentLeaf => ({ channel, device, country, returning, visits, conversions, formStarts: 0, formAbandons: 0 });

// Labbets form: fyra täckta kohorter + två tunna otäckta.
const LAB: SegmentLeaf[] = [
  leaf("instagram", "mobile", "SE", false, 1700, 121),
  leaf("google", "desktop", "US", false, 3200, 227),
  leaf("google", "mobile", "SE", false, 900, 36), // tunn — kan aldrig bära egen
  leaf("facebook", "mobile", "US", false, 5000, 108),
  leaf("direct", "desktop", "SE", true, 1200, 121),
  leaf("direct", "desktop", "SE", false, 400, 21), // ny-besökarna, otäckta
];

const EXISTING = [
  "instagram·mobile·SE",
  "google·desktop·US",
  "facebook·mobile·US",
  "direct·desktop·SE·återkommande",
];

describe("findEarnedSegments — stegen bygger sig själv", () => {
  it("föreslår den grövsta ADEKVATA nyckeln som täcker otäckta tunna löv", () => {
    const got = findEarnedSegments(LAB, EXISTING);
    // google·mobile·SE (900/36) är för tunt för egen design men täcks av "google"
    // (total 4100/263, adekvat). direct·desktop·SE (total 1600/142, adekvat)
    // täcker ny-besökarna (400/21) — finaste nyckeln med den täckningen.
    expect(got.map((s) => s.key)).toEqual(["google", "direct·desktop·SE"]);
    expect(got[0].incremental).toEqual({ visits: 900, conversions: 36 });
    expect(got[0].uncoveredLeaves).toEqual(["google·mobile·SE·ny"]);
    expect(got[1].incremental).toEqual({ visits: 400, conversions: 21 });
  });

  it("föreslår ALDRIG nycklar vars besökare redan täcks (0 inkrement)", () => {
    const keys = findEarnedSegments(LAB, EXISTING).map((s) => s.key);
    // instagram/instagram·mobile: enda lövet täcks redan av den finare varianten.
    for (const k of ["instagram", "instagram·mobile", "facebook", "google·desktop"]) {
      expect(keys).not.toContain(k);
    }
  });

  it("FÖRFINAR inte redan täckta segment (·ny-splittar av befintliga varianter)", () => {
    const keys = findEarnedSegments(LAB, EXISTING).map((s) => s.key);
    // Att splittra ett serverat google·desktop·US i ·ny är vinnar-iterationens
    // jobb — inte detektorns. Annars föreslås en nästan-kopia per variant.
    for (const k of ["google·desktop·US·ny", "instagram·mobile·SE·ny", "facebook·mobile·US·ny"]) {
      expect(keys).not.toContain(k);
    }
  });

  it("dedupar prefix-kedjor girigt — en täckning, ett förslag (finast vinner)", () => {
    const got = findEarnedSegments(LAB, EXISTING).map((s) => s.key);
    // direct, direct·desktop och direct·desktop·SE täcker samma otäckta löv;
    // bara den finaste adekvata föreslås.
    expect(got).toContain("direct·desktop·SE");
    expect(got).not.toContain("direct");
    expect(got).not.toContain("direct·desktop");
  });

  it("kräver att TOTALEN bär analysen (volymgrinden)", () => {
    // Otäckt men tunt i alla rungar: inget förslag alls.
    const thin = [leaf("linkedin", "desktop", "SE", false, 800, 90)];
    expect(findEarnedSegments(thin, [])).toEqual([]);
  });

  it("går aldrig genom 'okänd' — hellre en grövre ärlig nyckel", () => {
    const got = findEarnedSegments(
      [leaf("google", "", "SE", false, 2000, 150)], // enhet saknas → okänd
      [],
    );
    expect(got.map((s) => s.key)).toEqual(["google"]);
  });

  it("respekterar cap och räknar om inkrementen efter varje val", () => {
    const leaves = [
      leaf("a", "mobile", "SE", false, 1500, 120),
      leaf("b", "mobile", "SE", false, 1400, 110),
      leaf("c", "mobile", "SE", false, 1300, 105),
    ];
    const got = findEarnedSegments(leaves, [], 2);
    expect(got).toHaveLength(2);
    // störst inkrementella konverteringar först
    expect(got.map((s) => s.key)).toEqual(["a·mobile·SE·ny", "b·mobile·SE·ny"]);
  });

  it("en pensionerad variants nyckel räknas inte som befintlig (anropskontrakt: exkluderas av anroparen)", () => {
    // Anroparen skickar bara icke-pensionerade nycklar; utan dem föreslås nyckeln igen.
    const got = findEarnedSegments([leaf("instagram", "mobile", "SE", false, 1700, 121)], []);
    expect(got.map((s) => s.key)).toEqual(["instagram·mobile·SE·ny"]);
  });

  it("deterministisk ordning vid lika värde (nyckel-tiebreak)", () => {
    const leaves = [
      leaf("x", "mobile", "SE", false, 1200, 100),
      leaf("y", "mobile", "SE", false, 1200, 100),
    ];
    const got = findEarnedSegments(leaves, []);
    expect(got.map((s) => s.key)).toEqual(["x·mobile·SE·ny", "y·mobile·SE·ny"]);
  });
});
