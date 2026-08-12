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
// CENSUSTROHET (granskningsfynd 2026-08-12): payloads byggs från snippetens
// eget urval över den frysta DOM:en (censusEntriesFromHtml nedan) — INTE från
// innehållsmodellens sektioner. Modellen dedupar rubrikdubbletter och bär
// herons h1; censusen ser h2:or (dolda kopior inräknade i n) och tak 24.
// Att simulera från modellen kringgick FLERTYDIG-vakten och matade sätet
// med hero-vikter som riktig trafik strukturellt aldrig kan producera.
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
import { normHeadingKey } from "../../src/adaptive/redesign/section-join";
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

export type FakeTrafficSkip = "no-movable-target" | "gold-unobservable" | "rollup-null";

/** Stabilt heltalsfrö ur ett sajtnamn (FNV-1a) + basfrö. */
export function seedForSite(name: string, seedBase = 1): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) + seedBase * 7919) >>> 0;
}

/** En census-post: rubriktexten som snippeten skickar (squashad, trimmad,
 *  120-klippt) + instansantalet n över HELA det filtrerade urvalet. */
export interface CensusEntry {
  h: string;
  n: number;
}

/** Snippetens payload-budgettak (public/adaptive.js SECTION_CAP) — speglas
 *  här; observers bortom taket kopplas aldrig i produktion. */
export const CENSUS_SECTION_CAP = 24;

/** Minimal entity-avkodning för rubriktext (samma klass av tecken som
 *  extract hanterar; harnessen behöver bara de vanliga). */
const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, " ");

/** Snippetens censusurval, statiskt över den FRYSTA sidans markup (speglar
 *  public/adaptive.js wireSectionCensus): h2 inom <main> (annars body/hela
 *  dokumentet), minus header/nav/footer/aside-REGIONER, i dokumentordning.
 *  Text som snippeten: squash → trim → slice(120). n räknas per gemener-
 *  nyckel över HELA urvalet FÖRE taket (dolda responsiva kopior räknas —
 *  querySelectorAll ser dem, precis som produktionens instansräkning).
 *  Beroendefri parser i extract.ts anda: region-strippningen är strukturell
 *  approximation (icke-girig till första sluttaggen), inte en riktig DOM. */
export function censusEntriesFromHtml(html: string): CensusEntry[] {
  const mainM = /<main[\s>][\s\S]*?<\/main>/i.exec(html);
  let scope = mainM ? mainM[0] : (/<body[\s>][\s\S]*<\/body>/i.exec(html)?.[0] ?? html);
  for (const t of ["header", "nav", "footer", "aside"]) {
    scope = scope.replace(new RegExp(`<${t}[\\s>][\\s\\S]*?</${t}>`, "gi"), "");
  }
  const texts: string[] = [];
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope))) {
    const t = decodeEntities(m[1].replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    if (t) texts.push(t);
  }
  const counts = new Map<string, number>();
  for (const t of texts) {
    const k = t.toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return texts.slice(0, CENSUS_SECTION_CAP).map((h) => ({ h, n: counts.get(h.toLowerCase())! }));
}

/** Bygg census-laddningarna: varje laddning bär ALLA census-poster (som
 *  riktiga censusen — observern rapporterar d=0-poster också), dwell ≥1s med
 *  postens sannolikhet. adapted: 0 — orörda laddningar, arm-stängslets
 *  kontrakt. Exporterad så testet kan pinna payload-formen direkt (det gamla
 *  "kontraktstestet" mätte bara loads — aggregeringen läser aldrig adapted,
 *  stängslet bor i DB-läsvägen som simuleringen förbigår). */
export function buildCensusPayloads(
  census: CensusEntry[],
  dwellProb: (e: CensusEntry) => number,
  loads: number,
  rnd: () => number,
): SectionEngagementPayload[] {
  const out: SectionEngagementPayload[] = [];
  for (let i = 0; i < loads; i++) {
    out.push({
      adapted: 0,
      sections: census.map((e) => ({ h: e.h, n: e.n, d: rnd() < dwellProb(e) ? 1500 : 200 })),
    });
  }
  return out;
}

/** Syntetisera fejktrafik för EN sida. null + orsak när sidan inte kan bära
 *  testet: inget flyttbart bevismål i katalogen, inget mål censusen kan MÄTA
 *  (rubriken saknas bland de 24 kopplade h2:orna, eller är dubblerad i DOM —
 *  FLERTYDIG krediteras aldrig), eller rollupen sa ärligt nej. */
export function fakeTrafficForPage(
  content: RedesignContentModel,
  frozenHtml: string,
  seed: number,
  loads = 1200,
): { plan: FakeTrafficPlan | null; skip: FakeTrafficSkip | null } {
  const rnd = mulberry32(seed);
  const census = censusEntriesFromHtml(frozenHtml);

  // Guldet väljs bland KATALOGENS egna flyttmål — samma definition av
  // "flyttbar" som motorn använder (aldrig en parallell regel som kan
  // drifta). Seedat val bland målen ger variation över flottan.
  const movable = generateCandidates(content)
    .filter((c) => c.kind === "move_up")
    .map((c) => c.targetId);
  if (movable.length === 0) return { plan: null, skip: "no-movable-target" };

  // Observerbarhetsgrinden: facit måste vara en sektion produktionskedjan
  // KAN kreditera — modellrubriken matchar exakt EN census-post inom taket,
  // och den posten är instans-ren (n=1). Ett omätbart guld hade räknat en
  // strukturell blindhet som motor-miss.
  const byKey = new Map<string, CensusEntry[]>();
  for (const e of census) {
    const k = normHeadingKey(e.h);
    const arr = byKey.get(k) ?? [];
    arr.push(e);
    byKey.set(k, arr);
  }
  const observable = movable.filter((id) => {
    const sec = content.sections.find((s) => s.id === id);
    const key = normHeadingKey(sec?.heading ?? "");
    if (!key) return false;
    const hits = byKey.get(key) ?? [];
    return hits.length === 1 && hits[0].n === 1;
  });
  if (observable.length === 0) return { plan: null, skip: "gold-unobservable" };
  const goldSectionId = observable[Math.floor(rnd() * observable.length)];
  const gold = content.sections.find((s) => s.id === goldSectionId)!;

  // Dold sanning: guldet hett (0,75–0,90), resten svalt (0,08–0,38) —
  // marginalen är stor nog att signalen bär genom binomialbruset vid 1200
  // laddningar, liten nog att inget är "gratis" (rollupens golv och sätets
  // krympning verkar fortfarande). Sanning dras för ALLA modellsektioner
  // (stabil rnd-ström) — census-poster utan modellmatch får egen sval
  // bakgrundssanning nedan (riktigt sidinnehåll besökaren också ser).
  const truth: Record<string, number> = {};
  for (const s of content.sections) {
    truth[s.id] = s.id === goldSectionId ? 0.75 + rnd() * 0.15 : 0.08 + rnd() * 0.3;
  }
  const sectionByKey = new Map<string, { id: string }[]>();
  for (const s of content.sections) {
    const k = normHeadingKey(s.heading ?? "");
    if (!k) continue;
    const arr = sectionByKey.get(k) ?? [];
    arr.push({ id: s.id });
    sectionByKey.set(k, arr);
  }
  const backgroundTruth = new Map<string, number>();
  for (const e of census) {
    const k = normHeadingKey(e.h);
    if ((sectionByKey.get(k) ?? []).length !== 1 && !backgroundTruth.has(k)) {
      backgroundTruth.set(k, 0.08 + rnd() * 0.3);
    }
  }
  const dwellProb = (e: CensusEntry): number => {
    const k = normHeadingKey(e.h);
    const secs = sectionByKey.get(k) ?? [];
    return secs.length === 1 ? truth[secs[0].id] : (backgroundTruth.get(k) ?? 0.2);
  };

  const payloads = buildCensusPayloads(census, dwellProb, loads, rnd);
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
