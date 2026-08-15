// Syntetisk facit-simulator — "dold sanning + brus" (ägarbeslut 2026-08-05).
//
// Vi har ingen riktig A/B-vinnardata än. En handskriven "rätt svar"-etikett som
// motorn sen rankar mot vore CIRKULÄR (mäter rörmokeri, inte omdöme). Lösning,
// samma familj som winner-calibration/guardrail-sim: varje sektion får ett
// HEMLIGT sant värde, draget OBEROENDE av sektionstypen; vi simulerar tusentals
// besök som SAMPLAR ur sanningen PLUS brus. Motorn ser bara det brusiga; facit
// är den dolda sanningen. Då mäter eval:en om beteende-rankningen återfinner
// sanningen ur brusigt data — inte tautologiskt.
//
// Steg 6 mäter BASLINJEN (dagens MOVE_TYPE_WEIGHT, som ignorerar beteende).
// Det observerade engagemanget bakas in här redan nu så steg 7:s motor kan
// mätas på EXAKT samma världar; steg 6 konsumerar det bara för "taket"
// (orakel-på-observerat), aldrig för baslinjen.

// Relativ import (inte @/): den här filen körs BÅDE av vitest (tsconfigPaths
// löser @/) OCH av `bun run reco-eval` CLI:t — syskon-eval:erna
// (structure-eval/run.ts, winner-calibration.ts) håller sig till relativa
// importer av exakt det skälet, så vi gör likadant.
import type { RedesignContentModel } from "../../../adaptive/redesign/context";

import { mulberry32, gaussian, shuffle } from "./prng";

// Bevis-sektionstyper med DISTINKTA baslinje-vikter (ingen 2,5-krock mellan
// logos/stats), så baslinjens pick är entydig och positions-tiebreaket aldrig
// flippar ordningen — vi mäter typvikts-priorn rent.
const PROOF_TYPES = ["testimonials", "stats", "proof", "pricing"] as const;

/** Baslinjens egna vikter, DUPLICERADE här ENBART för att räkna priorn vi mäter
 *  mot. Simulatorn får ALDRIG importera motorns rankning — då blir "slår
 *  beteende priorn?" en artefakt av generatorn. Detta är priorn, inte facit. */
const PRIOR_WEIGHT: Record<string, number> = {
  testimonials: 3,
  stats: 2.5,
  proof: 2.2,
  pricing: 1.5,
  // Speglar motorns breddning 2026-08-15 (fortfarande DUPLICERAT med flit —
  // simulatorn får aldrig importera rankningen den mäter).
  comparison: 1.4,
  faq: 1.2,
  features: 1,
};

/** Bruset mellan dold sanning och observerat engagemang. Litet nog att signalen
 *  bär sanningen (taket högt), stort nog att baslinjen inte råkar rätt. */
const NOISE_SD = 0.14;

export interface World {
  seed: number;
  content: RedesignContentModel;
  /** Sidans synliga text — insert-kandidaters ordagrann-check går mot denna. */
  pageText: string;
  /** Sektion-id → hemligt sant värde (facit). Draget oberoende av typ. */
  hiddenValue: Record<string, number>;
  /** Sektion-id → brusigt observerat engagemang (för steg 7; taket i steg 6). */
  observed: Record<string, number>;
  /** Sektionen med högst dold sanning — det rätta lyftet. */
  goldSectionId: string;
  /** Sektionen baslinjens typvikt-prior skulle välja (högst PRIOR_WEIGHT). */
  priorSectionId: string;
  /** Håller priorn med facit i just denna värld? */
  priorAgrees: boolean;
  /** Sektionen världens SEKTIONSBUNDNA trust-rad bor i (extract.ts binder nu
   *  hemvist) — dess ins-kandidat ska bära exakt den sektionens beteende-term. */
  boundSectionId: string;
  /** Den bundna radens ordagranna text (== dess kandidats detail). */
  boundText: string;
  /** "body"-radens text — dess kandidat ska förbli beteende-NEUTRAL. */
  unboundText: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const VERBS = ["convert", "scale", "close", "retain", "grow"];

function argmaxKey(m: Record<string, number>): string {
  let best = "";
  let bestV = -Infinity;
  for (const k of Object.keys(m).sort()) {
    // sorterad nyckelordning → deterministiskt tiebreak
    if (m[k] > bestV) {
      bestV = m[k];
      best = k;
    }
  }
  return best;
}

/** Sektionstyper som INTE är bevis-typer men som finns på varje riktig sida
 *  (features är den vanligaste av alla: 113 av 874 i den frysta korpusen).
 *  Används bara av blandade världar — se makeWorld:s mixedTypes. */
const PLAIN_TYPES = ["features", "faq", "comparison"] as const;

export interface WorldOptions {
  /** Lägg till icke-bevis-sektioner med sanning dragen PÅ SAMMA SÄTT som
   *  bevis-sektionernas (oberoende av typ). Mäter takfrågan flyttregeln
   *  ställer: hur ofta bor sidans BÄSTA sektion utanför det motorn får röra?
   *
   *  Extraherna dras SIST, efter trust-radernas slumptal, så en värld utan
   *  flaggan är byte-identisk med före (steg 6–7-talen är orörda). */
  mixedTypes?: boolean;
}

/** Bygg en reproducerbar syntetisk värld ur ett frö. Ren + deterministisk. */
export function makeWorld(seed: number, opts: WorldOptions = {}): World {
  const rnd = mulberry32(seed);
  const k = 3 + Math.floor(rnd() * 2); // 3 eller 4 bevis-sektioner
  const types = shuffle(PROOF_TYPES, rnd).slice(0, k);

  const proofSections = types.map((type, i) => ({
    id: `sec-${i + 1}-${type}`,
    type,
    position: i + 2, // under en hjälte på position 1
    heading: `${cap(type)} that ${VERBS[i % VERBS.length]}`,
    aboveFold: false,
    visualWeight: 10,
  }));

  // Dold sanning: OBEROENDE av typ (kärnan i icke-cirkulariteten).
  const hiddenValue: Record<string, number> = {};
  const observed: Record<string, number> = {};
  for (const s of proofSections) {
    const truth = rnd(); // 0..1, helt oberoende av s.type
    hiddenValue[s.id] = truth;
    observed[s.id] = clamp01(truth + gaussian(rnd) * NOISE_SD);
  }

  // Trust-rader (steg 7-granskningens fynd: utan dem fanns inga ins-kandidater
  // i världarna och insert-förankringen var omätt). En rad BUNDEN till en
  // slumpad bevis-sektion (extract.ts binder hemvist på riktiga sidor) och en
  // "body"-rad (footer-klassen) som ska förbli neutral. Dras EFTER sannings-
  // dragen så steg 6-talens frö-sekvens är orörd.
  const bound = proofSections[Math.floor(rnd() * k)];
  const boundText = `Trusted by ${1000 + Math.floor(rnd() * 9000)} teams`;
  const unboundText = "30-day money-back guarantee";
  // Blandade världar (flyttregelns takmätning): icke-bevis-sektioner med
  // sanning dragen EXAKT som bevis-sektionernas. Eftersom sanningen är
  // oberoende av typ kan sidans bästa sektion mycket väl vara en av dessa —
  // och då finns den inte ens i menyn med den smala flyttregeln.
  const plainSections = opts.mixedTypes
    ? PLAIN_TYPES.map((type, i) => ({
        id: `sec-${k + i + 1}-${type}`,
        type,
        position: k + i + 2,
        heading: `${cap(type)} that ${VERBS[(k + i) % VERBS.length]}`,
        aboveFold: false,
        visualWeight: 10,
      }))
    : [];
  for (const s of plainSections) {
    const truth = rnd();
    hiddenValue[s.id] = truth;
    observed[s.id] = clamp01(truth + gaussian(rnd) * NOISE_SD);
  }
  const content: RedesignContentModel = {
    sections: [
      {
        id: "sec-0-hero",
        type: "hero",
        position: 1,
        heading: "Build faster with Acme",
        aboveFold: true,
        visualWeight: 40,
      },
      ...proofSections,
      ...plainSections,
    ],
    trustSignals: [
      { type: "trusted_by", text: boundText, aboveFold: false, section: bound.id },
      { type: "guarantee", text: unboundText, aboveFold: false, section: "body" },
    ],
    ctas: [{ text: "Start free", aboveFold: true }],
    hero: { headline: "Build faster with Acme" },
  };

  const pageText =
    content.sections.map((s) => s.heading).join(" \n ") +
    ` \n ${boundText} \n ${unboundText} \n Start free`;

  const goldSectionId = argmaxKey(hiddenValue);
  const priorWeights: Record<string, number> = {};
  for (const s of [...proofSections, ...plainSections])
    priorWeights[s.id] = PRIOR_WEIGHT[s.type] ?? 0;
  const priorSectionId = argmaxKey(priorWeights);

  return {
    seed,
    content,
    pageText,
    hiddenValue,
    observed,
    goldSectionId,
    priorSectionId,
    priorAgrees: goldSectionId === priorSectionId,
    boundSectionId: bound.id,
    boundText,
    unboundText,
  };
}

export { PROOF_TYPES, PRIOR_WEIGHT, NOISE_SD, argmaxKey };
