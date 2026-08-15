// Facit-testet (steg 6): mäter dagens rekommendations-baslinje mot en dold
// sanning och grindar D1/D2 över tusentals slumpade världar. Rent, seedat,
// deterministiskt — ingen webbläsare, inget nät, inga credits.
//
// Icke-cirkulariteten är hela poängen: den dolda sanningen dras OBEROENDE av
// sektionstyp, så baslinjen (typ-priorn) inte kan "råka rätt" via generatorn.
// Håller priorn ändå ~slumpnivå och ligger orakel-på-observerat långt ovanför,
// då finns ett riktigt, mätt headroom för beteende-motorn (steg 7) att stänga.
import { describe, expect, it } from "vitest";

import { generateCandidates } from "../../../../adaptive/redesign/candidates";
import { extractContentModel } from "../../../../adaptive/redesign/extract";

import {
  assertNoFabrication,
  FACIT_OPS,
  gainSweep,
  reachSweep,
  runFacit,
  runRollupFacit,
  seedSweep,
} from "../facit";
import { runFloorSweep } from "../floor";
import { makeWorld } from "../simulator";

// Ett brett svep — deterministiskt, så talen är låsta; N stort nog att
// träffgraderna är stabila statistik, inte enskilda utfall.
const REPORT = runFacit(seedSweep(600));

describe("reco-eval facit — baslinjen mot dold sanning", () => {
  it("golvets flytt-pick ÄR typ-priorn på varje värld (baslinjen tittar aldrig på beteende)", () => {
    // Bevisar att "baslinjen" vi mäter verkligen är dagens typvikts-prior:
    // MOVE_TYPE_WEIGHT dominerar positions-tillägget, så golvet lyfter alltid
    // den högst viktade bevis-typen — oberoende av vad besökarna gjorde.
    expect(REPORT.baselineEqualsPrior).toBe(REPORT.worlds);
  });

  it("baslinjen träffar facit på SLUMPNIVÅ — priorn kan inte veta sanningen", () => {
    // Sanningen drogs oberoende av typ ⇒ typ-priorn har ingen information.
    // Träffgraden ska sitta på mean(1/k), inte över.
    expect(Math.abs(REPORT.baselineHitRate - REPORT.chanceRate)).toBeLessThan(0.06);
  });

  it("orakel-på-observerat slår baslinjen med bred marginal — mätbart headroom finns", () => {
    // Taket (bästa en beteende-motor kunde nå ur samma brusiga signal) ligger
    // långt över golvet. Gapet är det icke-cirkulära utrymmet steg 7 ska ta.
    expect(REPORT.oracleHitRate).toBeGreaterThan(0.6);
    expect(REPORT.oracleHitRate).toBeGreaterThan(REPORT.baselineHitRate + 0.25);
    expect(REPORT.headroom).toBeGreaterThan(0.25);
  });

  it("noll fabricering över alla världar (D1/D2 håller by construction i generatorn)", () => {
    // generate.test.ts bevisar att VALIDATORN avvisar brott; det här fuzzar
    // GENERATORN så ett brott aldrig ens uppstår att avvisa.
    expect(REPORT.fabricationViolations).toBe(0);
  });

  it("steg 7 RÖR-TESTET: sätet bär ett perfekt signal förlustfritt till referens-taket", () => {
    // ÄRLIG LÄSNING (granskning 2026-08-05): sätet matas här med SAMMA karta
    // oraklet argmax:ar, så att det når taket är väntat by construction. Det
    // som bevisas är att den RIKTIGA katalog→golv-kedjan inte tappar/förvränger
    // signalen och att gain-styrkan räcker för att beteendet ska leda över
    // priorn. Att riktig rollup-data förutsäger konvertering bevisas i steg
    // 8–10, på samma rigg, när ofullkomlig input ersätter den perfekta.
    expect(REPORT.behaviorHitRate).toBeGreaterThan(0.7);
    expect(REPORT.behaviorHitRate).toBeGreaterThanOrEqual(REPORT.oracleHitRate - 0.05);
    expect(REPORT.behaviorHitRate).toBeGreaterThanOrEqual(REPORT.baselineHitRate + 0.3);
    // Kvot av headroom — kan överstiga 1 av tie-brus (referens-takets tiebreak
    // är alfabetiskt, sätets är priorn; nära-lika avgörs olika ±1 pp).
    expect(REPORT.headroomClosed).toBeGreaterThan(0.85);
  });

  it("steg 7: term-förankringen är MÄTT — flyttar och inserts bär exakt sin sektions term", () => {
    // Varje världs katalog diffas kandidat för kandidat (med − utan beteende):
    // mv → målsektionens term, insh → sin sektions term, bunden trust-rad →
    // sin hemvists term, "body"-raden → exakt 0. Detta är grinden som gör
    // insert-förankringen bevisad i facit:et, inte bara påstådd i en enhetstest.
    expect(REPORT.anchorViolationCount).toBe(0);
    // Och grinden är INTE tom. Vakten granskar KATALOGEN, inte världen
    // (granskningsfynd 2026-08-15: den läste w.content.trustSignals, som är
    // sann även när katalogen slutat generera en enda insert — precis vad som
    // hände när vokabulären blev move-only och fuzzen tystnade utan att ett
    // test föll). Nu räknas de faktiska kandidaterna, per klass.
    const w = makeWorld(42);
    const cands = generateCandidates(w.content, undefined, undefined, undefined, FACIT_OPS);
    expect(cands.some((c) => c.kind === "move_up")).toBe(true);
    expect(cands.some((c) => c.id.startsWith("insh-"))).toBe(true);
    expect(cands.some((c) => c.id.startsWith("ins-"))).toBe(true);
    // ...och bägge insert-klasserna är representerade i världen de kommer ur.
    expect(w.content.trustSignals.some((t) => t.section === w.boundSectionId)).toBe(true);
    expect(w.content.trustSignals.some((t) => t.section === "body")).toBe(true);
    expect(w.pageText).toContain(w.boundText);
    expect(w.pageText).toContain(w.unboundText);
  });

  it("steg 7: sätet omrankar BARA — exakt samma kandidat-mängd som utan beteende", () => {
    // D1-vakt: beteendedata får aldrig skapa eller ta bort ett drag, bara
    // ändra ordningen mellan drag som ändå var lagliga.
    expect(REPORT.catalogDrift).toBe(0);
  });

  it("steg 7: gain-svepet motiverar BEHAVIOR_GAIN — stiger till mättnad, valet nära platån", () => {
    // OBS: "monoton" gäller UPP TILL mättnad — på platån är ordningen frö-brus
    // (±1 pp mellan fröbaser), så svepet grindar närhet-till-mättnad, aldrig
    // vilken platå-punkt som råkar ligga högst på en enskild bas.
    const sweep = gainSweep(seedSweep(300), [0, 5, 40, 100]);
    const at = (g: number) => sweep.find((s) => s.gain === g)!.hitRate;
    // gain 0 ≡ baslinjen (sätet är neutralt utan styrka)...
    expect(at(0)).toBeCloseTo(runFacit(seedSweep(300), 0).baselineHitRate, 10);
    // ...styrkan lyfter mot mättnad...
    expect(at(5)).toBeGreaterThan(at(0) + 0.25);
    expect(at(40)).toBeGreaterThan(at(5));
    // ...och det valda värdet ÄR på platån (mer styrka flyttar < 3 pp åt något håll).
    expect(Math.abs(at(100) - at(40))).toBeLessThan(0.03);
  });

  it("reproducerbart — samma frön in, samma rapport ut", () => {
    const a = runFacit(seedSweep(300));
    const b = runFacit(seedSweep(300));
    expect(a.baselineHitRate).toBe(b.baselineHitRate);
    expect(a.oracleHitRate).toBe(b.oracleHitRate);
    expect(a.headroom).toBe(b.headroom);
    expect(a.behaviorHitRate).toBe(b.behaviorHitRate);
    expect(a.fabricationViolations).toBe(b.fabricationViolations);
  });

  it("makeWorld är deterministiskt och golds är en riktig sektion", () => {
    const w1 = makeWorld(42);
    const w2 = makeWorld(42);
    expect(w1.goldSectionId).toBe(w2.goldSectionId);
    expect(w1.content.sections.some((s) => s.id === w1.goldSectionId)).toBe(true);
    // Golds är ett BEVIS-sektions-id (aldrig hjälten — hjälten är inget lyftmål).
    expect(w1.goldSectionId).not.toBe("sec-0-hero");
  });
});

// ── Flyttregelns tak (breddningen 2026-08-15) ────────────────────────────────
describe("flyttregeln: sidans bästa sektion måste kunna nås", () => {
  // Blandade världar — bevis-sektioner PLUS features/faq/comparison, sanning
  // dragen oberoende av typ precis som i steg 6. Frågan är ledet FÖRE
  // rankningen: finns guldet överhuvudtaget i menyn? Med den smala regeln
  // (bara bevis-typer) var svaret nej i 45 % av världarna — ett tak som
  // varken beteende-sätet, väljar-modellen eller mer trafik kunde nå förbi,
  // och som runFacit inte kan se eftersom dess världar bara har bevis-typer.
  const R = reachSweep(seedSweep(300));

  it("guldet är ALLTID en laglig kandidat — inget osynligt tak kvar", () => {
    expect(R.reachable).toBe(1);
  });

  it("beteende-sätet når orakel-taket i blandade världar", () => {
    // Före breddningen: 44,8 % mot orakelns 67,8 % — gapet var rena
    // menyluckan, inte rankningsfel. Efter: sätet ligger på taket.
    expect(R.behaviorHitRate).toBeGreaterThan(0.6);
    expect(R.behaviorHitRate).toBeGreaterThanOrEqual(R.oracleHitRate - 0.05);
  });

  it("priorn påstår INGENTING nytt — baslinjen ligger kvar på slumpnivå", () => {
    // De nya vikterna ligger under pricing (1,5), så typ-priorn har inte
    // blivit bättre på att gissa; det är beteendet som får chansen. Faller
    // det här testet har någon gett en icke-bevis-typ för hög vikt.
    expect(R.baselineHitRate).toBeLessThan(0.3);
  });
});

describe("steg 8: rollupen genom facit:et — ofullkomlig input ersätter den perfekta", () => {
  // Kedjan steg 9-events (rubrik-keyade) → rollup → säte, på samma världar som
  // steg 6/7. Deterministiskt: inga nya slumpdrag, allt härlett ur världarna.
  const R = runRollupFacit(seedSweep(300));

  it("ren rubrik-keyad input är FÖRLUSTFRI — rollup-medierad pick == direkta sätets", () => {
    expect(R.cleanAgrees).toBe(R.worlds);
  });

  it("suffix-driftade census-rubriker bärs av prefix-vägen (mekanism-kontroll) — samma pick", () => {
    // Ärligt märkt: nålen är per konstruktion ett prefix av den driftade
    // nyckeln, så join-nivån kan inte fallera här — det som grindas är att
    // HELA rollup-vägen (aggregat → join → vikter → säte) bär den förlustfritt.
    expect(R.garbleAgrees).toBe(R.worlds);
  });

  it("tunn-grinden flippar på EXAKT besöksgolvet — bägge sidor, varje värld", () => {
    expect(R.thinNullJustBelow).toBe(R.worlds);
    expect(R.thinAnswerAtFloor).toBe(R.worlds);
  });

  it("miss-grinden flippar kring taket — null strax över, svar med synlig junk strax under", () => {
    expect(R.missNullJustOver).toBe(R.worlds);
    expect(R.missAnswerJustUnder).toBe(R.worlds);
    // Konsistens-invariant (delar beräkningsväg med baselineEqualsPrior).
    expect(R.nullFallsBackToBaseline).toBe(R.worlds);
  });
});

describe("dynamiska golvet — floor-svepet motiverar MIN_SECTION_VISITS=30 + n/(n+50)", () => {
  // Samma verktyg som `bun run reco-eval:floor` (4000-världars-talen i
  // floor.ts-huvudet), här med färre världar som CI-grind. Jämförelserna är
  // PARADE (samma världar, samma observerade counts för varje policy), så
  // differenserna är stabila långt under stickprovets egen ±SE.
  const spridda = runFloorSweep({ worlds: 300, ladder: [10, 30, 1000] });
  const täta = runFloorSweep({ worlds: 300, ladder: [10, 1000], compress: 0.2 });
  const at = (rows: typeof spridda, n: number) => rows.find((r) => r.n === n)!;

  it("n=30: den valda regeln tar större delen av orakelgapet — hårda 1000-grinden står på priorn", () => {
    const r = at(spridda, 30);
    // Mätt @4000 (prim-strid): vald 84,9 %, prior 29,4, orakel 85,8.
    expect(r.hit.vald).toBeGreaterThan(0.75);
    expect(r.hit.idag1000).toBe(r.priorHit); // grinden: exakt priorns pick
    expect(r.hit.vald).toBeGreaterThan(r.hit.idag1000 + 0.4);
    // Och ägarens "efter ex 100"-tröskel är också blind här — n=30 < 100.
    expect(r.hit["tröskel100"]).toBe(r.priorHit);
  });

  it("n=30: volymkrympningen slår z-tilltrosregeln (giltighetsregeln svälter tilltron)", () => {
    const r = at(spridda, 30);
    // Mätt @4000 (prim-strid): 84,9 mot 54,7 — parad differens, stabil även @300.
    expect(r.hit.vald).toBeGreaterThan(r.hit.tilltro + 0.1);
  });

  it("n=10 (under golvet): vald är EXAKT priorn — golvet tystar helt, aldrig halvvägs", () => {
    const r = at(spridda, 10);
    expect(r.hit.vald).toBe(r.priorHit);
    expect(r.brokeCorrectPrior.vald).toBe(0);
  });

  it("täta världar n=10: golvet är det som gör krympningen säker", () => {
    // Utan golv sönderdelar volymregeln korrekta priors på svår-sidorna
    // (mätt @4000: 9,6 %) — med golvet: exakt 0. Detta är hela skälet till
    // att golvet vid 30 följer med krympningen.
    const r = at(täta, 10);
    expect(r.brokeCorrectPrior.vald).toBe(0);
    expect(r.brokeCorrectPrior.volymUtanGolv).toBeGreaterThan(0.02);
  });

  it("n=1000: bytet kostar inget där datan är riklig — vald ≈ gamla hårda grinden", () => {
    // Parad jämförelse: enda skillnaden är krympningen 1000/1050 ≈ 0,95.
    const s = at(spridda, 1000);
    expect(Math.abs(s.hit.vald - s.hit.idag1000)).toBeLessThan(0.03);
    const t = at(täta, 1000);
    expect(Math.abs(t.hit.vald - t.hit.idag1000)).toBeLessThan(0.05);
  });

  it("reproducerbart — samma frön in, samma rader ut", () => {
    const a = runFloorSweep({ worlds: 50, ladder: [30] });
    const b = runFloorSweep({ worlds: 50, ladder: [30] });
    expect(a).toEqual(b);
  });
});

// En liten men realistisk sida genom den RIKTIGA extraktionen — hero + en vägg
// citat (testimonials), en "trusted by"-logga-strip, en prissektion, och trust-
// rader i den platta texten. Ordagrannhets-checken går mot sidans RÅ-text, så
// den bevisar D2 genom extract.ts:s riktiga tidy/tidySignalText-transformer,
// inte mot modellens egna strängar (vilket vore cirkulärt).
const FIXTURE_HTML = `<!doctype html><html><body>
<main>
  <h1>Ship faster with Northwind</h1>
  <p>The platform product teams rely on. Trusted by 12,000 teams worldwide.</p>

  <h2>Loved by teams everywhere</h2>
  <blockquote>Northwind changed how we ship.</blockquote>
  <blockquote>Best decision we made this year.</blockquote>
  <blockquote>Our conversion rate doubled.</blockquote>
  <blockquote>Support is genuinely incredible.</blockquote>

  <h2>Trusted by the best brands</h2>
  <p>Trusted by Acme, Globex, Initech and 200 other companies.</p>
  <img src="acme.png" alt="Acme"><img src="globex.png" alt="Globex">

  <h2>Simple, honest pricing</h2>
  <p>Plans from $29 per month. 30-day money-back guarantee.</p>
</main>
</body></html>`;

/** Strip taggar till synlig text (fixturen har inga HTML-entiteter, så detta
 *  matchar extract.ts:s stripTags-normalisering för substräng-checken). */
const flatten = (html: string): string => html.replace(/<[^>]+>/g, " ");

describe("reco-eval facit — D2 genom den riktiga extraktionen", () => {
  const content = extractContentModel(FIXTURE_HTML);
  const candidates = generateCandidates(content);
  // D2-kollen ska granska HELA katalogens förmåga, inte bara det nattloopen
  // för närvarande genererar: vokabulären är move-only sedan ägarbeslutet
  // 2026-08-15, men insert-maskineriet ligger kvar och servar godkända
  // varianter — alltså måste ordagrannhets-kravet fortsatt bevakas på det.
  const wideCandidates = generateCandidates(content, undefined, undefined, undefined, [
    "move_up",
    "insert_snippet",
  ]);

  it("extraktionen ger en icke-trivial modell (sektioner + trust-rader)", () => {
    expect(content.sections.length).toBeGreaterThanOrEqual(3);
    expect(content.trustSignals.length).toBeGreaterThanOrEqual(1);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it("extraktionen binder trust-rader till sina hemvist-sektioner (steg 7-fyndet)", () => {
    // Garantiraden bor i prissektionens kropp ⇒ extract.ts binder den dit, och
    // därmed kan beteende-sätet förankra dess insert i produktion (var förut
    // hårdkodad "body" ⇒ förankringen var död kod på riktiga sidor).
    const pricing = content.sections.find((s) => s.type === "pricing")!;
    const guarantee = content.trustSignals.find((t) => t.type === "guarantee")!;
    expect(guarantee.section).toBe(pricing.id);
  });

  it("standardvokabulären ger BARA flyttar (ägarbeslut 2026-08-15)", () => {
    expect(candidates.every((c) => c.kind === "move_up")).toBe(true);
  });

  it("katalogen täcker BÅDA op-typerna när vokabulären släpper på insert", () => {
    expect(wideCandidates.some((c) => c.kind === "move_up")).toBe(true);
    expect(wideCandidates.some((c) => c.kind === "insert_snippet")).toBe(true);
  });

  it("varje kandidat är vokabulär-låst, verbatim och pekar på en riktig sektion", () => {
    const sectionIds = new Set(content.sections.map((s) => s.id));
    // Granskas på den BREDA katalogen: D2 (aldrig fabricera) är ett krav på
    // varje text vi kan skriva till en kundsida, och insert-grenen är den enda
    // som skriver text alls. Kollar vi bara move-only-menyn blir kontrollen
    // sann men tom.
    const check = assertNoFabrication(wideCandidates, flatten(FIXTURE_HTML), sectionIds);
    // Om det brister vill vi SE vad — violations-listan är diagnosen.
    expect(check.violations).toEqual([]);
    expect(check.ok).toBe(true);
  });
});
