import { describe, it, expect } from "vitest";

import type { SegmentLeaf } from "@/lib/dashboard/aggregate";
import {
  findEarnedCells,
  findEarnedCellsWithTemplates,
  findEarnedSegments,
  type PageSegmentLeaf,
} from "../earned";

const leaf = (
  channel: string,
  device: string,
  country: string,
  returning: boolean,
  visits: number,
  conversions: number,
): SegmentLeaf => ({
  channel,
  device,
  country,
  returning,
  visits,
  conversions,
  formStarts: 0,
  formAbandons: 0,
});

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
    // a dominerar (>= 2/3 av trafiken) så sajtvitt-jokern inte är motiverad —
    // testet mäter GREEDY-mekaniken, inte inträdesregeln (egen svit nedan).
    const leaves = [
      leaf("a", "mobile", "SE", false, 9000, 700),
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
    // Två LIKA nycklar är per definition 50/50 — precis fallet där jokern ska
    // vinna. En dominant tredje kanal (>= 2/3 av totalen) håller jokern ute,
    // och tiebreaket mäts i rundorna EFTER den: x före y på nyckelordning.
    const leaves = [
      leaf("dominant", "mobile", "SE", false, 8000, 600),
      leaf("x", "mobile", "SE", false, 1200, 100),
      leaf("y", "mobile", "SE", false, 1200, 100),
    ];
    const got = findEarnedSegments(leaves, []);
    expect(got.map((s) => s.key)).toEqual([
      "dominant·mobile·SE·ny",
      "x·mobile·SE·ny",
      "y·mobile·SE·ny",
    ]);
  });
});

// ── per sida ─────────────────────────────────────────────────────────────────

const pleaf = (path: string, l: SegmentLeaf): PageSegmentLeaf => ({ ...l, path });

describe("findEarnedCells — sida × segment", () => {
  it("samma segment kan förtjäna designs på OLIKA sidor oberoende av varandra", () => {
    const leaves = [
      pleaf("/", leaf("google", "desktop", "US", false, 3000, 200)),
      pleaf("/pricing", leaf("google", "desktop", "US", false, 1500, 130)),
    ];
    const got = findEarnedCells(leaves, []);
    expect(got.map((c) => `${c.path} ${c.key}`)).toEqual([
      "/ google·desktop·US·ny",
      "/pricing google·desktop·US·ny",
    ]);
  });

  it("en variant täcker bara SIN sida — samma nyckel på annan sida föreslås ändå", () => {
    const leaves = [
      pleaf("/", leaf("google", "desktop", "US", false, 3000, 200)),
      pleaf("/pricing", leaf("google", "desktop", "US", false, 1500, 130)),
    ];
    const got = findEarnedCells(leaves, [{ path: "/", segmentKey: "google·desktop·US·ny" }]);
    expect(got.map((c) => `${c.path} ${c.key}`)).toEqual(["/pricing google·desktop·US·ny"]);
  });

  it("rankar över sidorna: en sidas näst bästa tränger inte ut en annans bästa", () => {
    // a dominerar sin sida (>= 2/3) så jokern inte kliver in — rankningen
    // ÖVER sidor är det som mäts här.
    const leaves = [
      pleaf("/", leaf("a", "mobile", "SE", false, 8000, 600)),
      pleaf("/", leaf("b", "mobile", "SE", false, 1800, 150)),
      pleaf("/pricing", leaf("c", "desktop", "US", false, 1900, 160)),
    ];
    const got = findEarnedCells(leaves, [], 2);
    expect(got.map((c) => `${c.path} ${c.key}`)).toEqual([
      "/ a·mobile·SE·ny",
      "/pricing c·desktop·US·ny",
    ]);
  });

  it("tomma/saknade paths hamnar på startsidan", () => {
    const got = findEarnedCells([pleaf("", leaf("google", "mobile", "SE", false, 1500, 120))], []);
    expect(got[0]?.path).toBe("/");
  });

  it("volymgrinden gäller PER sida — sajtbred volym räcker inte", () => {
    const leaves = [
      pleaf("/", leaf("google", "desktop", "US", false, 700, 60)),
      pleaf("/pricing", leaf("google", "desktop", "US", false, 600, 55)),
    ];
    expect(findEarnedCells(leaves, [])).toEqual([]);
  });
});

// ── Sajtvitt-jokern (ANY-token, ägarbeslut 2026-08-16) ───────────────────────
describe("sajtvitt-jokern: inträdesregeln är mätkraft", () => {
  it("splittrad trafik (bästa kanal < 2/3) ⇒ EN sajtvitt cell i stället för kanalceller", () => {
    // Glutenforums startsidas verkliga form (2026-08-16): direct 106, google
    // 56, instagram 25, other 16 — bästa kanal 52 % av 203. Ett kanaltest
    // hade sett halva trafiken; sajtvitt ser allt.
    const gf = [
      leaf("direct", "mobile", "SE", false, 106, 0),
      leaf("google", "mobile", "SE", false, 56, 0),
      leaf("instagram", "mobile", "SE", false, 25, 0),
      leaf("other", "mobile", "SE", false, 16, 0),
    ];
    const got = findEarnedSegments(gf, [], 5, "bounce");
    expect(got.map((s) => s.key)).toEqual(["alla"]);
    expect(got[0].total.visits).toBe(203);
    // Jokern täcker allt ⇒ inga fler celler föreslås för sidan.
    expect(got).toHaveLength(1);
  });

  it("dominant kanal (>= 2/3) ⇒ kanalcellen behålls, exakt dagens val", () => {
    // Bloggsidans form: google 119 av 161 = 74 % — kanaltestet ser nästan
    // allt, jokern köper < 1,5× och släpps inte in.
    const blogg = [
      leaf("google", "mobile", "SE", false, 119, 0),
      leaf("direct", "mobile", "SE", false, 42, 0),
    ];
    const got = findEarnedSegments(blogg, [], 5, "bounce");
    expect(got.map((s) => s.key)).not.toContain("alla");
    expect(got[0].key.startsWith("google")).toBe(true);
  });

  it("ingen kanal når grinden men totalen gör det ⇒ jokern är enda vägen till ett test", () => {
    const thin = [
      leaf("google", "mobile", "SE", false, 40, 0),
      leaf("direct", "mobile", "SE", false, 35, 0),
      leaf("facebook", "mobile", "SE", false, 30, 0),
    ];
    expect(findEarnedSegments(thin, [], 5, "bounce").map((s) => s.key)).toEqual(["alla"]);
    // ...och i konverteringsläget gäller BÅDA grindarna även för jokern.
    expect(findEarnedSegments(thin, [], 5, "conversion")).toEqual([]);
  });

  it("jokern räknar på INKREMENTELL trafik: en befintlig google-variant ändrar domen", () => {
    // Utan täckning: google 60 % av 500 ⇒ under 2/3 ⇒ joker. Med google
    // täckt tävlar jokern bara om resten (200, där bästa konkreta är
    // direct 120 = 60 % < 2/3) — joker på RESTEN, ärligt inkrement.
    const leaves = [
      leaf("google", "mobile", "SE", false, 300, 0),
      leaf("direct", "mobile", "SE", false, 120, 0),
      leaf("facebook", "mobile", "SE", false, 80, 0),
    ];
    const utan = findEarnedSegments(leaves, [], 5, "bounce");
    expect(utan.map((s) => s.key)).toEqual(["alla"]);
    const med = findEarnedSegments(leaves, ["google"], 5, "bounce");
    expect(med.map((s) => s.key)).toEqual(["alla"]);
    expect(med[0].incremental.visits).toBe(200); // google-trafiken är inte jokerns
  });

  it("'okänd'-kanalens trafik — som inget konkret prefix kan täcka — räknas av jokern", () => {
    const leaves = [
      leaf("google", "mobile", "SE", false, 80, 0),
      leaf("", "mobile", "SE", false, 60, 0), // kanal saknas → okänd
    ];
    const got = findEarnedSegments(leaves, [], 5, "bounce");
    expect(got.map((s) => s.key)).toEqual(["alla"]);
    expect(got[0].incremental.visits).toBe(140);
  });

  it("ett SMITT 'alla'-löv blir aldrig en kandidat — jokern är reserverad", () => {
    // Kanalen är rå klient-payload: 100 fejkade besök med
    // trafficSource='alla' hade annars blivit en "konkret" kandidat med
    // joker-matchning — förbi hela 2/3-inträdesregeln. Hoppas som 'okänd'.
    const forged = [
      leaf("alla", "mobile", "SE", false, 150, 0),
      leaf("google", "mobile", "SE", false, 400, 0),
    ];
    const got = findEarnedSegments(forged, [], 5, "bounce");
    // Det smidda lövet blir varken kandidat (hoppas som 'okänd') eller
    // motiverar jokern (google 400 = 73 % ≥ 2/3 av 550) — google vinner
    // konkret, på sitt fulla djup (greedyn föredrar djupast vid lika
    // inkrement), och ingen nyckel bär jokertecknet.
    expect(got.map((s) => s.key)).toEqual(["google·mobile·SE·ny"]);
    expect(got.some((s) => s.key.includes("alla"))).toBe(false);
  });

  it("grinden binder på INKREMENTET: 90 % redan täckt ⇒ ingen joker på resten under golvet", () => {
    // Sidan totalt 1000 besök men google-varianten täcker 950 — jokern hade
    // ägt 50 besök, långt under grinden (100). Med totalen som grind hade ett
    // aldrig-avgörbart "sajtvitt" test dessutom SPÄRRAT all vidare detektering
    // (täckningen matchar varje löv).
    const leaves = [
      leaf("google", "mobile", "SE", false, 950, 0),
      leaf("direct", "mobile", "SE", false, 30, 0),
      leaf("facebook", "mobile", "SE", false, 20, 0),
    ];
    expect(findEarnedSegments(leaves, ["google"], 5, "bounce")).toEqual([]);
    // ...men när resten SJÄLV bär grinden får jokern ta den (inkrementet
    // 120 ≥ 100, bästa konkreta 70 = 58 % < 2/3).
    const rest = [
      leaf("google", "mobile", "SE", false, 950, 0),
      leaf("direct", "mobile", "SE", false, 70, 0),
      leaf("facebook", "mobile", "SE", false, 50, 0),
    ];
    const got = findEarnedSegments(rest, ["google"], 5, "bounce");
    expect(got.map((s) => s.key)).toEqual(["alla"]);
    expect(got[0].total.visits).toBe(120); // jokerns total ÄR dess inkrement
  });

  it("en befintlig 'alla'-variant täcker ALLT — inga celler alls föreslås", () => {
    // Medvetet, inte en bieffekt: ett pågående sajtvitt test äger hela
    // trafiken. Att rista ur en kanalcell mitt i hade förorenat armarna —
    // finare celler får vänta tills sajtvitt-testet är avgjort och pensionerat.
    const gf = [
      leaf("direct", "mobile", "SE", false, 106, 0),
      leaf("google", "mobile", "SE", false, 56, 0),
    ];
    expect(findEarnedSegments(gf, ["alla"], 5, "bounce")).toEqual([]);
  });
});

describe("continuation-läget (test_metric, ägarbeslut 2026-07-20)", () => {
  // Pilotens form: en stark cell långt under konverteringsgrinden.
  const PILOT: PageSegmentLeaf[] = [
    { ...leaf("google", "mobile", "SE", false, 118, 0), path: "/" },
    { ...leaf("google", "desktop", "SE", false, 13, 0), path: "/" },
    { ...leaf("instagram", "mobile", "SE", false, 9, 0), path: "/" },
  ];

  it("konverteringsläget säger ärligt nej på pilotvolym", () => {
    expect(findEarnedCells(PILOT, [], 5, "conversion")).toEqual([]);
  });

  it("continuation-läget kvalar cellen på besöksvolym utan konverteringskrav", () => {
    const got = findEarnedCells(PILOT, [], 5, "continuation");
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].path).toBe("/");
    // Grövsta adekvata nyckeln som täcker de otäckta löven vinner (som vanligt).
    expect(got[0].key).toBe("google");
    expect(got[0].total.visits).toBeGreaterThanOrEqual(100);
  });

  it("engagemangströskeln gäller fortfarande — 99 besök kvalar inte", () => {
    const thin: PageSegmentLeaf[] = [
      { ...leaf("google", "mobile", "SE", false, 99, 0), path: "/" },
    ];
    expect(findEarnedCells(thin, [], 5, "continuation")).toEqual([]);
  });

  it("befintlig variant blockerar som vanligt även i continuation-läget", () => {
    const got = findEarnedCells(PILOT, [{ path: "/", segmentKey: "google" }], 5, "continuation");
    expect(got.map((c) => c.key)).not.toContain("google");
  });

  // Bounce-läget (ägarbeslut 2026-08-15) delar continuations grindkrav: varje
  // besökare får ett bounce-utfall, så ett konverteringskrav vore samma
  // kategorifel. Granskningsfynd 2026-08-16: utan den här grenen mappade
  // nattloopen bounce → conversion och pilotens celler dömdes på 0
  // konverteringar — detektorn gick tyst tom varje natt.
  it("bounce-läget kvalar cellen exakt som continuation — och conversion säger nej", () => {
    const got = findEarnedCells(PILOT, [], 5, "bounce");
    expect(got.length).toBeGreaterThan(0);
    expect(got[0].key).toBe("google");
    // Identisk dom som continuation — samma grind, ingen egen tröskel.
    expect(got).toEqual(findEarnedCells(PILOT, [], 5, "continuation"));
    // ...och tröskeln gäller: 99 besök kvalar inte heller i bounce-läget.
    const thin: PageSegmentLeaf[] = [
      { ...leaf("google", "mobile", "SE", false, 99, 0), path: "/" },
    ];
    expect(findEarnedCells(thin, [], 5, "bounce")).toEqual([]);
  });
});

describe("findEarnedCellsWithTemplates — mall-passet (glutenforum-formen)", () => {
  // Verkligheten som motiverade mallarna: google·mobil·SE bär 230 besök på
  // SAJTEN men bästa enskilda sida 34 — per-sida-grinden (100, continuation)
  // nås aldrig, medan bloggmallens sidor tillsammans bär volymen.
  const page = (path: string, l: SegmentLeaf): PageSegmentLeaf => ({ ...l, path });
  const GF: PageSegmentLeaf[] = [
    // kladdkaka speglar riktiga rollupen: 29 nya + 5 återkommande = 34
    page("/blogg/kladdkaka", leaf("google", "mobile", "SE", false, 29, 0)),
    page("/blogg/kladdkaka", leaf("google", "mobile", "SE", true, 5, 0)),
    page("/blogg/korskontaminering", leaf("google", "mobile", "SE", false, 27, 0)),
    page("/blogg/brod", leaf("google", "mobile", "SE", false, 15, 0)),
    page("/blogg/airfryer", leaf("google", "mobile", "SE", false, 30, 0)),
    page("/blogg", leaf("google", "mobile", "SE", false, 4, 0)), // listningen — INTE artikelmallen
    page("/restauranger/tavolo", leaf("google", "mobile", "SE", false, 11, 0)),
    page("/", leaf("direct", "desktop", "SE", true, 9, 0)),
  ];

  it("grupperar icke-förtjänande artikelsidor till en mall-cell med exemplar", () => {
    const got = findEarnedCellsWithTemplates(GF, [], 5, "continuation");
    // Bloggartiklarna: 34+27+15+30 = 106 ≥ 100 → mallen förtjänar; listningen
    // ("/blogg", null-mall) och restaurangen (ensam sida) gör det inte.
    expect(got).toHaveLength(1);
    const cell = got[0];
    expect(cell.path).toBe("/blogg/*");
    expect(cell.key).toBe("google·mobile·SE");
    expect(cell.total.visits).toBe(106);
    // Exemplaren: topp-3 efter besök inom segmentet — frys/verifierings-underlaget.
    expect(cell.templatePages).toEqual([
      { path: "/blogg/kladdkaka", visits: 34 },
      { path: "/blogg/airfryer", visits: 30 },
      { path: "/blogg/korskontaminering", visits: 27 },
    ]);
  });

  it("en sida som bär sin EGEN volym får per-sida-cell — och lämnar mallen", () => {
    const withBig = [...GF, page("/blogg/succen", leaf("google", "mobile", "SE", false, 120, 0))];
    const got = findEarnedCellsWithTemplates(withBig, [], 5, "continuation");
    const paths = got.map((c) => c.path);
    // Succén förtjänar egen design; mallen byggs av de ÖVRIGA artiklarna (106).
    expect(paths).toContain("/blogg/succen");
    expect(paths).toContain("/blogg/*");
    const tpl = got.find((c) => c.path === "/blogg/*")!;
    expect(tpl.total.visits).toBe(106);
    expect(tpl.templatePages!.map((p) => p.path)).not.toContain("/blogg/succen");
  });

  it("en servande mall-variant täcker sina konkreta sidor i per-sida-passet", () => {
    const withBig = [...GF, page("/blogg/succen", leaf("google", "mobile", "SE", false, 120, 0))];
    const got = findEarnedCellsWithTemplates(
      withBig,
      [{ path: "/blogg/*", segmentKey: "google" }],
      5,
      "continuation",
    );
    // "/blogg/*"×google täcker BÅDE mallcellen och succén — inget återförslag.
    expect(got).toEqual([]);
  });

  it("en mall kräver ≥2 bidragande sidor — en ensam artikel är ingen mall", () => {
    const lone = [
      page("/forum/traden", leaf("google", "mobile", "SE", false, 150, 0)),
      page("/blogg/kladdkaka", leaf("google", "mobile", "SE", false, 20, 0)),
    ];
    const got = findEarnedCellsWithTemplates(lone, [], 5, "continuation");
    // /forum/traden bär volymen ENSAM → per-sida-cell, ingen "/forum/*"-mall.
    expect(got.map((c) => c.path)).toEqual(["/forum/traden"]);
    expect(got[0].templatePages).toBeUndefined();
  });

  it("conversion-läget gäller även mallar (1000/100-grinden)", () => {
    const got = findEarnedCellsWithTemplates(GF, [], 5, "conversion");
    expect(got).toEqual([]); // 106 besök / 0 konv — långt under 1000/100
  });
});
