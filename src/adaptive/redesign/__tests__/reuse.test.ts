// Blockbiblioteket steg 2 — frö-vakternas kontrakt. Varje vakt har ett eget
// test för att mutationer ska fällas: skörden (vem är ett bevisat block),
// mättnadstaket, dubbelvisningsvakten, och överlevnads-ärligheten som avgör
// om evidence.reuse får skrivas.
import { describe, expect, it } from "vitest";

import {
  MAX_REUSE_OFFERS_PER_CELL,
  REUSE_MAX_SPREAD,
  blockTransferRecords,
  decorateSeedsWithTransfer,
  filterViableSeeds,
  flattenHtml,
  harvestReuseSeeds,
  offerSeedsForCell,
  partitionFalsified,
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

  it("flytt-vinnare skördas ALDRIG som textblock — de har en egen transferform", () => {
    // Formerna hålls isär (transferformen steg 4): textskörden bevisar den
    // ordagranna raden, harvestMoveSeeds typklassen. En flytt-vinnare utan
    // insert-op bär ingen text att citera.
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

describe("transfer-lärandet (steg 3) — meriter, rank, falsifiering", () => {
  const reuseWinner = (id: string, path: string): ReuseVariantRow => ({
    id,
    path,
    status: "winner",
    ops: [
      {
        op: "insert_snippet",
        targetId: "hero",
        detail: "Från 299 kr per månad, avsluta när du vill",
        sourcePath: "/priser",
        why: "reuse won",
      },
    ],
    evidence: { reuse: { variantId: "orig", provedOnPath: "/priser" } },
  });
  const retiredReuse = (id: string, path: string, text?: string): ReuseVariantRow => ({
    id,
    path,
    status: "retired",
    ops: [
      {
        op: "insert_snippet",
        targetId: "hero",
        detail: text ?? "Från 299 kr per månad, avsluta när du vill",
        sourcePath: "/priser",
        why: "reuse lost",
      },
    ],
    evidence: { reuse: { variantId: "orig", provedOnPath: "/priser" } },
  });

  it("meriterna: vinster per distinkt sida, misslyckanden bara ur pensionerade ÅTERBRUKS-rader", () => {
    const rows = [
      winner(), // originalvinsten på /priser
      reuseWinner("rw-1", "/enterprise"), // transfern vann på /enterprise
      retiredReuse("rr-1", "/om-oss"), // transfern föll på /om-oss
      // Pensionerad rad UTAN evidence.reuse (pensionerat original) är INTE
      // ett transfer-misslyckande.
      { ...winner({ id: "orig-retired", path: "/gammal", status: "retired" }), evidence: {} },
    ];
    const records = blockTransferRecords(rows);
    const r = records.get("från 299 kr per månad, avsluta när du vill")!;
    expect(r.wonOnPaths).toEqual(["/priser", "/enterprise"]);
    expect(r.failedOnPaths).toEqual(["/om-oss"]);
  });

  it("VUNNEN-och-tillbakadragen (wasWinner) är INTE ett misslyckande — neutral", () => {
    // Granskningsfynd 2026-08-11: winner→retired är en legal ägartransition;
    // utan markören hade två avvecklingar av ett block som vann varje test
    // falsifierat det. setVariantStatus skriver wasWinner vid övergången.
    const withdrawn = retiredReuse("rr-w", "/enterprise");
    (withdrawn.evidence as Record<string, unknown>).wasWinner = true;
    const records = blockTransferRecords([winner(), withdrawn]);
    const r = records.get("från 299 kr per månad, avsluta när du vill")!;
    expect(r.failedOnPaths).toEqual([]);
    expect(r.wonOnPaths).toEqual(["/priser"]);
  });

  it("hållna/drift-uppdaterade vinnare räknas inte som vinster (samma dom som skörden)", () => {
    const records = blockTransferRecords([
      winner({ held_reason: "guardrail: harm" }),
      winner({ id: "w2", path: "/b", evidence: { refreshedAt: "2026-08-11T00:00:00Z" } }),
    ]);
    expect(records.get("från 299 kr per månad, avsluta när du vill")).toBeUndefined();
  });

  it("dekoration + rank: fler-sidors-vinnare först, meritlistan sorterad utan egna sidan", () => {
    const multiWin = harvestReuseSeeds([winner()])[0]; // /priser
    const singleWin = harvestReuseSeeds([
      winner({
        id: "44444444-dddd-eeee-ffff-000000000004",
        path: "/annan",
        ops: [
          {
            op: "insert_snippet",
            targetId: "hero",
            detail: "En annan bevisad rad med bara en vinst",
            sourcePath: "/annan",
            why: "w",
          },
        ],
      }),
    ])[0];
    const records = blockTransferRecords([winner(), reuseWinner("rw-1", "/enterprise")]);
    // singleWin FÖRST i skördeordningen — ranken ska vända på det.
    const ranked = decorateSeedsWithTransfer([singleWin, multiWin], records);
    expect(ranked[0].text).toBe("Från 299 kr per månad, avsluta när du vill");
    expect(ranked[0].alsoWonOn).toEqual(["/enterprise"]);
    expect(ranked[1].alsoWonOn).toBeUndefined();
    // Stabilt: lika meriter behåller ordningen.
    const tie = decorateSeedsWithTransfer([singleWin, multiWin], new Map());
    expect(tie.map((s) => s.text)).toEqual([singleWin.text, multiWin.text]);
  });

  it("falsifiering: fallit på 2 distinkta sidor ⇒ ut ur biblioteket; 1 ⇒ kvar", () => {
    const seed = harvestReuseSeeds([winner()])[0];
    const one = blockTransferRecords([winner(), retiredReuse("rr-1", "/om-oss")]);
    expect(partitionFalsified([seed], one)).toEqual({ kept: [seed], falsified: [] });
    const two = blockTransferRecords([
      winner(),
      retiredReuse("rr-1", "/om-oss"),
      retiredReuse("rr-2", "/kontakt"),
    ]);
    expect(partitionFalsified([seed], two)).toEqual({ kept: [], falsified: [seed] });
    // Två pensioneringar på SAMMA sida är EN fallen sida — inte falsifierat.
    const samePage = blockTransferRecords([
      winner(),
      retiredReuse("rr-1", "/om-oss"),
      retiredReuse("rr-2", "/om-oss"),
    ]);
    expect(partitionFalsified([seed], samePage).kept).toEqual([seed]);
  });

  it("vakt 3: en sida där blocket pensionerats får ALDRIG samma erbjudande igen", () => {
    const seed = harvestReuseSeeds([winner()])[0];
    const records = blockTransferRecords([winner(), retiredReuse("rr-1", "/om-oss")]);
    const args = {
      seeds: [seed],
      rows: [winner()],
      landingFlatHtml: flattenHtml("<p>Om oss.</p>"),
      records,
    };
    // Prövad-och-pensionerad sida: inget om-erbjudande...
    expect(offerSeedsForCell({ ...args, cellPath: "/om-oss" })).toEqual([]);
    // ...men en oprövad sida får det fortfarande.
    expect(offerSeedsForCell({ ...args, cellPath: "/kontakt" })).toEqual([seed]);
    // Utan meriter (äldre anropare) vilar vakten — bakåtkompatibelt.
    expect(offerSeedsForCell({ ...args, records: undefined, cellPath: "/om-oss" })).toEqual([seed]);
  });
});
