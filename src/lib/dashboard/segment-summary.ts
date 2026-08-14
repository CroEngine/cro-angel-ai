// EN härledning segmentnyckel + tally → SegmentSummary — underlaget
// designbriefen byggs av.
//
// VARFÖR EN MODUL (städsvepet 2026-08-14): exakt samma 14 fält härleddes på
// två ställen — nattloopens inline-objekt och auto-generates summaryFor — och
// bägge matar samma konsument (segmentInsightFrom → designerns brief). En
// drift mellan dem hade betytt att modellen får veta olika saker om en cell
// beroende på vilken väg cellen kom in, vilket är precis den sortens skillnad
// ingen märker förrän förslagen blir oförklarligt olika.
//
// Löv-modul med avsikt: TYPEN importeras (erased) och värdena kommer ur
// segment-key. Att lägga funktionen i aggregate.ts hade gett nattloopen ett
// nytt RUNTIME-beroende på ett 1766-raders träd (sanitize, candidates,
// engagement-rollup, section-events) för en fältmappning.

import { RETURNING_TOKEN, segmentDims } from "../segment-key";

import type { SegmentSummary } from "./aggregate";

/** Segmentnyckel + besök/konverteringar → sammanfattningen briefen läser.
 *  Fälten utan mätning i den här vägen (formStarts/formAbandons/recent) är
 *  nollor respektive null, och `adequate` är true: anroparen har redan
 *  bestämt att cellen förtjänar en design — det är inte det här steget som
 *  dömer volym. */
export function segmentSummaryFor(
  key: string,
  total: { visits: number; conversions: number },
): SegmentSummary {
  const dims = segmentDims(key);
  return {
    key,
    label: dims.join(" · "),
    depth: dims.length,
    channel: dims[0] ?? null,
    device: dims[1] ?? null,
    country: dims[2] ?? null,
    returning: dims.length >= 4 ? dims[3] === RETURNING_TOKEN : null,
    visits: total.visits,
    conversions: total.conversions,
    conversionRate: total.visits > 0 ? total.conversions / total.visits : 0,
    formStarts: 0,
    formAbandons: 0,
    adequate: true,
    recent: null,
  };
}
