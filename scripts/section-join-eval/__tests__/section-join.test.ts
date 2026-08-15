// Steg 5-grinden: sektions-joinen (runtime-census ↔ extract.ts-id:n) får inte
// regressa. Golven sätts strax UNDER uppmätt nivå på den committade korpusen —
// grinden fångar tapp, inte brus. Chromium-delen hoppar ärligt när ingen
// chromium kan startas (samma mönster som heading-rotator.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evalSectionJoin, joinSection, scoreSiteJoin, type JoinEvalResult } from "../run";

describe("joinSection — applierns tvåpass-regel som ren funktion", () => {
  const a = (heading: string) => ({ id: "sec-1-x", type: "x", heading });

  it("exakt normaliserad träff är UNIK via exact", () => {
    const j = joinSection(a("Simple Pricing"), ["  simple   PRICING  ", "Other"], false);
    expect(j.verdict).toBe("UNIK");
    expect(j.via).toBe("exact");
  });

  it("rotator-garble räddas av 24-teckens prefixet (applier pass 2)", () => {
    // extract ser alla rotator-frames; censusen ser den frysta framen. Prefixet
    // (24 tecken) ligger före skarven — precis det driftfall passet finns för.
    const garbled = "Where go-to-market teams go to grow scale close retain grow";
    const j = joinSection(a(garbled), ["Where go-to-market teams go to grow"], false);
    expect(j.verdict).toBe("UNIK");
    expect(j.via).toBe("prefix");
  });

  it("två identiska census-rubriker ⇒ FLERTYDIG (kreditering vore gissning)", () => {
    const j = joinSection(a("Our plans"), ["Our plans", "our  plans"], false);
    expect(j.verdict).toBe("FLERTYDIG");
  });

  it("ingen träff ⇒ OUPPLÖST; tom rubrik ⇒ OUPPLÖST", () => {
    expect(joinSection(a("Completely absent heading"), ["Other stuff"], false).verdict).toBe(
      "OUPPLÖST",
    );
    expect(joinSection(a(""), ["Anything"], false).verdict).toBe("OUPPLÖST");
  });

  it("scoreSiteJoin räknar täckning, kandidat-täckning och krediterbarhet", () => {
    const r = scoreSiteJoin(
      "syntetisk",
      [
        { id: "sec-1-hero", type: "hero", heading: "Build faster" },
        { id: "sec-2-pricing", type: "pricing", heading: "Simple pricing" },
        { id: "sec-3-section", type: "section", heading: "Unfindable" },
      ],
      new Set(["sec-2-pricing"]),
      [
        { type: "hero", heading: "Build faster" },
        { type: "pricing", heading: "Simple pricing" },
        { type: "content", heading: "Orphan census section" },
        { type: "footer", heading: "Footer heading" }, // icke-innehåll — utanför nämnaren
      ],
    );
    expect(r.unik).toBe(2);
    expect(r.oupplöst).toBe(1);
    expect(r.coverage).toBeCloseTo(2 / 3, 10);
    expect(r.candCoverage).toBe(1); // pris-kandidaten joinar
    expect(r.bContentWithHeading).toBe(3); // footern räknas inte
    expect(r.creditRate).toBeCloseTo(2 / 3, 10);
  });

  it("krediterbarhet följer SAMMA tvåpass-regel som framåt-joinen (prefix-räddad rubrik ÄR krediterbar)", () => {
    // Granskningsfix 2026-08-05: räknades förut exakt-bara — hubspots
    // prefix-räddade hero stämplades "aldrig krediterbar" samtidigt som
    // framåt-joinen krediterade den.
    // Det verkliga hubspot-paret: B-rubriken måste vara ≥ 24 tecken för att
    // bära nålen — kortare census-rubriker missar legitimt även i appliern.
    const r = scoreSiteJoin(
      "rotator",
      [
        {
          id: "sec-1-hero",
          type: "hero",
          heading: "Where go-to-market teams go to grow scale close retain grow",
        },
      ],
      new Set(),
      [{ type: "hero", heading: "Where go-to-market teams go to grow" }],
    );
    expect(r.unik).toBe(1);
    expect(r.creditedB).toBe(1);
    expect(r.creditRate).toBe(1);
  });

  it("injektivitet: två A-sektioner kan aldrig kreditera SAMMA census-rubrik", () => {
    // Granskningsfix 2026-08-05: A1 exakt + A2 via prefix mot samma enda
    // B-rubrik gav förut dubbel UNIK ⇒ dubbelkreditering av samma engagemang.
    const r = scoreSiteJoin(
      "kollision",
      [
        { id: "sec-1-pricing", type: "pricing", heading: "Pricing plans for teams large" },
        { id: "sec-2-section", type: "section", heading: "Pricing plans for teams small" },
      ],
      new Set(),
      [{ type: "pricing", heading: "Pricing plans for teams large" }],
    );
    // Exakt träff vinner; prefix-förloraren demoteras till FLERTYDIG.
    const j1 = r.joins.find((j) => j.aId === "sec-1-pricing")!;
    const j2 = r.joins.find((j) => j.aId === "sec-2-section")!;
    expect(j1.verdict).toBe("UNIK");
    expect(j2.verdict).toBe("FLERTYDIG");
    expect(r.unik).toBe(1);
    expect(r.creditedB).toBe(1); // B-rubriken krediteras EN gång
  });
});

const CORPUS_TEN = [
  "hubspot",
  "linear",
  "hibob",
  "nextory",
  "sector-alarm",
  "elskling",
  "cancerfonden",
  "cdon",
  "bokadirekt",
  "bokadirekt-service",
];

describe("sektions-joinen på den committade korpusen (chromium)", () => {
  let result: JoinEvalResult | null = null;
  let chromiumAvailable = false;

  beforeAll(async () => {
    // Sondera chromium-starten SEPARAT (granskningsfix 2026-08-05: en catch
    // runt hela eval:en svalde ALLA fel som "chromium saknas" och lämnade CI
    // grön utan ett ord). Bara sond-misslyckandet får hoppa; ett riktigt
    // harness-fel ska falla testet.
    const { chromium } = await import("playwright");
    try {
      const probe = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      });
      await probe.close();
      chromiumAvailable = true;
    } catch (e) {
      console.warn(`section-join gate hoppas: chromium kan inte startas (${e})`);
      chromiumAvailable = false;
      return;
    }
    // Grindtestet kör BARA fullkontrakts-korpusen (corpus/) — snabbt nog för
    // enhetssvepet; CLI:t täcker hela 28-sajtslistan. INGEN catch här —
    // harness-fel ska synas som testfel, inte som tysta skip.
    result = await evalSectionJoin({ only: CORPUS_TEN });
  }, 420_000);

  afterAll(() => {
    result = null;
  });

  it("hela korpusen mättes — inga tysta bortfall, inga kraschade sajter", (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Populationsgrind (granskningsfix 2026-08-05): en externaliserad eller
    // raderad capture krympte förut nämnaren TYST och omkalibrerade golven.
    expect(result!.skipped).toEqual([]);
    expect(result!.scored.map((s) => s.site).sort()).toEqual([...CORPUS_TEN].sort());
    expect(result!.scored.filter((s) => s.error).map((s) => s.site)).toEqual([]);
  });

  it("KANDIDAT-flyttmålens unika join-täckning håller golvet (steg 8:s rollup-tal)", (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Uppmätt 2026-08-05 (produktions-trogen sida A, rå outerHTML): corpus-
    // delmängden 6/7 = 85,7 %. DISKRET MARGINAL uttalad (granskningsfix):
    // golvet 0,70 valdes mot en 7-kandidatspopulation (tålde en flippad, fångade
    // två). BREDDADE FLYTTREGELN 2026-08-15 tog populationen till 26 och
    // täckningen till 88,5 % (23/26) — marginalen VÄXTE, tvärtemot farhågan att
    // de nya typerna skulle joina sämre. Vid 26 tål golvet fem flippade.
    // Talet SKRIVS UT (granskningsfynd 2026-08-15): golvet kalibrerades på en
    // 7-kandidatspopulation, och breddade flyttregler ändrar populationen —
    // en grind som bara säger godkänt/underkänt döljer att marginalen krymper.
    console.log(
      `[join-eval] kandidat-täckning ${result!.totalCandUnik}/${result!.totalCand} = ${(result!.candCoverage * 100).toFixed(1)} % (golv 70 %)`,
    );
    expect(result!.candCoverage).toBeGreaterThanOrEqual(0.7);
    expect(result!.totalCand).toBeGreaterThanOrEqual(5); // grinden får inte bli tom
  });

  it("alla A-sektioners unika täckning håller golvet", (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    // Uppmätt 2026-08-05 (rå sida A): corpus-delmängden 102/150 = 68,0 %.
    // Nivån dras ner av två ÄRLIGA fyndklasser — extraktionen översegmenterar
    // listsidor (bokadirekt-service: varje tjänst är en h2) och censusen
    // undersegmenterar vissa sidor (cancerfonden ser 2 av 13) — inte av
    // join-regeln. Golvet 0,62 = ~9 sektioners marginal mot dagens 102/150;
    // populationsgrinden ovan hindrar att marginalen "köps" genom tyst
    // korpus-krympning.
    expect(result!.coverage).toBeGreaterThanOrEqual(0.62);
  });
});
