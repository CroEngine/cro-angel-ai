// Blockbiblioteket steg 2 — frö-vakternas kontrakt. Varje vakt har ett eget
// test för att mutationer ska fällas: skörden (vem är ett bevisat block),
// mättnadstaket, dubbelvisningsvakten, och överlevnads-ärligheten som avgör
// om evidence.reuse får skrivas.
import { describe, expect, it } from "vitest";

import {
  MAX_REUSE_OFFERS_PER_CELL,
  REUSE_MAX_SPREAD,
  filterViableSeeds,
  flattenHtml,
  harvestReuseSeeds,
  offerSeedsForCell,
  reuseSurvived,
  seedSaturated,
  textPresent,
  type ReuseVariantRow,
} from "../reuse";

const winner = (over: Partial<ReuseVariantRow> = {}): ReuseVariantRow => ({
  id: "11111111-aaaa-bbbb-cccc-000000000001",
  path: "/priser",
  status: "winner",
  held_reason: null,
  ops: [
    {
      op: "insert_snippet",
      targetId: "hero",
      detail: "Från 299 kr per månad, avsluta när du vill",
      sourcePath: "/priser",
      why: "won",
    },
  ],
  ...over,
});

describe("harvestReuseSeeds — vem är ett bevisat block", () => {
  it("skördar vinnarens insert-text med källsida och proveniens", () => {
    const seeds = harvestReuseSeeds([winner()]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toEqual({
      variantId: "11111111-aaaa-bbbb-cccc-000000000001",
      provedOnPath: "/priser",
      sourcePath: "/priser",
      text: "Från 299 kr per månad, avsluta när du vill",
    });
  });

  it("bara vinnare: verified/serving/retired skördas aldrig", () => {
    for (const status of ["candidate", "verified", "serving", "retired"]) {
      expect(harvestReuseSeeds([winner({ status })])).toEqual([]);
    }
  });

  it("hållna vinnare skördas inte — ett hållet bevis är inget bevis", () => {
    expect(harvestReuseSeeds([winner({ held_reason: "drift: källtexten ändrad" })])).toEqual([]);
  });

  it("vinnare utan insert-op (flytt-vinnare) skördas inte i v1", () => {
    const moveWinner = winner({
      ops: [{ op: "move_up", targetId: "sec-3-testimonials", detail: "", why: "won" }],
    });
    expect(harvestReuseSeeds([moveWinner])).toEqual([]);
  });

  it("utan explicit sourcePath (bevis-lyft från egna sidan) skördas INTE i v1", () => {
    // Granskningsfynd 2026-08-11: bevis-lyft valideras mot sidans KORPUS,
    // inte quotables-whitelisten — ett sådant frö hade näst intill alltid
    // sållats i viabilitetskollen med en vilseledande "drift"-logg.
    const proofInsert = winner({
      ops: [
        { op: "insert_snippet", targetId: "hero", detail: "Trusted by 12,000 teams", why: "w" },
      ],
    });
    expect(harvestReuseSeeds([proofInsert])).toEqual([]);
  });

  it("drift-uppdaterade vinnare skördas INTE — vinsten tillhör den gamla texten", () => {
    // Granskningsfynd 2026-08-11: refresh-svepet byter vinnartexten mot
    // källsidans nya lydelse utan nytt A/B — den nya texten får aldrig ärva
    // [proven:]-etiketten. Äldre rader utan markören skördas som vanligt.
    const refreshed = winner({ evidence: { refreshedAt: "2026-08-11T02:00:00Z" } });
    expect(harvestReuseSeeds([refreshed])).toEqual([]);
    expect(harvestReuseSeeds([winner({ evidence: {} })])).toHaveLength(1);
  });

  it("en vinnare med flera insert-ops ger ETT frö — den FÖRSTA", () => {
    const multi = winner({
      ops: [
        {
          op: "insert_snippet",
          targetId: "hero",
          detail: "Första bevisade raden",
          sourcePath: "/priser",
          why: "w",
        },
        {
          op: "insert_snippet",
          targetId: "hero",
          detail: "Andra raden som inte skördas",
          sourcePath: "/priser",
          why: "w",
        },
      ],
    });
    const seeds = harvestReuseSeeds([multi]);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].text).toBe("Första bevisade raden");
  });

  it("två vinnare med samma normaliserade text är ETT block", () => {
    const other = winner({
      id: "22222222-aaaa-bbbb-cccc-000000000002",
      path: "/enterprise",
      ops: [
        {
          op: "insert_snippet",
          targetId: "hero",
          detail: "Från 299 kr   per månad, avsluta när du vill",
          sourcePath: "/priser",
          why: "w",
        },
      ],
    });
    expect(harvestReuseSeeds([winner(), other])).toHaveLength(1);
  });

  it("trasiga ops-former (icke-array, icke-itererbara objekt, tomma detaljer) släpps tyst", () => {
    expect(harvestReuseSeeds([winner({ ops: "garbage" })])).toEqual([]);
    expect(harvestReuseSeeds([winner({ ops: {} })])).toEqual([]);
    expect(harvestReuseSeeds([winner({ ops: null })])).toEqual([]);
    expect(
      harvestReuseSeeds([
        winner({ ops: [{ op: "insert_snippet", detail: "   ", sourcePath: "/priser" }] }),
      ]),
    ).toEqual([]);
  });
});

describe("filterViableSeeds — viabilitetskollen (samma dom som driftsvepet)", () => {
  const seed = harvestReuseSeeds([winner()])[0];

  it("texten kvar i källsidans whitelist ⇒ erbjudbar — normQuote-likhet, inte byte-likhet", () => {
    const { viable, dropped } = filterViableSeeds([seed], () => [
      "Från  299 kr\nper månad, avsluta när du vill",
    ]);
    expect(viable).toEqual([seed]);
    expect(dropped).toEqual([]);
  });

  it("källsida ofryst ⇒ sållas med orsak", () => {
    const { viable, dropped } = filterViableSeeds([seed], () => null);
    expect(viable).toEqual([]);
    expect(dropped).toEqual([{ seed, reason: "unfrozen" }]);
  });

  it("texten borta ur whitelisten ⇒ sållas med orsak (driftsvepet tar vinnaren)", () => {
    const { viable, dropped } = filterViableSeeds([seed], () => ["Nu 349 kr per månad"]);
    expect(viable).toEqual([]);
    expect(dropped).toEqual([{ seed, reason: "text-gone" }]);
  });
});

describe("seedSaturated — mättnadstaket", () => {
  const seed = harvestReuseSeeds([winner()])[0];
  const spreadRow = (path: string, status = "serving"): ReuseVariantRow => ({
    id: `spread-${path}`,
    path,
    status,
    ops: [
      {
        op: "insert_snippet",
        targetId: "hero",
        detail: "Från 299 kr per månad, avsluta när du vill",
        sourcePath: "/priser",
        why: "reuse",
      },
    ],
  });

  it("under taket: inte mättat", () => {
    expect(seedSaturated(seed, [winner(), spreadRow("/om-oss")])).toBe(false);
  });

  it("på taket (REUSE_MAX_SPREAD distinkta andra sidor): mättat", () => {
    const rows = [winner(), spreadRow("/om-oss"), spreadRow("/kontakt")];
    expect(REUSE_MAX_SPREAD).toBe(2);
    expect(seedSaturated(seed, rows)).toBe(true);
  });

  it("pensionerade rader frigör sin plats; vinnarens egen sida räknas aldrig", () => {
    const rows = [winner(), spreadRow("/om-oss"), spreadRow("/kontakt", "retired")];
    expect(seedSaturated(seed, rows)).toBe(false);
    // Två rader på SAMMA andra sida är en plats, inte två.
    const samePath = [winner(), spreadRow("/om-oss"), { ...spreadRow("/om-oss"), id: "x2" }];
    expect(seedSaturated(seed, samePath)).toBe(false);
  });
});

describe("flattenHtml/textPresent — dubbelvisningsvakten", () => {
  it("hittar texten trots taggar, radbrytningar och skiftläge", () => {
    const flat = flattenHtml(
      "<main><p>FRÅN 299 KR\n  per <b>månad</b>, avsluta när du vill</p></main>",
    );
    expect(textPresent(flat, "Från 299 kr per månad, avsluta när du vill")).toBe(true);
  });

  it("script/style-innehåll räknas aldrig som sidtext", () => {
    const flat = flattenHtml(
      '<script>var x = "Från 299 kr per månad, avsluta när du vill";</script><p>Annat.</p>',
    );
    expect(textPresent(flat, "Från 299 kr per månad, avsluta när du vill")).toBe(false);
  });

  it("tom text är aldrig 'närvarande'", () => {
    expect(textPresent(flattenHtml("<p>x</p>"), "   ")).toBe(false);
  });

  it("entitetskodade sidor avkodas med extraktionens delade regler — numeriska åäö smiter inte förbi", () => {
    // Granskningsfynd 2026-08-11: fröets text är avkodad (DOM/extraktion),
    // sidan jämfördes rå — en entitetskodad sida som redan visar texten
    // släppte igenom erbjudandet. Avkodningen är nu DELAD med extraktionen
    // (stripTags): numeriska entiteter (&#229;/&#xE5; — så riktiga sajter
    // kodar åäö) och den vanliga namngivna mängden avkodas. Ovanliga
    // namngivna (&aring;) blir mellanslag på BÅDA sidor av pipelinen —
    // känd, självkonsistent gräns, inte en vaktlucka i ena riktningen.
    const numeric = flattenHtml("<p>Fr&#229;n 299 kr per m&#xE5;nad, avsluta n&#228;r du vill</p>");
    expect(textPresent(numeric, "Från 299 kr per månad, avsluta när du vill")).toBe(true);
    const quoted = flattenHtml("<p>&quot;Bäst i test&quot; &amp; prisbelönt sedan 2019</p>");
    expect(textPresent(quoted, '"Bäst i test" & prisbelönt sedan 2019')).toBe(true);
  });
});

describe("offerSeedsForCell — vakterna i ordning", () => {
  const seed = harvestReuseSeeds([winner()])[0];
  const base = { seeds: [seed], rows: [winner()], landingFlatHtml: flattenHtml("<p>Om oss.</p>") };

  it("erbjuds på en främmande sida utan texten", () => {
    expect(offerSeedsForCell({ ...base, cellPath: "/om-oss" })).toEqual([seed]);
  });

  it("aldrig sidan blocket vann på, aldrig källsidan själv", () => {
    expect(offerSeedsForCell({ ...base, cellPath: "/priser" })).toEqual([]);
  });

  // Vakterna ISOLERADE (granskningsfynd 2026-08-11: med provedOnPath ===
  // sourcePath i basfixturen kunde EN raderad vakt gömma sig bakom den
  // andra): ett korssid-frö där vinnarsida ≠ källsida skiljer dem åt.
  const crossSeed = harvestReuseSeeds([
    winner({
      id: "33333333-aaaa-bbbb-cccc-000000000003",
      path: "/enterprise",
      ops: [
        {
          op: "insert_snippet",
          targetId: "hero",
          detail: "Från 299 kr per månad, avsluta när du vill",
          sourcePath: "/priser",
          why: "w",
        },
      ],
    }),
  ])[0];

  it("vakt 1 isolerad: aldrig sidan blocket VANN på (provedOnPath)", () => {
    expect(
      offerSeedsForCell({
        seeds: [crossSeed],
        rows: [],
        cellPath: "/enterprise",
        landingFlatHtml: flattenHtml("<p>Enterprise.</p>"),
      }),
    ).toEqual([]);
  });

  it("vakt 2 isolerad: aldrig KÄLLSIDAN själv (sourcePath)", () => {
    expect(
      offerSeedsForCell({
        seeds: [crossSeed],
        rows: [],
        cellPath: "/priser",
        landingFlatHtml: flattenHtml("<p>Priser utan citatet.</p>"),
      }),
    ).toEqual([]);
    // ...och en tredje sida är fortfarande erbjudbar.
    expect(
      offerSeedsForCell({
        seeds: [crossSeed],
        rows: [],
        cellPath: "/om-oss",
        landingFlatHtml: flattenHtml("<p>Om oss.</p>"),
      }),
    ).toEqual([crossSeed]);
  });

  it("aldrig en sida som redan visar texten (dubbelvisningsvakten)", () => {
    const landing = flattenHtml("<p>Från 299 kr per månad, avsluta när du vill</p>");
    expect(offerSeedsForCell({ ...base, cellPath: "/om-oss", landingFlatHtml: landing })).toEqual(
      [],
    );
  });

  it("aldrig en sida som redan har en icke-pensionerad variant med texten", () => {
    const rows = [
      winner(),
      {
        id: "v-here",
        path: "/om-oss",
        status: "verified",
        ops: [
          {
            op: "insert_snippet",
            targetId: "hero",
            detail: "Från 299 kr per månad, avsluta när du vill",
            why: "r",
          },
        ],
      },
    ];
    expect(offerSeedsForCell({ ...base, rows, cellPath: "/om-oss" })).toEqual([]);
    // Pensionerad ⇒ erbjudandet öppnar igen.
    expect(
      offerSeedsForCell({
        ...base,
        rows: [winner(), { ...rows[1], status: "retired" }],
        cellPath: "/om-oss",
      }),
    ).toEqual([seed]);
  });

  it("mättade frön erbjuds inte", () => {
    const rows = [
      winner(),
      { ...winner({ id: "s1", path: "/a", status: "serving" }) },
      { ...winner({ id: "s2", path: "/b", status: "serving" }) },
    ];
    expect(offerSeedsForCell({ ...base, rows, cellPath: "/om-oss" })).toEqual([]);
  });

  it("cappar erbjudandena per cell — menyn ska bära beslut, inte brus", () => {
    const seeds = Array.from(
      { length: 4 },
      (_, i) =>
        harvestReuseSeeds([
          winner({
            id: `w-${i}-aaaaaaaa`,
            path: `/vinnare-${i}`,
            ops: [
              {
                op: "insert_snippet",
                targetId: "hero",
                detail: `Bevisad rad nummer ${i} med tillräcklig längd`,
                sourcePath: `/vinnare-${i}`,
                why: "w",
              },
            ],
          }),
        ])[0],
    );
    const offered = offerSeedsForCell({
      seeds,
      rows: [],
      cellPath: "/om-oss",
      landingFlatHtml: flattenHtml("<p>Om oss.</p>"),
    });
    expect(offered).toHaveLength(MAX_REUSE_OFFERS_PER_CELL);
    expect(offered.map((s) => s.provedOnPath)).toEqual(["/vinnare-0", "/vinnare-1"]);
  });
});

describe("reuseSurvived — proveniens bara när blocket faktiskt överlevde", () => {
  const reuse = { sourcePath: "/priser", text: "Från 299 kr per månad, avsluta när du vill" };

  it("exakt text + källsida i finalOps ⇒ överlevde (whitespace-normaliserat)", () => {
    const finalOps = [
      {
        op: "insert_snippet",
        detail: "Från 299 kr  per månad,\navsluta när du vill",
        sourcePath: "/priser",
      },
    ];
    expect(reuseSurvived(finalOps, reuse)).toBe(true);
  });

  it("utbytt av fallback (annan text eller annan källa) ⇒ ingen proveniens", () => {
    expect(
      reuseSurvived(
        [{ op: "insert_snippet", detail: "Trusted by 12,000 teams", sourcePath: undefined }],
        reuse,
      ),
    ).toBe(false);
    expect(
      reuseSurvived(
        [
          {
            op: "insert_snippet",
            detail: "Från 299 kr per månad, avsluta när du vill",
            sourcePath: "/enterprise",
          },
        ],
        reuse,
      ),
    ).toBe(false);
    expect(reuseSurvived([{ op: "move_up", detail: "" }], reuse)).toBe(false);
    // Op-typen räknas: samma text+källa i en ANNAN op-typ är inte blocket.
    expect(
      reuseSurvived(
        [
          {
            op: "set_text",
            detail: "Från 299 kr per månad, avsluta när du vill",
            sourcePath: "/priser",
          },
        ],
        reuse,
      ),
    ).toBe(false);
  });
});
