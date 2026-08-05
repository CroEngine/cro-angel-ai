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

import { assertNoFabrication, gainSweep, runFacit, seedSweep } from "../facit";
import { makeWorld } from "../simulator";

// Ett brett svep — deterministiskt, så talen är låsta; N stort nog att
// träffgraderna är stabila statistik, inte enskilda utfall.
const REPORT = runFacit(seedSweep(600));

describe("reco-eval facit — baslinjen mot dold sanning", () => {
  it("golvets flytt-pick ÄR typ-priorn på varje värld (baslinjen tittar aldrig på beteende)", () => {
    // Bevisar att "baslinjen" vi mäter verkligen är dagens typvikts-prior:
    // PROOF_TYPE_WEIGHT dominerar positions-tillägget, så golvet lyfter alltid
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

  it("steg 7: beteende-sätet återfinner facit VID TAKET — headroom:et stängt", () => {
    // Samma golv, samma världar — enda skillnaden är att sätet matas med det
    // observerade engagemanget. Träffgraden ska lämna slumpnivån och lägga sig
    // vid orakel-taket: det mätta headroom:et från steg 6 är stängt.
    expect(REPORT.behaviorHitRate).toBeGreaterThan(0.7);
    expect(REPORT.behaviorHitRate).toBeGreaterThanOrEqual(REPORT.oracleHitRate - 0.05);
    expect(REPORT.behaviorHitRate).toBeGreaterThanOrEqual(REPORT.baselineHitRate + 0.3);
    expect(REPORT.headroomClosed).toBeGreaterThan(0.85);
  });

  it("steg 7: sätet omrankar BARA — exakt samma kandidat-mängd som utan beteende", () => {
    // D1-vakt: beteendedata får aldrig skapa eller ta bort ett drag, bara
    // ändra ordningen mellan drag som ändå var lagliga.
    expect(REPORT.catalogDrift).toBe(0);
  });

  it("steg 7: gain-svepet motiverar BEHAVIOR_GAIN — monotont mot taket, valet nära mättnad", () => {
    const sweep = gainSweep(seedSweep(300), [0, 5, 40, 100]);
    const at = (g: number) => sweep.find((s) => s.gain === g)!.hitRate;
    // gain 0 ≡ baslinjen (sätet är neutralt utan styrka)...
    expect(at(0)).toBeCloseTo(runFacit(seedSweep(300), 0).baselineHitRate, 10);
    // ...styrkan lyfter mot taket...
    expect(at(5)).toBeGreaterThan(at(0) + 0.25);
    expect(at(40)).toBeGreaterThan(at(5));
    // ...och det valda värdet är nära mättnad (mer styrka köper < 3 pp).
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

  it("extraktionen ger en icke-trivial modell (sektioner + trust-rader)", () => {
    expect(content.sections.length).toBeGreaterThanOrEqual(3);
    expect(content.trustSignals.length).toBeGreaterThanOrEqual(1);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it("katalogen täcker BÅDA op-typerna (flytt + ordagrann insert)", () => {
    expect(candidates.some((c) => c.kind === "move_up")).toBe(true);
    expect(candidates.some((c) => c.kind === "insert_snippet")).toBe(true);
  });

  it("varje kandidat är vokabulär-låst, verbatim och pekar på en riktig sektion", () => {
    const sectionIds = new Set(content.sections.map((s) => s.id));
    const check = assertNoFabrication(candidates, flatten(FIXTURE_HTML), sectionIds);
    // Om det brister vill vi SE vad — violations-listan är diagnosen.
    expect(check.violations).toEqual([]);
    expect(check.ok).toBe(true);
  });
});
