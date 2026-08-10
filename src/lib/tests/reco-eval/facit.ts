// Facit-mätningen (ägarbeslut: "vi måste mäta mot facit!"). Kör den RIKTIGA
// katalog→golv-kedjan mot den dolda sanningen och rapporterar tre tal:
//
//   • BASLINJE = dagens motor-pick. generateCandidates → floorSelection → det
//     högst rankade move_up. Per konstruktion (PROOF_TYPE_WEIGHT dominerar det
//     lilla positions-tillägget) är det den högst viktade BEVIS-TYPEN på sidan
//     — typ-priorn, som aldrig tittar på beteende. Dess träffgrad mot den dolda
//     sanningen är därför SLUMP (~1/k): priorn kan omöjligt veta vilken sektion
//     besökarna faktiskt fastnade på, eftersom sanningen drogs OBEROENDE av typ.
//     Det slumptalet är det ärliga golv steg 7 måste slå.
//   • ORAKEL = argmax(observerat engagemang). Det bästa en beteende-motor KUNDE
//     göra ur samma brusiga signal. Dess träffgrad är TAKET.
//   • HEADROOM = tak − golv. Riktigt, mätt, icke-cirkulärt utrymme att förbättra.
//
// Plus, på VARJE värld: D1/D2-kontraktet håller — varje op katalogen kan sända
// ligger i produktionsvokabulären {move_up, insert_snippet}; varje insert är
// ordagrann sidtext; varje flytt pekar på en riktig sektion. generate.test.ts
// bevisar att VALIDATORN avvisar brott; det här fuzzar GENERATORN över tusentals
// slumpade strukturer så ett brott aldrig ens når validatorn.

import {
  BEHAVIOR_GAIN,
  candidateToOp,
  generateCandidates,
  type BehaviorInput,
  type Candidate,
} from "../../../adaptive/redesign/candidates";
import {
  MIN_VISITS,
  rollupEngagement,
  type SectionObservation,
} from "../../../adaptive/redesign/engagement-rollup";
import { applyProbe, floorSelection } from "../../../adaptive/redesign/select";

import { argmaxKey, makeWorld, type World } from "./simulator";

/** De ENDA op:ar som får nå produktion (generate.ts-validatorns vokabulär). */
const PROD_VOCAB = new Set(["move_up", "insert_snippet"]);

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface FabricationCheck {
  ok: boolean;
  violations: string[];
}

/** D1/D2 som ren predikat över den genererade katalogen. `pageText` är sidans
 *  synliga copy; `sectionIds` de riktiga sektions-id:na. */
export function assertNoFabrication(
  candidates: Candidate[],
  pageText: string,
  sectionIds: Set<string>,
): FabricationCheck {
  const corpus = norm(pageText);
  const violations: string[] = [];
  for (const c of candidates) {
    const op = candidateToOp(c, "rule-selected (no fabricated content)");
    if (!PROD_VOCAB.has(op.op)) {
      violations.push(`${c.id}: op "${op.op}" utanför produktionsvokabulären`);
      continue;
    }
    if (op.op === "move_up") {
      // move: målet måste vara en RIKTIG sektion (inget påhittat mål).
      if (!sectionIds.has(op.targetId))
        violations.push(`${c.id}: move_up mot okänd sektion "${op.targetId}"`);
    } else {
      // insert_snippet: den serverade raden måste vara ordagrann sidtext.
      if (!corpus.includes(norm(op.detail)))
        violations.push(`${c.id}: insert "${op.detail}" är inte ordagrann sidtext`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export interface WorldScore {
  seed: number;
  k: number;
  goldSectionId: string;
  priorSectionId: string;
  /** Golvets högst rankade move_up — sektionen dagens motor skulle lyfta. */
  baselinePick: string | null;
  baselineHit: boolean;
  /** argmax(observerat) — beteende-taket på samma brusiga signal. */
  oraclePick: string;
  oracleHit: boolean;
  /** Steg 7: golvets move_up när sätet matas med w.observed. */
  behaviorPick: string | null;
  behaviorHit: boolean;
  /** Beteende-katalogen har EXAKT samma kandidater (id + detail) som den
   *  beteende-blinda — sätet får bara omranka, aldrig lägga till/ta bort. */
  behaviorSameCatalog: boolean;
  /** Term-förankringen: varje kandidats poäng-delta (med − utan beteende) är
   *  EXAKT sin förankringssektions term — flyttar OCH inserts. Den bundna
   *  trust-raden bär sin sektions term; "body"-raden är neutral. Detta är
   *  grinden som gör insert-förankringen MÄTT, inte bara påstådd. */
  anchorViolations: string[];
  fabrication: FabricationCheck;
}

/** Golvets högst rankade move_up ur en katalog (proben är ett säkerhetsfilter,
 *  inte en rankare — offline utan live-DOM är varje kandidat "applicerbar").
 *  Exporterad: floor-svepet (floor.ts) MÅSTE mäta exakt samma kedja — en
 *  egen kopia hade kunnat divergera tyst (granskningsfynd 2026-08-10). */
export function floorMovePick(candidates: Candidate[]): string | null {
  const menu = applyProbe(
    candidates,
    candidates.map((c) => ({ id: c.id, applicable: true })),
  );
  const sel = floorSelection(menu);
  const topMove = sel?.ordered.find((c) => c.kind === "move_up") ?? null;
  return topMove ? topMove.targetId : null;
}

/** Kandidatens förankringssektion: mv → målet; insh → sektionen ur id:t;
 *  ins → signalens hemvist via detail-matchning (simulatorns texter är korta
 *  och ostädade, så detail == signaltext). null ⇒ ingen förankring (term 0). */
function anchorSection(c: Candidate, w: World): string | null {
  if (c.kind === "move_up") return c.targetId;
  if (c.id.startsWith("insh-")) return c.id.slice("insh-".length);
  const sig = w.content.trustSignals.find((t) => t.text === c.detail);
  if (!sig) return null;
  return sig.section in w.observed ? sig.section : null;
}

/** Poängsätt EN värld: kör den riktiga katalog→golv-kedjan utan och med
 *  beteende-sätet, läs bägge pickarna, räkna orakel-taket och kolla
 *  icke-fabricerings-, samma-katalog- och term-förankrings-invarianterna. */
export function scoreWorld(w: World, behaviorGain?: number): WorldScore {
  const candidates = generateCandidates(w.content);
  const behavior: BehaviorInput = { sectionWeight: w.observed, gain: behaviorGain };
  const behaviorCandidates = generateCandidates(w.content, behavior);
  const catalogKey = (cs: Candidate[]) =>
    cs
      .map((c) => `${c.id}::${c.detail}`)
      .sort()
      .join("\n");
  const baselinePick = floorMovePick(candidates);
  const oraclePick = argmaxKey(w.observed);
  const behaviorPick = floorMovePick(behaviorCandidates);
  const sectionIds = new Set(w.content.sections.map((s) => s.id));

  // Term-förankringen: delta == gain·observerat för kandidatens sektion, 0 för
  // oförankrade (t.ex. "body"-radens insert). Mätt mot BÄGGE katalogerna.
  const gain = behaviorGain ?? BEHAVIOR_GAIN;
  const behScore = new Map(behaviorCandidates.map((c) => [c.id, c.score]));
  const anchorViolations: string[] = [];
  for (const c of candidates) {
    const sec = anchorSection(c, w);
    const expected = sec !== null && sec in w.observed ? gain * w.observed[sec] : 0;
    const delta = (behScore.get(c.id) ?? Number.NaN) - c.score;
    if (!(Math.abs(delta - expected) < 1e-9))
      anchorViolations.push(`${c.id}: delta ${delta} ≠ förväntad term ${expected}`);
  }
  return {
    seed: w.seed,
    k: Object.keys(w.hiddenValue).length,
    goldSectionId: w.goldSectionId,
    priorSectionId: w.priorSectionId,
    baselinePick,
    baselineHit: baselinePick === w.goldSectionId,
    oraclePick,
    oracleHit: oraclePick === w.goldSectionId,
    behaviorPick,
    behaviorHit: behaviorPick === w.goldSectionId,
    behaviorSameCatalog: catalogKey(candidates) === catalogKey(behaviorCandidates),
    anchorViolations,
    fabrication: assertNoFabrication(candidates, w.pageText, sectionIds),
  };
}

export interface FacitReport {
  worlds: number;
  /** Baslinjens (typ-priorns) träffgrad mot dolda sanningen — väntas ≈ slump. */
  baselineHitRate: number;
  /** Orakel-på-observerat träffgrad — beteende-taket. */
  oracleHitRate: number;
  /** tak − golv: det mätta, icke-cirkulära headroom:et för steg 7. */
  headroom: number;
  /** Steg 7: beteende-sätets träffgrad. OBS ärlig läsning: sätet matas här med
   *  ett PERFEKT per-sektion-signal (samma karta oraklet argmax:ar), så att den
   *  når referens-taket är väntat BY CONSTRUCTION — detta är ett RÖR-TEST som
   *  bevisar att den riktiga katalog→golv-kedjan bär signalen förlustfritt och
   *  att gain-styrkan räcker för att beteendet ska leda över priorn. Att RIKTIG
   *  rollup-data förutsäger konvertering bevisas inte här — det är steg 8–10,
   *  mätta på samma rigg när rollupens ofullkomliga input ersätter den perfekta. */
  behaviorHitRate: number;
  /** (beteende−golv)/(tak−golv). Kan överstiga 1: referens-taket är argmax med
   *  alfabetiskt tiebreak; vid mätta/nära-lika observationer bryter sätet med
   *  priorn i stället och kan vinna slantsinglingen (±1 pp tie-brus). */
  headroomClosed: number;
  /** mean(1/k): slump-referensen baslinjen bör ligga på. */
  chanceRate: number;
  /** Världar där golvets flytt-pick == typ-priorn (måste vara ALLA). */
  baselineEqualsPrior: number;
  /** Världar där beteende-katalogen inte var samma kandidat-mängd (måste vara 0). */
  catalogDrift: number;
  /** Totalt antal term-förankringsbrott (flyttar + inserts) — måste vara 0. */
  anchorViolationCount: number;
  /** Totalt antal D1/D2-brott över alla världar (måste vara 0). */
  fabricationViolations: number;
  scores: WorldScore[];
}

/** Kör facit:et över en frölista. Ren + deterministisk — samma frön in, samma
 *  rapport ut (hela skälet till att det kan vara ett committat test).
 *  `behaviorGain` är BARA för gain-svepet — produktionen kör default-gainen. */
export function runFacit(seeds: number[], behaviorGain?: number): FacitReport {
  const scores = seeds.map((s) => scoreWorld(makeWorld(s), behaviorGain));
  const n = scores.length || 1;
  const mean = (f: (s: WorldScore) => number) => scores.reduce((a, s) => a + f(s), 0) / n;
  const baselineHitRate = mean((s) => (s.baselineHit ? 1 : 0));
  const oracleHitRate = mean((s) => (s.oracleHit ? 1 : 0));
  const behaviorHitRate = mean((s) => (s.behaviorHit ? 1 : 0));
  const chanceRate = mean((s) => 1 / s.k);
  const headroom = oracleHitRate - baselineHitRate;
  const baselineEqualsPrior = scores.filter((s) => s.baselinePick === s.priorSectionId).length;
  const catalogDrift = scores.filter((s) => !s.behaviorSameCatalog).length;
  const anchorViolationCount = scores.reduce((a, s) => a + s.anchorViolations.length, 0);
  const fabricationViolations = scores.reduce((a, s) => a + s.fabrication.violations.length, 0);
  return {
    worlds: scores.length,
    baselineHitRate,
    oracleHitRate,
    headroom,
    behaviorHitRate,
    headroomClosed: headroom > 0 ? (behaviorHitRate - baselineHitRate) / headroom : 0,
    chanceRate,
    baselineEqualsPrior,
    catalogDrift,
    anchorViolationCount,
    fabricationViolations,
    scores,
  };
}

// ── Steg 8: rollupen genom facit:et — OFULLKOMLIG input ersätter den perfekta ─
// Steg 7:s rör-test matade sätet med exakt samma karta oraklet argmax:ar. Det
// här mäter kedjan STEG 9-EVENTS → ROLLUP → SÄTE på samma världar: observa-
// tioner keyade på census-RUBRIKER (inte id:n), garblade rubriker (rotator-
// klassen), tunna världar och okrediterbar massa. Deterministiskt — inga nya
// slumpdrag, allt härleds ur världens befintliga fält.

export interface RollupFacitReport {
  worlds: number;
  /** Ren rubrik-keyad input ⇒ rollup-medierad pick == direkta sätets pick. */
  cleanAgrees: number;
  /** Suffix-driftade census-rubriker ⇒ prefix-passet bär; samma pick. OBS
   *  ärlig läsning (granskning 2026-08-05): nålen är PER KONSTRUKTION ett
   *  prefix av den driftade nyckeln, så det här är en MEKANISM-kontroll av
   *  prefix-vägen genom rollupen — inte ett stresstest av rotator-klassen
   *  (A-sida-garble mot ren census mäts i join-eval:en på riktiga sidor). */
  garbleAgrees: number;
  /** GRÄNSTEST tunn data: total exakt 1 under golvet ⇒ null... */
  thinNullJustBelow: number;
  /** ...och exakt PÅ golvet ⇒ svar — grinden testas från BÅDA håll per värld
   *  (granskningsfix: fasta 300/400-mot-1000 var en enda punkt långt från
   *  gränsen utklädd till svep). */
  thinAnswerAtFloor: number;
  /** GRÄNSTEST miss-massa: strax ÖVER taket ⇒ null... */
  missNullJustOver: number;
  /** ...och strax UNDER ⇒ svar med junk-nyckeln synlig i unattributed. */
  missAnswerJustUnder: number;
  /** Konsistens-invariant (INTE oberoende upptäckt — beräkningen delar väg
   *  med baselineEqualsPrior): null-vägens katalog ger typ-priorns pick. */
  nullFallsBackToBaseline: number;
}

/** Kör rollup-facit:et: deterministiska scenarier per värld, med BÅDA
 *  tröskelgrindarna testade från bägge sidor om sina gränser. Varje räknare
 *  ska nå `worlds`. */
export function runRollupFacit(seeds: number[]): RollupFacitReport {
  let cleanAgrees = 0;
  let garbleAgrees = 0;
  let thinNullJustBelow = 0;
  let thinAnswerAtFloor = 0;
  let missNullJustOver = 0;
  let missAnswerJustUnder = 0;
  let nullFallsBackToBaseline = 0;
  // Över laddningsgolvet (rollupens max-per-nyckel-proxy) med marginal.
  const VISITS_PER_SECTION = 1200;
  for (const seed of seeds) {
    const w = makeWorld(seed);
    const sections = w.content.sections.map((s) => ({
      id: s.id,
      type: s.type,
      heading: s.heading,
    }));
    const proof = sections.filter((s) => s.id in w.observed);
    const k = proof.length;
    const cleanObs: SectionObservation[] = proof.map((s) => ({
      heading: s.heading,
      visits: VISITS_PER_SECTION,
      engagement: w.observed[s.id],
    }));
    // Direktvägen får SAMMA inputform som produktionen (dynamiska golvet):
    // vikter + per-sektion-n. Uniform n ⇒ krympningen är gemensam för alla
    // termer, och jämförelsen mäter fortfarande join-troheten ensam.
    const uniformVisits = Object.fromEntries(proof.map((s) => [s.id, VISITS_PER_SECTION]));
    const directPick = floorMovePick(
      generateCandidates(w.content, {
        sectionWeight: w.observed,
        sectionVisits: uniformVisits,
      }),
    );
    const pickVia = (weights: Record<string, number>, visits: Record<string, number>) =>
      floorMovePick(
        generateCandidates(w.content, { sectionWeight: weights, sectionVisits: visits }),
      );

    // 1) Ren rubrik-keyad input — upplösningen ska vara förlustfri.
    const clean = rollupEngagement(sections, cleanObs);
    if (clean && pickVia(clean.sectionWeight, clean.sectionVisits) === directPick) cleanAgrees++;

    // 2) Suffix-drift på census-sidan — mekanism-kontroll av prefix-vägen
    //    (se fältdoc: nålen är per konstruktion ett prefix; kan inte fallera
    //    på join-nivån — det som mäts är att HELA rollup-vägen bär den).
    const garbled = rollupEngagement(
      sections,
      cleanObs.map((o) => ({ ...o, heading: `${o.heading} spring update v2` })),
    );
    if (garbled && pickVia(garbled.sectionWeight, garbled.sectionVisits) === directPick)
      garbleAgrees++;

    // 3) GRÄNSTEST tunn data: laddningsgolvet mäter LADDNINGAR (max per
    //    nyckel — granskningsfix 2026-08-08, enhetsinflationen): varje sektion
    //    bärs av SAMMA antal laddningar v — grinden ska flippa exakt på
    //    v = golv, varje värld.
    const spread = (v: number): SectionObservation[] =>
      proof.map((s) => ({
        heading: s.heading,
        visits: v,
        engagement: w.observed[s.id],
      }));
    if (rollupEngagement(sections, spread(MIN_VISITS - 1)) === null) thinNullJustBelow++;
    if (rollupEngagement(sections, spread(MIN_VISITS)) !== null) thinAnswerAtFloor++;

    // 4) GRÄNSTEST miss-massa: junk-besök som lägger massan strax ÖVER
    //    respektive strax UNDER taket (C = ren massa ⇒ junk C+800 ger
    //    (C+800)/(2C+800) > 1/2; junk C−800 ger < 1/2). Under-fallet ska
    //    svara OCH lista junk-nyckeln som okrediterbar.
    const C = VISITS_PER_SECTION * k;
    const JUNK = "Cookie consent preferences";
    const missOver = rollupEngagement(sections, [
      ...cleanObs,
      { heading: JUNK, visits: C + VISITS_PER_SECTION, engagement: 0.1 },
    ]);
    if (missOver === null) {
      missNullJustOver++;
      if (floorMovePick(generateCandidates(w.content)) === w.priorSectionId)
        nullFallsBackToBaseline++;
    }
    const missUnder = rollupEngagement(sections, [
      ...cleanObs,
      { heading: JUNK, visits: C - VISITS_PER_SECTION, engagement: 0.1 },
    ]);
    if (
      missUnder !== null &&
      missUnder.unattributed.includes(JUNK) &&
      pickVia(missUnder.sectionWeight, missUnder.sectionVisits) === directPick
    )
      missAnswerJustUnder++;
  }
  return {
    worlds: seeds.length,
    cleanAgrees,
    garbleAgrees,
    thinNullJustBelow,
    thinAnswerAtFloor,
    missNullJustOver,
    missAnswerJustUnder,
    nullFallsBackToBaseline,
  };
}

/** Gain-svepet som VALDE BEHAVIOR_GAIN (öppet beslut → mätt beslut): träffgrad
 *  per gain-värde, samma världar. gain 0 ≡ baslinjen; träffgraden stiger med
 *  gain UPP TILL mättnad — ovanför mättnad är skillnaderna frö-brus (±1 pp
 *  mellan fröbaser), så "40 vs 100" avgörs av närhet-till-mättnad, inte av
 *  vilken som råkar ligga högst på en enskild bas. */
export function gainSweep(seeds: number[], gains: number[]): { gain: number; hitRate: number }[] {
  return gains.map((gain) => ({ gain, hitRate: runFacit(seeds, gain).behaviorHitRate }));
}

/** Standard-frösvepet, DEKORRELERAT med en prim-stride (samma idiom som
 *  winner-calibration: `t * 7919`). Löpande heltalsfrön kan korrelera en
 *  hash-PRNG:s FÖRSTA utdata (den som sätter k) mellan grannar; prim-striden
 *  sprider världarna så träffgraderna blir iid-lik statistik, inte struktur. */
export function seedSweep(n: number, base = 1): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 7919);
}
