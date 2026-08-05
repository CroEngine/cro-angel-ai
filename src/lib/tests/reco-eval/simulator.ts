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
// Steg 6 mäter BASLINJEN (dagens PROOF_TYPE_WEIGHT, som ignorerar beteende).
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

/** Bygg en reproducerbar syntetisk värld ur ett frö. Ren + deterministisk. */
export function makeWorld(seed: number): World {
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
    ],
    trustSignals: [],
    ctas: [{ text: "Start free", aboveFold: true }],
    hero: { headline: "Build faster with Acme" },
  };

  const pageText = content.sections.map((s) => s.heading).join(" \n ") + " Start free";

  // Dold sanning: OBEROENDE av typ (kärnan i icke-cirkulariteten).
  const hiddenValue: Record<string, number> = {};
  const observed: Record<string, number> = {};
  for (const s of proofSections) {
    const truth = rnd(); // 0..1, helt oberoende av s.type
    hiddenValue[s.id] = truth;
    observed[s.id] = clamp01(truth + gaussian(rnd) * NOISE_SD);
  }

  const goldSectionId = argmaxKey(hiddenValue);
  const priorWeights: Record<string, number> = {};
  for (const s of proofSections) priorWeights[s.id] = PRIOR_WEIGHT[s.type] ?? 0;
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
  };
}

export { PROOF_TYPES, PRIOR_WEIGHT, NOISE_SD, argmaxKey };
