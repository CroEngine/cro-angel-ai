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
  candidateToOp,
  generateCandidates,
  type Candidate,
} from "../../../adaptive/redesign/candidates";
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
  fabrication: FabricationCheck;
}

/** Poängsätt EN värld: kör den riktiga katalog→golv-kedjan, läs baslinjens pick,
 *  räkna orakel-taket och kolla icke-fabricerings-invarianten. */
export function scoreWorld(w: World): WorldScore {
  const candidates = generateCandidates(w.content);
  // Ingen live-DOM offline, så varje kandidat är "applicerbar" (proben är ett
  // säkerhetsfilter, inte en rankare — floorSelection rankar ändå på poäng).
  const menu = applyProbe(
    candidates,
    candidates.map((c) => ({ id: c.id, applicable: true })),
  );
  const sel = floorSelection(menu);
  const topMove = sel?.ordered.find((c) => c.kind === "move_up") ?? null;
  const baselinePick = topMove ? topMove.targetId : null;
  const oraclePick = argmaxKey(w.observed);
  const sectionIds = new Set(w.content.sections.map((s) => s.id));
  return {
    seed: w.seed,
    k: Object.keys(w.hiddenValue).length,
    goldSectionId: w.goldSectionId,
    priorSectionId: w.priorSectionId,
    baselinePick,
    baselineHit: baselinePick === w.goldSectionId,
    oraclePick,
    oracleHit: oraclePick === w.goldSectionId,
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
  /** mean(1/k): slump-referensen baslinjen bör ligga på. */
  chanceRate: number;
  /** Världar där golvets flytt-pick == typ-priorn (måste vara ALLA). */
  baselineEqualsPrior: number;
  /** Totalt antal D1/D2-brott över alla världar (måste vara 0). */
  fabricationViolations: number;
  scores: WorldScore[];
}

/** Kör facit:et över en frölista. Ren + deterministisk — samma frön in, samma
 *  rapport ut (hela skälet till att det kan vara ett committat test). */
export function runFacit(seeds: number[]): FacitReport {
  const scores = seeds.map((s) => scoreWorld(makeWorld(s)));
  const n = scores.length || 1;
  const mean = (f: (s: WorldScore) => number) => scores.reduce((a, s) => a + f(s), 0) / n;
  const baselineHitRate = mean((s) => (s.baselineHit ? 1 : 0));
  const oracleHitRate = mean((s) => (s.oracleHit ? 1 : 0));
  const chanceRate = mean((s) => 1 / s.k);
  const baselineEqualsPrior = scores.filter((s) => s.baselinePick === s.priorSectionId).length;
  const fabricationViolations = scores.reduce((a, s) => a + s.fabrication.violations.length, 0);
  return {
    worlds: scores.length,
    baselineHitRate,
    oracleHitRate,
    headroom: oracleHitRate - baselineHitRate,
    chanceRate,
    baselineEqualsPrior,
    fabricationViolations,
    scores,
  };
}

/** Standard-frösvepet, DEKORRELERAT med en prim-stride (samma idiom som
 *  winner-calibration: `t * 7919`). Löpande heltalsfrön kan korrelera en
 *  hash-PRNG:s FÖRSTA utdata (den som sätter k) mellan grannar; prim-striden
 *  sprider världarna så träffgraderna blir iid-lik statistik, inte struktur. */
export function seedSweep(n: number, base = 1): number[] {
  return Array.from({ length: n }, (_, i) => base + i * 7919);
}
