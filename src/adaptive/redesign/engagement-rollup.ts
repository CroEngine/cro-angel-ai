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

import { NON_CONTENT_SECTION_TYPES, claimJoins, normHeadingKey } from "./section-join";

/** En runtime-observation för EN census-sektion (steg 9:s event-aggregat):
 *  rubriknyckeln censusen såg, hur många besök som exponerades för sektionen
 *  och andelen av dem som engagerade sig (blend-frågan — dwell/scroll/klick —
 *  ägs av event-sidan; rollupen tar en färdig andel). */
export interface SectionObservation {
  heading: string;
  visits: number;
  /** Engagemangsandel i [0,1] av sektionens exponerade besök. */
  engagement: number;
  /** Censusens sektionstyp när avsändaren vet den. Icke-innehåll (nav/header/
   *  footer/aside) SLÄPPS — eval:en (steg 5) exkluderade dem ur joinen, och
   *  utan filtret kunde en footer-rubrik sno kredit (granskningsfynd
   *  2026-08-05). Utelämnad typ = innehåll (A3-censusen förfiltrerar redan
   *  via closest("header,nav,footer,aside")). */
  type?: string;
  /** Antal census-INSTANSER bakom nyckeln på sidan (avsändaren ser censusen).
   *  > 1 ⇒ äkta dubblettrubriker ⇒ krediteras ALDRIG (samma dom som eval:ens
   *  FLERTYDIG — granskningsfynd 2026-08-05: poolningen dolde annars
   *  instansstrukturen och krediterade det eval:en mätte som miss).
   *  Utelämnad = 1. */
  instances?: number;
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
  /** Besök i bortsläppta icke-innehålls-observationer (nav/footer-klassen) —
   *  utanför ALLA nämnare (eval:ens semantik), men aldrig osynliga. */
  droppedNonContentVisits: number;
  /** Besök vars rubrik normaliserar till tomt — okrediterbara per definition,
   *  räknas i miss-massan men kan inte listas per rubrik (diagnostik-fyndet). */
  headinglessVisits: number;
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

  const valid = observations.filter(
    (o) => Number.isFinite(o.visits) && o.visits > 0 && Number.isFinite(o.engagement),
  );
  // Icke-innehålls-observationer (nav/header/footer/aside) SLÄPPS före alla
  // nämnare — samma dom som eval:ens innehållsfilter. De är inte "miss"
  // (inget engagemang att förlora), de är utanför mätningen — men synliga i
  // diagnostiken så en fel-taggande avsändare inte försvinner tyst.
  const droppedNonContentVisits = valid
    .filter((o) => o.type !== undefined && NON_CONTENT_SECTION_TYPES.has(o.type))
    .reduce((a, o) => a + o.visits, 0);
  const clean = valid.filter(
    (o) => o.type === undefined || !NON_CONTENT_SECTION_TYPES.has(o.type),
  );
  const totalVisits = clean.reduce((a, o) => a + o.visits, 0);
  // NOLL-VAKTEN FÖRE ALLT (granskningsfynd 2026-08-05): med minVisits: 0 (eller
  // negativt) släppte tunn-grinden igenom totalVisits === 0 och massorna blev
  // 0/0 = NaN — och `NaN > maxMiss` är false, så miss-grinden kringgicks TYST.
  // Inga observationer är aldrig ett svar, oavsett hur trösklarna ställs.
  if (totalVisits <= 0) return null;
  if (totalVisits < minVisits) return null; // tunn data — ingen fantomvikt

  // AGGREGERA PER NYCKEL FÖRST: event-strömmen är rubriknyckel-keyad, så
  // flera observationer med samma normaliserade nyckel (mobil/desktop- eller
  // dagsbuckets) är SAMMA logiska sektion — besöksviktat medel, aldrig
  // dubblettinstanser in i joinen (två lika nycklar hade dömts FLERTYDIG som
  // om sidan bar två sektioner). ÄKTA samma-rubrik-dubbletter på EN sida är
  // en annan sak: avsändaren ser censusen och rapporterar `instances`; > 1 ⇒
  // nyckeln krediteras aldrig (eval:ens FLERTYDIG-dom — granskningsfix
  // 2026-08-05: poolningen dolde annars instansstrukturen).
  const byKey = new Map<
    string,
    { heading: string; visits: number; engagedVisits: number; maxInstances: number }
  >();
  let headinglessVisits = 0;
  for (const o of clean) {
    const key = normHeadingKey(o.heading);
    if (!key) {
      headinglessVisits += o.visits;
      continue;
    }
    const acc =
      byKey.get(key) ?? { heading: o.heading, visits: 0, engagedVisits: 0, maxInstances: 1 };
    acc.visits += o.visits;
    acc.engagedVisits += o.visits * clamp01(o.engagement);
    acc.maxInstances = Math.max(acc.maxInstances, Math.floor(o.instances ?? 1));
    byKey.set(key, acc);
  }
  // Upplösningen: modellsektioner → census-nycklar genom den delade regeln.
  // Dubblettinstans-nycklar går in som TVÅ instanser i join-listan så
  // claimJoins själv dömer FLERTYDIG — exakt samma dom (och samma påverkan på
  // ANDRA sektioners prefix-upplösning) som eval:ens instans-lista gav.
  const joinHeadings: string[] = [];
  for (const agg of byKey.values()) {
    joinHeadings.push(agg.heading);
    if (agg.maxInstances > 1) joinHeadings.push(agg.heading);
  }
  const { claimedBy } = claimJoins(sections, joinHeadings);

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

  return {
    sectionWeight,
    totalVisits,
    attributedMass,
    joinMissMass,
    unattributed,
    droppedNonContentVisits,
    headinglessVisits,
  };
}
