// Fejktrafiken för fullskaletestet (ägarbeslut 2026-08-12: "lossas att dem
// installerar snippet, sen ge fake trafik — så analyserar vi och sen flyttar
// vi runt"). Per FRYST RIKTIG sida väljs en DOLD SANNING — en flyttbar
// bevis-sektion under folden som besökarna "älskar" — och ~1200 census-
// laddningar syntetiseras i EXAKT den payload-form snippeten skickar
// ({sections: [{h, n, d}]}). Kedjan som testas är produktionens, orörd:
//
//   payloads → aggregateSectionObservations → rollupEngagement →
//   BehaviorInput → generateCandidates → DOM-probe → golv/väljare → verify
//
// Sanningen är DOLD för kedjan (bara dwell-mönstret syns) — analysen mäter
// om flytten som föreslås är sektionen sanningen pekade ut (behaviour-
// follow), aldrig tautologiskt. Deterministiskt per (sida, frö): samma
// körning ⇒ samma sanning ⇒ samma facit.
//
// ALDRIG nära produktion: modulen skriver ingenting — den bygger ett
// BehaviorInput i minnet som flottrunnern matar buildCandidatePlan med.

import {
  aggregateSectionObservations,
  type SectionEngagementPayload,
} from "../../src/adaptive/redesign/section-events";
import { rollupEngagement } from "../../src/adaptive/redesign/engagement-rollup";
import { generateCandidates, type BehaviorInput } from "../../src/adaptive/redesign/candidates";
import type { RedesignContentModel } from "../../src/adaptive/redesign/context";
import { mulberry32 } from "../sim-rng";

export interface FakeTrafficPlan {
  /** Sektionen den dolda sanningen pekar ut — facit för behaviour-follow. */
  goldSectionId: string;
  goldHeading: string;
  /** Dold sanning per sektions-id (engagemangssannolikhet) — rapporten. */
  truth: Record<string, number>;
  /** Antal syntetiserade laddningar. */
  loads: number;
  /** Sätets input, byggd genom produktionens aggregering + rollup. */
  behavior: BehaviorInput;
}

export type FakeTrafficSkip = "no-movable-target" | "rollup-null";

/** Stabilt heltalsfrö ur ett sajtnamn (FNV-1a) + basfrö. */
export function seedForSite(name: string, seedBase = 1): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) + seedBase * 7919) >>> 0;
}

/** Syntetisera fejktrafik för EN sida. null + orsak när sidan inte kan bära
 *  testet (ingen flyttbar bevis-sektion, eller rollupen sa ärligt nej). */
export function fakeTrafficForPage(
  content: RedesignContentModel,
  seed: number,
  loads = 1200,
): { plan: FakeTrafficPlan | null; skip: FakeTrafficSkip | null } {
  const rnd = mulberry32(seed);

  // Guldet väljs bland KATALOGENS egna flyttmål — samma definition av
  // "flyttbar" som motorn använder (aldrig en parallell regel som kan
  // drifta). Seedat val bland målen ger variation över flottan.
  const movable = generateCandidates(content)
    .filter((c) => c.kind === "move_up")
    .map((c) => c.targetId);
  if (movable.length === 0) return { plan: null, skip: "no-movable-target" };
  const goldSectionId = movable[Math.floor(rnd() * movable.length)];
  const gold = content.sections.find((s) => s.id === goldSectionId)!;

  // Dold sanning: guldet hett (0,75–0,90), resten svalt (0,08–0,38) —
  // marginalen är stor nog att signalen bär genom binomialbruset vid 1200
  // laddningar, liten nog att inget är "gratis" (rollupens golv och sätets
  // krympning verkar fortfarande).
  const truth: Record<string, number> = {};
  for (const s of content.sections) {
    truth[s.id] = s.id === goldSectionId ? 0.75 + rnd() * 0.15 : 0.08 + rnd() * 0.3;
  }

  // Census-laddningarna: varje laddning bär ALLA rubriksatta sektioner (som
  // riktiga censusen), dwell ≥1s med sanningens sannolikhet. adapted: 0 —
  // orörda laddningar, precis som arm-stängslet kräver.
  const payloads: SectionEngagementPayload[] = [];
  for (let i = 0; i < loads; i++) {
    payloads.push({
      adapted: 0,
      sections: content.sections
        .filter((s) => !!s.heading)
        .map((s) => ({ h: s.heading!, n: 1, d: rnd() < truth[s.id] ? 1500 : 200 })),
    });
  }

  const observations = aggregateSectionObservations(payloads);
  const rollup = rollupEngagement(
    content.sections.map((s) => ({ id: s.id, type: s.type, heading: s.heading ?? "" })),
    observations,
  );
  if (!rollup) return { plan: null, skip: "rollup-null" };

  return {
    plan: {
      goldSectionId,
      goldHeading: gold.heading ?? "",
      truth,
      loads,
      behavior: { sectionWeight: rollup.sectionWeight, sectionVisits: rollup.sectionVisits },
    },
    skip: null,
  };
}
