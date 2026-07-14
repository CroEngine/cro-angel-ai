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
  type SegmentLeaf,
} from "@/lib/dashboard/aggregate";

/** Samma tokenisering som rollupen (aggregate.ts segToken) och serve.ts — en
 *  nyckel, tre platser, medvetet identisk. */
const token = (v: string | null | undefined): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || "okänd";
};

const leafDims = (l: SegmentLeaf): string[] => [
  token(l.channel),
  token(l.device),
  token(l.country),
  l.returning ? "återkommande" : "ny",
];

const isPrefix = (prefix: string[], full: string[]): boolean =>
  prefix.length <= full.length && prefix.every((t, i) => t === full[i]);

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
    for (const s of findEarnedSegments(pathLeaves, keys, cap)) {
      cells.push({ ...s, path });
    }
  }
  cells.sort(
    (a, b) =>
      b.incremental.conversions - a.incremental.conversions ||
      b.incremental.visits - a.incremental.visits ||
      b.depth - a.depth ||
      a.path.localeCompare(b.path) ||
      a.key.localeCompare(b.key),
  );
  return cells.slice(0, cap);
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
): EarnedSegment[] {
  const existing = existingKeys.map((k) => k.split("·"));
  const leafList = leaves
    .filter((l) => l.visits > 0)
    .map((l) => ({ dims: leafDims(l), visits: l.visits, conversions: l.conversions }));

  // Kandidater: unika prefix utan 'okänd', med totaler.
  const candidates = new Map<string, { dims: string[]; visits: number; conversions: number }>();
  for (const leaf of leafList) {
    for (let d = 1; d <= leaf.dims.length; d++) {
      const dims = leaf.dims.slice(0, d);
      if (dims.includes("okänd")) break; // djupare prefix bär också 'okänd'
      const key = dims.join("·");
      const acc = candidates.get(key) ?? { dims, visits: 0, conversions: 0 };
      acc.visits += leaf.visits;
      acc.conversions += leaf.conversions;
      candidates.set(key, acc);
    }
  }

  // Ett löv är täckt när NÅGON befintlig/vald nyckel matchar det (oavsett djup)
  // — matchVariant hittar alltid den, grov som fin.
  const covered = (leafDims: string[], keys: string[][]): boolean =>
    keys.some((k) => isPrefix(k, leafDims));

  const incrementalOf = (dims: string[], keys: string[][]) => {
    const inc = { visits: 0, conversions: 0, leaves: [] as string[] };
    for (const leaf of leafList) {
      if (!isPrefix(dims, leaf.dims)) continue;
      if (covered(leaf.dims, keys)) continue;
      inc.visits += leaf.visits;
      inc.conversions += leaf.conversions;
      inc.leaves.push(leaf.dims.join("·"));
    }
    return inc;
  };

  // Grundfilter: inte redan en egen variant + totalen bär analysen.
  const pool = [...candidates.entries()].filter(
    ([key, c]) =>
      !existingKeys.includes(key) &&
      c.visits >= SEGMENT_MIN_VISITS &&
      c.conversions >= SEGMENT_MIN_CONVERSIONS,
  );

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
              (cand.depth > best.depth ||
                (cand.depth === best.depth && cand.key < best.key)))))
      ) {
        best = cand;
      }
    }
    if (!best) break;
    chosen.push(best);
    coveringKeys.push(best.key.split("·"));
  }
  return chosen;
}
