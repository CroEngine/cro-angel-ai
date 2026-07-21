// Kohort-scopes — nattloopens RENA planerare för VAR nästa kohortscopade
// variant är värd att designa (drift/guardrail-svepens idiom: pure,
// deterministisk, enhetstestbar).
//
// Princip: en kohort är designvärdig först när den är MÄTBAR — tillräcklig
// trafik för att nå ett domslut inom rimlig tid (labbets estimateVerdictTime,
// samma 80 %-power-matte som korten visar ägaren). Beteendeskillnad avgör
// sedan VAD designen blir (nästa våning, generativt); den här planeraren
// svarar bara ärligt på "vilka scopes bär ett eget A/B?".

import { cohortKeysFromDims } from "../context";
import { estimateVerdictTime } from "../../adaptive-lab/metrics";

/** En rad ur angel_cohort_traffic-RPC:n: exponeringarnas loggade dims. */
export interface CohortTrafficRow {
  traffic_source: string | null;
  is_returning: boolean | null;
  viewed_pricing: boolean | null;
  visitors: number | string;
}

export interface CohortScope {
  cohorts: string[]; // en nyckel per scope i v1 (ch:/src:/ret:/seen:)
  visitorsInWindow: number;
  estimatedDaysToVerdict: number;
}

export interface CohortScopeOptions {
  windowDays: number;
  /** Primärens basnivå — styr hur mycket trafik ett domslut kräver. */
  baseRate: number;
  /** Effekten vi dimensionerar för (typisk designeffekt ±30 %). */
  mdeRel?: number;
  maxDaysToVerdict?: number; // scopes långsammare än så föreslås inte
  maxScopes?: number;
}

/**
 * Aggregera exponeringsdims → enkel-nyckel-scopes, behåll bara de som kan
 * nå ett domslut inom maxDays, snabbast först. `ret:new`/`ch:direct` UTESLUTS
 * som scope: "nya direktbesökare" är basen, inte en kohort att särbehandla.
 */
export function planCohortScopes(
  rows: CohortTrafficRow[],
  opts: CohortScopeOptions,
): CohortScope[] {
  const perKey = new Map<string, number>();
  for (const r of rows) {
    const visitors = Number(r.visitors) || 0;
    if (visitors <= 0) continue;
    const keys = cohortKeysFromDims({
      trafficSource: (r.traffic_source || "direct").toLowerCase(),
      isReturning: r.is_returning === true,
      viewedPricing: r.viewed_pricing === true,
    });
    for (const k of keys) perKey.set(k, (perKey.get(k) ?? 0) + visitors);
  }
  const maxDays = opts.maxDaysToVerdict ?? 45;
  const out: CohortScope[] = [];
  for (const [key, visitors] of perKey) {
    if (key === "ret:new" || key === "ch:direct") continue; // basen, inte ett scope
    const daily = visitors / Math.max(1, opts.windowDays);
    if (daily < 1) continue;
    const est = estimateVerdictTime({
      dailyMatchedVisitors: daily,
      baseRate: opts.baseRate,
      mdeRel: opts.mdeRel ?? 0.3,
      ramp: 50,
    });
    if (est.days > maxDays) continue;
    out.push({ cohorts: [key], visitorsInWindow: visitors, estimatedDaysToVerdict: est.days });
  }
  out.sort(
    (a, b) =>
      a.estimatedDaysToVerdict - b.estimatedDaysToVerdict ||
      b.visitorsInWindow - a.visitorsInWindow ||
      a.cohorts[0].localeCompare(b.cohorts[0]),
  );
  return out.slice(0, opts.maxScopes ?? 3);
}
