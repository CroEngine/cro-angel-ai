// Steg 10 (CRO-planen): section_engagement-events → rollupens observationer.
//
// Snippeten (steg 9) skickar EN händelse per sidladdning:
//   {sections: [{h: rubrik≤120, n: instansantal, d: sedd-ms}], path}
// Rollupen (steg 8) vill ha per-sektion-aggregat över MÅNGA laddningar:
//   SectionObservation {heading, visits, engagement, instances?}
//
// Aggregeringen här är bryggan — REN och deterministisk (CI-grindbar utan
// databas): per normaliserad rubriknyckel räknas hur många sidladdningar som
// BAR sektionen (visits) och hur stor andel av dem som SÅG den (d ≥ tröskeln
// = ett engagerat besök). Engagemang är alltså en ANDEL i [0,1] — exakt
// sätets kontrakt — aldrig en råtid som skulle skeva mot långsamma läsare.
//
// Instansfältet: max n över laddningarna — ändrar sidan mellan laddningar och
// rubriken NÅGON gång varit dubblerad dömer rollupen den FLERTYDIG (aldrig
// kreditera hellre än gissa; drift mellan laddningar är just osäkerhet).

import { normHeadingKey } from "./section-join";

import type { SectionObservation } from "./engagement-rollup";

/** En laddnings sections-payload, som den lagras i angel_events (efter
 *  buildEventRows sanering: h≤120 skrubbad, n 1–9, d 0–600000). */
export interface SectionEngagementPayload {
  sections?: { h?: unknown; n?: unknown; d?: unknown }[];
  /** Arm-markören (2026-08-08): 1 = laddningen bar en tillämpad variant, 0 =
   *  orörd sida. Läsvägen stängslar på den så sätet aldrig mäter vår EGEN
   *  omflyttning som "besökarnas beteende". Saknas fältet är eventet äldre än
   *  markören — då gäller det trubbigare decisionId-stängslet. */
  adapted?: unknown;
}

/** Sedd-tröskeln: så länge måste rubriken ha varit synlig (≥50 %) för att
 *  laddningen ska räknas som ett ENGAGERAT besök för sektionen. 1 s skiljer
 *  förbi-scroll från faktisk titt utan att straffa snabbläsare. */
export const ENGAGED_MS = 1000;

/** Aggregera råa section_engagement-payloads till rollupens observationer.
 *  Ren funktion: trasiga poster släpps tyst (servern har redan sanerat —
 *  detta är bältet till hängslena), rubriknyckeln är den delade
 *  normaliseringen (samma som joinen krediterar genom). */
export function aggregateSectionObservations(
  payloads: SectionEngagementPayload[],
  engagedMs = ENGAGED_MS,
): SectionObservation[] {
  const byKey = new Map<
    string,
    { heading: string; visits: number; engaged: number; instances: number }
  >();
  for (const p of payloads) {
    if (!p || !Array.isArray(p.sections)) continue;
    // En sektion räknas EN gång per laddning även om payloaden (mot förmodan)
    // bär samma rubrik två gånger — dubblettinstanser är n-fältets sak.
    const seenThisLoad = new Set<string>();
    for (const s of p.sections) {
      if (!s || typeof s.h !== "string") continue;
      const key = normHeadingKey(s.h);
      if (!key || seenThisLoad.has(key)) continue;
      seenThisLoad.add(key);
      const d = typeof s.d === "number" && Number.isFinite(s.d) ? s.d : 0;
      const n = typeof s.n === "number" && Number.isFinite(s.n) ? Math.floor(s.n) : 1;
      const acc = byKey.get(key) ?? { heading: s.h, visits: 0, engaged: 0, instances: 1 };
      acc.visits += 1;
      if (d >= engagedMs) acc.engaged += 1;
      acc.instances = Math.max(acc.instances, Math.max(1, n));
      byKey.set(key, acc);
    }
  }
  const out: SectionObservation[] = [];
  for (const acc of byKey.values()) {
    out.push({
      heading: acc.heading,
      visits: acc.visits,
      engagement: acc.visits > 0 ? acc.engaged / acc.visits : 0,
      instances: acc.instances,
    });
  }
  // Deterministisk ordning (flest besök först, sedan rubrik) — stabil för
  // loggar, tester och menyrader.
  return out.sort(
    (a, b) => b.visits - a.visits || a.heading.localeCompare(b.heading, "sv"),
  );
}
