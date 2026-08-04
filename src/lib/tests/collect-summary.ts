// Ren collect-summerare — enda källan till collect.summary-aggregatet.
//
// Bakgrund (CRO-planen, steg 1): den LIVE-motorn (engine.server.ts) räknade
// primaryConversionCtaCount / competingAboveFold / aboveFold i ett inline-block
// vid collect-steget, men den OFFLINE replay-vägen (harness.server.ts) — som
// driver `angel`-rapporten OCH varje corpus-golden — returnerade bara
// { target, elements, count } utan summary. Följden: de kärnsignalerna var tyst
// null i rapporten och i alla goldens, aldrig regressionstestade, medan live
// hade dem. Nu delar båda vägarna exakt denna funktion → offline == live.
//
// KRITISKT (annars divergerar de): filter + gruppering lyfts hit MED, inte bara
// summeringsloopen. Summaryn räknas över filterCollected(...) och sedan
// groupRepeatedControls(...). Matar man in rå COLLECT_SCRIPT-output i den ena
// vägen och redan-filtrerad i den andra blir competing/byCategory-deduperingen
// olika. Båda anroparna skickar därför in RÅA element och låter denna funktion
// filtrera + gruppera.

import { groupRepeatedControls } from "./audit-helpers";
import type { CollectedElement, CollectSummary, CollectTarget } from "./schema";

/** Målspecifikt elementfilter. "clickables" är passthrough (allt vi samlade);
 *  "buttons" behåller bara riktiga knappar. Flyttad ut ur engine.server.ts så
 *  att offline-replayvägen applicerar exakt samma filter. */
export function filterCollected(
  all: CollectedElement[],
  target: CollectTarget,
): CollectedElement[] {
  if (target === "buttons") {
    // Strikt: riktig <button>, <input type=submit|button>, role=button.
    return all.filter(
      (el) =>
        el.tagName === "button" ||
        el.tagName === "input[type=submit]" ||
        el.tagName === "input[type=button]" ||
        el.tagName === "[role=button]",
    );
  }
  // "clickables" → allt vi samlade.
  return all;
}

export interface SummarizedCollect {
  /** filterCollected(raw, target), med groupRepeatedControls-markörer applicerade
   *  in-place (groupedAway/groupId/groupCount). Samma array live-motorn sätter
   *  som collect.elements. OBS: summarizeCollected MUTERAR elementen (som live). */
  filtered: CollectedElement[];
  /** Unik räkning — filtered minus groupedAway. */
  count: number;
  /** filtered.length (före dedupe). */
  totalCount: number;
  byCategory: Record<string, number>;
  summary: CollectSummary;
}

/** Bygg collect-summaryn från RÅ COLLECT_SCRIPT-output. Muterar elementen
 *  (groupRepeatedControls markerar groupedAway) precis som live-motorn gör.
 *  Ordagrann lyft av engine.server.ts:s tidigare inline-block (338–419). */
export function summarizeCollected(
  rawElements: CollectedElement[],
  target: CollectTarget,
): SummarizedCollect {
  const filtered = filterCollected(rawElements, target);

  // Markera dubbletter som groupedAway så aggregat inte domineras.
  const groups = groupRepeatedControls(filtered);

  const byCategory: Record<string, number> = {};
  const intentBreakdown: Record<string, number> = {};
  const bySection: Record<string, number> = {};
  let aboveFold = 0;
  let primaryConversionCtaCount = 0;
  let conversionCtasAboveFold = 0;
  for (const el of filtered) {
    if (el.groupedAway) continue; // dedupe ur aggregat
    byCategory[el.category] = (byCategory[el.category] ?? 0) + 1;
    intentBreakdown[el.intent] = (intentBreakdown[el.intent] ?? 0) + 1;
    bySection[el.section] = (bySection[el.section] ?? 0) + 1;
    if (el.position.viewportZone === "above_fold") aboveFold++;
    if (el.category === "cta_primary" && el.intent === "conversion") primaryConversionCtaCount++;
    if (
      (el.category === "cta_primary" ||
        el.category === "cta_secondary" ||
        el.category === "form_submit") &&
      el.position.viewportZone === "above_fold" &&
      el.intent !== "navigation"
    )
      conversionCtasAboveFold++;
  }
  // "Competing" reserverar en plats för själva primären (B8): den ideala
  // en-CTA-sidan läser 0, matchande per-CTA competingActions-självuteslutningen.
  const competingAboveFold = Math.max(
    0,
    conversionCtasAboveFold - (primaryConversionCtaCount > 0 ? 1 : 0),
  );
  const topVisualWeight = [...filtered]
    .filter((el) => !el.groupedAway)
    .sort((a, b) => b.visualWeight.score - a.visualWeight.score)
    .slice(0, 5)
    .map((el) => ({
      selector: el.selector,
      text: el.text,
      score: el.visualWeight.score,
    }));

  const uniqueCount = filtered.filter((el) => !el.groupedAway).length;

  return {
    filtered,
    count: uniqueCount,
    totalCount: filtered.length,
    byCategory,
    summary: {
      total: uniqueCount,
      aboveFold,
      primaryConversionCtaCount,
      conversionCtasAboveFold,
      competingAboveFold,
      topVisualWeight,
      intentBreakdown,
      bySection,
      groups,
    },
  };
}
