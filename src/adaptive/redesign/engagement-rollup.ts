// Engagemangs-rollupen (steg 8, D3): datamotsvarigheten till PROOF_TYPE_WEIGHT.
// Tar råa per-sektion-observationer från runtime (steg 9: census-rubriknyckel +
// besök + engagemangsandel) och löser upp dem till beteende-sätets nycklar
// (BehaviorInput.sectionWeight, keyade på extract.ts "sec-N-typ"-id:n) — via
// EXAKT samma join-regel som offline-eval:en mäter (section-join.ts).
//
// ÄRLIGHETEN ÄR RETURVÄRDET: rollupen svarar hellre null än gissar.
//   • TUNN DATA ⇒ null. Under MIN_VISITS totala besök är andelarna brus —
//     ingen fantomvikt (planens rekommendation: konservativt ~tusen besök).
//   • HÖG JOIN-MISS ⇒ null. Kan inte tillräckligt av det OBSERVERADE
//     engagemanget (besöksviktat) krediteras en unik sektion är bilden skev —
//     en delbild hade systematiskt gynnat sektioner med snälla rubriker.
//     Steg 5 mätte missklassen (rubriker censusen aldrig ser): grinden står
//     på attribuerad MASSA, inte rubrikantal, så list-brus inte fäller sidor
//     vars riktiga sektioner joinar rent.
// null ⇒ anroparen matar INTE sätet ⇒ katalogen är byte-identisk med dagens
// (bevisat i candidates.test.ts) — beteende av eller på är aldrig halvvägs.
//
// Utdatavikterna är per-sektion-engagemangsANDELAR i [0,1] (sätets kontrakt),
// ALDRIG max-normaliserade: min-max hade blåst upp brus-skillnader till full
// skala (steg 6-fyndet); sätets gain äger skalningen.

import { claimJoins, normHeadingKey } from "./section-join";

/** En runtime-observation för EN census-sektion (steg 9:s event-aggregat):
 *  rubriknyckeln censusen såg, hur många besök som exponerades för sektionen
 *  och andelen av dem som engagerade sig (blend-frågan — dwell/scroll/klick —
 *  ägs av event-sidan; rollupen tar en färdig andel). */
export interface SectionObservation {
  heading: string;
  visits: number;
  /** Engagemangsandel i [0,1] av sektionens exponerade besök. */
  engagement: number;
}

export interface RollupOptions {
  /** Golv för totala besök över observationerna — under det är andelar brus. */
  minVisits?: number;
  /** Tak för besöksviktad OKREDITERBAR massa (0..1). Över det ⇒ null. */
  maxJoinMissMass?: number;
}

/** Konservativa default (planens öppna beslut #2: "~tusen besök,
 *  volym-viktad"). Steg 10 kan kalibrera mot riktiga sidor — konstanterna är
 *  medvetet synliga här, inte begravda i anropare. */
export const MIN_VISITS = 1000;
/** Minst halva den observerade massan måste vara krediterbar. Steg 5 mätte
 *  ~65 % krediterbara RUBRIKER på 28 sajter; massan (besöksviktad) väntas
 *  högre eftersom missklassen domineras av list-/svansrubriker — men tills
 *  steg 9 mäter riktig massa är 0,5 ett golv med marginal åt bägge håll. */
export const MAX_JOIN_MISS_MASS = 0.5;

export interface EngagementRollup {
  /** Sätets input: sektions-id → engagemangsandel [0,1]. Bara UNIKT joinade
   *  sektioner får poster — saknad post = neutral i sätet (priorn ensam). */
  sectionWeight: Record<string, number>;
  totalVisits: number;
  /** Andel av besöksmassan som kunde krediteras en unik sektion. */
  attributedMass: number;
  joinMissMass: number;
  /** Observationer (rubriker) som inte kunde krediteras — diagnostik. */
  unattributed: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Rulla upp runtime-observationer till beteende-sätets vikter — eller null
 *  när datan inte bär (tunn eller för stor okrediterbar massa). Ren funktion:
 *  samma modell + observationer ⇒ samma svar, facit-testbar utan chromium. */
export function rollupEngagement(
  sections: { id: string; type: string; heading: string }[],
  observations: SectionObservation[],
  opts: RollupOptions = {},
): EngagementRollup | null {
  const minVisits = opts.minVisits ?? MIN_VISITS;
  const maxMiss = opts.maxJoinMissMass ?? MAX_JOIN_MISS_MASS;

  const clean = observations.filter(
    (o) => Number.isFinite(o.visits) && o.visits > 0 && Number.isFinite(o.engagement),
  );
  const totalVisits = clean.reduce((a, o) => a + o.visits, 0);
  if (totalVisits < minVisits) return null; // tunn data — ingen fantomvikt

  // AGGREGERA PER NYCKEL FÖRST: event-strömmen är rubriknyckel-keyad, så
  // flera observationer med samma normaliserade nyckel (mobil/desktop- eller
  // dagsbuckets) är SAMMA logiska sektion — besöksviktat medel, aldrig
  // dubblettinstanser in i joinen (två lika nycklar hade dömts FLERTYDIG som
  // om sidan bar två sektioner). Äkta samma-rubrik-dubbletter på EN sida
  // poolas också hit — och extract.ts dedupar dem till ETT sektions-id med
  // samma första-förekomst-semantik, så krediteringen förblir id-konsistent.
  const byKey = new Map<string, { heading: string; visits: number; engagedVisits: number }>();
  for (const o of clean) {
    const key = normHeadingKey(o.heading);
    if (!key) continue;
    const acc = byKey.get(key) ?? { heading: o.heading, visits: 0, engagedVisits: 0 };
    acc.visits += o.visits;
    acc.engagedVisits += o.visits * clamp01(o.engagement);
    byKey.set(key, acc);
  }

  // Upplösningen: modellsektioner → unika census-nycklar (delade regeln).
  const { claimedBy } = claimJoins(
    sections,
    [...byKey.values()].map((k) => k.heading),
  );

  // Kreditera varje nyckel till sin ÄGANDE sektion (injektivt).
  const perSection = new Map<string, { visits: number; engagedVisits: number }>();
  let attributedVisits = 0;
  const unattributed: string[] = [];
  for (const [key, agg] of byKey) {
    const aId = claimedBy.get(key);
    if (!aId) {
      unattributed.push(agg.heading);
      continue;
    }
    attributedVisits += agg.visits;
    const acc = perSection.get(aId) ?? { visits: 0, engagedVisits: 0 };
    acc.visits += agg.visits;
    acc.engagedVisits += agg.engagedVisits;
    perSection.set(aId, acc);
  }

  const attributedMass = attributedVisits / totalVisits;
  const joinMissMass = 1 - attributedMass;
  if (joinMissMass > maxMiss) return null; // skev delbild — hellre inget

  const sectionWeight: Record<string, number> = {};
  for (const [aId, acc] of perSection)
    sectionWeight[aId] = acc.visits > 0 ? clamp01(acc.engagedVisits / acc.visits) : 0;

  return { sectionWeight, totalVisits, attributedMass, joinMissMass, unattributed };
}
