// Fas 4 — auto-genereringsloopens detektor. PURE.
//
// "Vilka segment har FÖRTJÄNAT en egen design?" Ägarens regel (croengine-vision):
// ett segment analyseras först när volymen bär det (SEGMENT_MIN_VISITS/_CONVERSIONS).
// Detektorn hittar de segmentnycklar där en NY variant skulle göra faktisk nytta:
//
//   1. Kandidat = varje grov→fin-prefix av rollup-löven (aldrig genom 'okänd' —
//      en design "för okänd kanal" är en design för ingen).
//   2. Nyckeln får inte redan ha en egen (icke-pensionerad) variant.
//   3. TOTALEN under nyckeln måste bära analysen (volymgrinden) — insikten byggs
//      på hela gruppen.
//   4. Det INKREMENTELLA måste vara > 0: löv som idag inte täcks av NÅGON
//      variant (varken egen eller grövre). Loopen TÄCKER otäckta besökare —
//      den FÖRFINAR inte segment som redan serveras: att splittra ett redan
//      täckt google·desktop·US i ·ny/·återkommande är vinnar-iterationens jobb
//      (vinnaren blir baseline → nästa varv kör finare), inte detektorns.
//      Annars föreslår varje körning en nästan-identisk ·ny-kopia av varje
//      befintlig variant — 100 förslag utan 100 insikter.
//
// Urvalet är GIRIGT med omräkning: när en nyckel valts räknas de övrigas
// inkrement om som om den redan fanns — så "direct", "direct·desktop" och
// "direct·desktop·SE" (som täcker exakt samma otäckta löv) aldrig blir tre
// förslag. FINASTE adekvata nyckeln med täckningen vinner: variantens
// serveringsomfång ska ligga så tätt mot datan som rättfärdigade den som
// möjligt — en grov "direct"-design byggd på desktop-SE-data ska inte fånga
// framtida direct·mobile·US-besökare. Och stegen ("låna styrka" tills det fina
// förtjänar sig) uppstår av sig själv: ett tunt google·mobile·SE (900 besök)
// täcks av grova "google" — inte av en egen design det inte kan bevisa.
//
// Detektorn FÖRESLÅR bara. Genereringen skriver som mest `verified`; servering
// kräver alltid ägarens knapp (grind 1).

import {
  SEGMENT_MIN_VISITS,
  SEGMENT_MIN_CONVERSIONS,
  SEGMENT_MIN_VISITS_ENGAGEMENT,
  type SegmentLeaf,
} from "@/lib/dashboard/aggregate";

/** Sajtens mätmål (ägarbeslut 2026-07-20): 'conversion' är default; sajter
 *  med sällsynta konverteringar (piloten: ~91 % bounce, 0 organiska konton)
 *  mäter 'continuation' — gick besökaren vidare till en andra sida? Grinden
 *  byter då krav: SEGMENT_MIN_VISITS_ENGAGEMENT besök, inget konverteringskrav
 *  (utfallet finns i varje session). Nordstjärnemålet ändras INTE — designen
 *  siktar fortfarande mot ägarens mål; det är måttstocken för testet som byts.
 *
 *  'bounce' (ägarbeslut 2026-08-15) delar continuations grindkrav av samma
 *  skäl: varje besökare får ett bounce-utfall, så ett konverteringskrav vore
 *  samma kategorifel. Utan den här raden mappade nattloopen bounce → conversion
 *  och cellerna dömdes på 0 konverteringar — detektorn gick tyst tom. */
export type TestMetric = "conversion" | "continuation" | "bounce";
import {
  ANY_TOKEN,
  UNKNOWN_TOKEN,
  isDimsPrefix,
  returningToken,
  segToken,
  segmentDims,
  segmentKeyOf,
} from "@/lib/segment-key";
import { isTemplatePattern, templateMatches, templateOf } from "@/lib/page-template";

// Nyckelsemantiken bor i src/lib/segment-key.ts (task #89) — samma tokenisering
// som rollupen och serve-vägen, per konstruktion i stället för per disciplin.
const leafDims = (l: SegmentLeaf): string[] => [
  segToken(l.channel),
  segToken(l.device),
  segToken(l.country),
  returningToken(l.returning),
];

export interface EarnedSegment {
  /** Segmentnyckeln en ny variant ska genereras för. */
  key: string;
  depth: number;
  /** Hela gruppen under nyckeln — underlaget för analysen/designbriefen. */
  total: { visits: number; conversions: number };
  /** Det varianten faktiskt skulle ta över: löv HELT utan variant idag. */
  incremental: { visits: number; conversions: number };
  /** Lövnycklarna i inkrementet — spårbarhet för evidence/dashboard. */
  uncoveredLeaves: string[];
}

/** En rollup-lövnod med sin sida — det per-sida-detektorn konsumerar
 *  (angel_page_segment_rollup). */
export interface PageSegmentLeaf extends SegmentLeaf {
  path: string;
}

/** Ett förtjänt (sida × segment)-par — cellen en design genereras för. */
export interface EarnedCell extends EarnedSegment {
  path: string;
  /** Mall-celler (path är ett mönster som "/blogg/*"): topp-exemplaren efter
   *  besök inom cellens segmentprefix — frys/verifierings-underlaget. Alltid
   *  ≥2 sidor (en ensam sida är ingen mall). Frånvarande för per-sida-celler. */
  templatePages?: { path: string; visits: number }[];
}

/**
 * Per-SIDA-detektorn: gruppera löven per sida, kör findEarnedSegments per sida
 * mot exakt den sidans befintliga variantnycklar, slå ihop och ranka ÖVER
 * sidorna (inkrementella konverteringar först — en sidas näst bästa segment
 * får inte tränga ut en annan sidas bästa), globalt tak. Ren.
 * `existing` = (path, segmentKey) för sajtens icke-pensionerade varianter.
 */
export function findEarnedCells(
  leaves: PageSegmentLeaf[],
  existing: { path: string; segmentKey: string }[],
  cap = 5,
  metric: TestMetric = "conversion",
): EarnedCell[] {
  const byPath = new Map<string, PageSegmentLeaf[]>();
  for (const leaf of leaves) {
    const path = leaf.path || "/";
    byPath.set(path, [...(byPath.get(path) ?? []), leaf]);
  }
  const cells: EarnedCell[] = [];
  for (const [path, pathLeaves] of byPath) {
    const keys = existing.filter((e) => e.path === path).map((e) => e.segmentKey);
    // Per-sida-capet = globala capet: rankningen över sidor sker efteråt.
    for (const s of findEarnedSegments(pathLeaves, keys, cap, metric)) {
      cells.push({ ...s, path });
    }
  }
  cells.sort(compareCells);
  return cells.slice(0, cap);
}

/** Rankningen över celler — inkrementella konverteringar → besök → finast →
 *  deterministisk. Delad av per-sida- och mall-passet. */
const compareCells = (a: EarnedCell, b: EarnedCell): number =>
  b.incremental.conversions - a.incremental.conversions ||
  b.incremental.visits - a.incremental.visits ||
  b.depth - a.depth ||
  a.path.localeCompare(b.path) ||
  a.key.localeCompare(b.key);

/**
 * Detektorn MED mall-passet (mall-nivå-generering, glutenforum-fyndet
 * 2026-07-26): långsvansade innehållssajter når aldrig per-sida-grinden (bästa
 * sida 34/100 medan mallen bär 85+), så sidor som inte förtjänar en EGEN design
 * grupperas per sidmall (templateOf — "/blogg/*") och körs som en pseudo-sida.
 *
 *  1. Per-sida-passet körs FÖRST, oförändrat — en sida som bär sin egen volym
 *     får sin egen design. Servande MALL-varianter räknas här som täckning för
 *     sina konkreta sidor (annars återföreslås /blogg/x så fort den ensam når
 *     grinden, fast "/blogg/*" redan servar den).
 *  2. Mall-passet: löven för sidor UTAN egen vald cell grupperas per mall.
 *     Samma volymgrind och giriga urval (findEarnedSegments). En mall-cell
 *     kräver ≥2 bidragande sidor i segmentet — en ensam sida är ingen mall —
 *     och bär sina topp-exemplar (templatePages) som frys/verifierings-underlag.
 *  3. Global rankning över båda passen, samma cap.
 *
 * Ren. Genereringen skriver fortfarande som mest `verified` — servering är
 * alltid ägarens knapp, mall eller inte.
 */
export function findEarnedCellsWithTemplates(
  leaves: PageSegmentLeaf[],
  existing: { path: string; segmentKey: string }[],
  cap = 5,
  metric: TestMetric = "conversion",
  exemplarCount = 3,
): EarnedCell[] {
  // Mall-varianter täcker sina konkreta sidor i per-sida-passet.
  const concretePaths = [...new Set(leaves.map((l) => l.path || "/"))];
  const expanded = [
    ...existing,
    ...existing
      .filter((e) => isTemplatePattern(e.path))
      .flatMap((e) =>
        concretePaths
          .filter((p) => templateMatches(e.path, p))
          .map((p) => ({ path: p, segmentKey: e.segmentKey })),
      ),
  ];
  const perPage = findEarnedCells(leaves, expanded, cap, metric);

  const chosenPaths = new Set(perPage.map((c) => c.path));
  const byTemplate = new Map<string, PageSegmentLeaf[]>();
  for (const leaf of leaves) {
    const p = leaf.path || "/";
    if (chosenPaths.has(p)) continue; // sidan fick en egen cell — dubbelräkna inte
    const tpl = templateOf(p);
    if (!tpl) continue; // startsida/listning — egen mall, aldrig grupperad
    byTemplate.set(tpl, [...(byTemplate.get(tpl) ?? []), leaf]);
  }

  const templateCells: EarnedCell[] = [];
  for (const [tpl, tplLeaves] of byTemplate) {
    if (new Set(tplLeaves.map((l) => l.path || "/")).size < 2) continue;
    const keys = existing.filter((e) => e.path === tpl).map((e) => e.segmentKey);
    for (const s of findEarnedSegments(tplLeaves, keys, cap, metric)) {
      // Exemplaren: mallens sidor med flest besök inom cellens segmentprefix —
      // det är de som fryses, får briefen byggd ur sig och pixelverifieras.
      const dims = segmentDims(s.key);
      const perPath = new Map<string, number>();
      for (const l of tplLeaves) {
        if (!isDimsPrefix(dims, leafDims(l))) continue;
        const p = l.path || "/";
        perPath.set(p, (perPath.get(p) ?? 0) + l.visits);
      }
      const pages = [...perPath.entries()]
        .map(([path, visits]) => ({ path, visits }))
        .sort((a, b) => b.visits - a.visits || a.path.localeCompare(b.path))
        .slice(0, exemplarCount);
      if (pages.length < 2) continue; // <2 exemplar i segmentet ⇒ ingen mall-cell
      templateCells.push({ ...s, path: tpl, templatePages: pages });
    }
  }

  return [...perPage, ...templateCells].sort(compareCells).slice(0, cap);
}

/**
 * Segment som förtjänat en egen design, mest värdefulla först
 * (inkrementella konverteringar → inkrementella besök → finast → nyckel).
 * `existingKeys` = segmentnycklar för sajtens+sidans icke-pensionerade varianter.
 */
export function findEarnedSegments(
  leaves: SegmentLeaf[],
  existingKeys: string[],
  cap = 5,
  metric: TestMetric = "conversion",
): EarnedSegment[] {
  const existing = existingKeys.map(segmentDims);
  const leafList = leaves
    .filter((l) => l.visits > 0)
    .map((l) => ({ dims: leafDims(l), visits: l.visits, conversions: l.conversions }));

  // Kandidater: unika prefix utan 'okänd', med totaler.
  const candidates = new Map<string, { dims: string[]; visits: number; conversions: number }>();
  for (const leaf of leafList) {
    for (let d = 1; d <= leaf.dims.length; d++) {
      const dims = leaf.dims.slice(0, d);
      if (dims.includes(UNKNOWN_TOKEN)) break; // djupare prefix bär också 'okänd'
      const key = segmentKeyOf(dims);
      const acc = candidates.get(key) ?? { dims, visits: 0, conversions: 0 };
      acc.visits += leaf.visits;
      acc.conversions += leaf.conversions;
      candidates.set(key, acc);
    }
  }

  // Ett löv är täckt när NÅGON befintlig/vald nyckel matchar det (oavsett djup)
  // — matchVariant hittar alltid den, grov som fin.
  const covered = (leafDims: string[], keys: string[][]): boolean =>
    keys.some((k) => isDimsPrefix(k, leafDims));

  const incrementalOf = (dims: string[], keys: string[][]) => {
    const inc = { visits: 0, conversions: 0, leaves: [] as string[] };
    for (const leaf of leafList) {
      if (!isDimsPrefix(dims, leaf.dims)) continue;
      if (covered(leaf.dims, keys)) continue;
      inc.visits += leaf.visits;
      inc.conversions += leaf.conversions;
      inc.leaves.push(segmentKeyOf(leaf.dims));
    }
    return inc;
  };

  // Grundfilter: inte redan en egen variant + totalen bär analysen.
  // Continuation-läget kräver bara besöksvolym — utfallet ("gick vidare")
  // finns i varje session, så konverteringskravet vore ett kategorifel.
  const adequate = (c: { visits: number; conversions: number }): boolean =>
    metric === "continuation" || metric === "bounce"
      ? c.visits >= SEGMENT_MIN_VISITS_ENGAGEMENT
      : c.visits >= SEGMENT_MIN_VISITS && c.conversions >= SEGMENT_MIN_CONVERSIONS;
  const pool = [...candidates.entries()].filter(
    ([key, c]) => !existingKeys.includes(key) && adequate(c),
  );

  // ── SAJTVITT-KANDIDATEN (ANY-jokern, ägarbeslut 2026-08-16) ────────────────
  // "alla" täcker varje löv — även 'okänd'-kanalens, som inga konkreta prefix
  // någonsin kan täcka. INTRÄDESREGELN är mätkraft, härledd ur riktiga data
  // (glutenforum 2026-08-16): tid-till-domslut skalar ~1/andel av trafiken
  // testet ser, så jokern släpps in när bästa konkreta kandidat bär mindre än
  // 2/3 av den OTÄCKTA trafiken — då är ett sajtvitt test minst 1,5× snabbare
  // än det bästa kanaltestet (startsidan: direct 52 % av 203 ⇒ joker; en
  // bloggsida där google bär 74 % ⇒ kanalcellen behålls, exakt dagens val).
  // Räknat på INKREMENTELL trafik: har sidan redan en google-variant tävlar
  // jokern bara om resten — och servar också bara resten (matchVariant väljer
  // specifikast först). Väl inne vinner jokern greedyn per konstruktion
  // (störst inkrement) och blir sidans ENDA cell — "ETT sajtvitt test i
  // stället för ett per kanal" är hela poängen, inte en bieffekt.
  const ANY_DOMINANCE_SHARE = 2 / 3;
  const anyKey = ANY_TOKEN;
  if (!existingKeys.includes(anyKey)) {
    const anyTotal = leafList.reduce(
      (a, l) => ({ visits: a.visits + l.visits, conversions: a.conversions + l.conversions }),
      { visits: 0, conversions: 0 },
    );
    const anyInc = incrementalOf([ANY_TOKEN], existing);
    const bestConcreteInc = Math.max(
      0,
      ...pool.map(([, c]) => incrementalOf(c.dims, existing).visits),
    );
    if (
      adequate(anyTotal) &&
      anyInc.visits > 0 &&
      bestConcreteInc < ANY_DOMINANCE_SHARE * anyInc.visits
    ) {
      pool.push([anyKey, { dims: [ANY_TOKEN], ...anyTotal }]);
    }
  }

  // Girigt urval med omräkning efter varje val.
  const chosen: EarnedSegment[] = [];
  const coveringKeys = [...existing];
  while (chosen.length < cap) {
    let best: EarnedSegment | null = null;
    for (const [key, c] of pool) {
      if (chosen.some((s) => s.key === key)) continue;
      const inc = incrementalOf(c.dims, coveringKeys);
      if (inc.visits === 0) continue;
      const cand: EarnedSegment = {
        key,
        depth: c.dims.length,
        total: { visits: c.visits, conversions: c.conversions },
        incremental: { visits: inc.visits, conversions: inc.conversions },
        uncoveredLeaves: inc.leaves.sort(),
      };
      if (
        !best ||
        cand.incremental.conversions > best.incremental.conversions ||
        (cand.incremental.conversions === best.incremental.conversions &&
          (cand.incremental.visits > best.incremental.visits ||
            (cand.incremental.visits === best.incremental.visits &&
              (cand.depth > best.depth || (cand.depth === best.depth && cand.key < best.key)))))
      ) {
        best = cand;
      }
    }
    if (!best) break;
    chosen.push(best);
    coveringKeys.push(segmentDims(best.key));
  }
  return chosen;
}
