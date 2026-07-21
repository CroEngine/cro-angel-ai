// Angel Adaptive — performance feedback (increment 2, server only).
//
// Turns the measured conversion lift (attribution rollup) into a per-pattern
// priority delta the pure decision engine consumes. Winners are nudged up,
// proven losers are suppressed, everything not yet significant is left at its
// default. Reuses the exact same pure `attribute()` the dashboard shows, so the
// engine optimizes toward the numbers the customer sees.
//
// Best-effort and cached: a DB hit per decision would add latency, so results
// are memoized per site for a short TTL. If the store is unavailable we return
// the last good value (or nothing), and the engine simply runs on its defaults.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cleanEvents } from "@/lib/dashboard/data-hygiene";
import {
  attribute,
  MIN_ARM_EXPOSURES,
  MIN_ARM_OUTCOMES,
  type DashEvent,
  type MicroStats,
} from "@/lib/dashboard/aggregate";
import { PERF_MAX_BOOST, PERF_SUPPRESS, type PatternBoost } from "./decide";
import type { PatternId } from "./types";

/** How long a computed boost map stays warm before we recompute (5 min). */
const TTL_MS = 5 * 60 * 1000;
const EVENT_LIMIT = 5000;

/** Overall boosts + per-trafficSource overrides (D4): a pattern that wins on
 *  linkedin and loses on paid must not get one blended sitewide verdict —
 *  the segment's own adequately-powered verdict wins for that segment. */
interface BoostSet {
  overall: PatternBoost;
  bySegment: Record<string, PatternBoost>;
}

const cache = new Map<string, { at: number; boosts: BoostSet }>();

/** Map a significant lift into a bounded positive nudge; proven-negative lift
 *  suppresses the pattern outright. Only called for significant rows. */
function boostForLift(lift: number): number {
  if (lift < 0) return PERF_SUPPRESS;
  // ~ +3 priority per percentage-point of lift, capped so rules still matter.
  return Math.min(PERF_MAX_BOOST, Math.round(lift * 300));
}

// ---- micro-conversion nudges --------------------------------------------------
// Low-volume sites take months to reach a significant CONVERSION verdict, but
// micro-conversions (deep scroll, multi-page, return visits) accumulate 10-50×
// faster. While a pattern has no proven lift, a clear engagement gap between
// the arms nudges its priority MILDLY — capped far below a proven win and
// never suppressing (decide() floors non-sentinel deltas at priority 1, D3).
// The moment real lift is significant it takes over.
/** Max |priority delta| an engagement signal may contribute (⅓ of proven max). */
const MICRO_MAX_NUDGE = 10;
/** Minimum absolute composite-score gap between arms before nudging. */
const MICRO_MIN_DIFF = 0.05;
/** Minimum relative gap vs the control score (noise floor). */
const MICRO_MIN_REL = 0.25;

/** Hierarchical composite score, 0..1 (D2): conversion is the TERMINAL
 *  signal; engagement only scores the non-converted remainder —
 *  score = convRate + (1 − convRate) · engagement(non-converters). A pattern
 *  can never score worse by converting people out of the browsing funnel,
 *  which the old all-visitors share did (fast converters don't scroll,
 *  browse on, or come back — and were counted as disengaged). MicroStats
 *  are counted among non-converters upstream (aggregate.ts microStat). */
function microScore(arm: { exposures: number; conversions: number }, m: MicroStats): number {
  if (arm.exposures <= 0) return 0;
  const convRate = arm.conversions / arm.exposures;
  const nonConverters = arm.exposures - arm.conversions;
  const engagement =
    nonConverters > 0
      ? (0.25 * m.deepScroll + 0.35 * m.multiPage + 0.4 * m.returned) / nonConverters
      : 0;
  return convRate + (1 - convRate) * engagement;
}

/** The micro nudge for one attribution row, or 0 when the evidence is thin. */
export function microNudge(row: {
  adapted: { exposures: number; conversions: number; rate: number };
  control: { exposures: number; conversions: number; rate: number };
  adaptedMicro: MicroStats;
  controlMicro: MicroStats;
}): number {
  if (row.adapted.exposures < MIN_ARM_EXPOSURES || row.control.exposures < MIN_ARM_EXPOSURES) {
    return 0;
  }
  const a = microScore(row.adapted, row.adaptedMicro);
  const c = microScore(row.control, row.controlMicro);
  const diff = a - c;
  if (Math.abs(diff) < MICRO_MIN_DIFF) return 0;
  if (c > 0 && Math.abs(diff) / c < MICRO_MIN_REL) return 0;
  const nudge = Math.max(-MICRO_MAX_NUDGE, Math.min(MICRO_MAX_NUDGE, Math.round(diff * 60)));
  // Directional guard (D2): when both arms have real conversion outcomes and
  // the (not-yet-significant) lift is POSITIVE, an engagement gap may never
  // drag the pattern down — the real goal outranks its proxies.
  if (
    nudge < 0 &&
    row.adapted.conversions >= MIN_ARM_OUTCOMES &&
    row.control.conversions >= MIN_ARM_OUTCOMES &&
    row.adapted.rate > row.control.rate
  ) {
    return 0;
  }
  return nudge;
}

/** Boost from one attribution row: a significant conversion verdict always
 *  wins; otherwise a mild engagement nudge while conversions accumulate. */
function boostFromRow(row: Parameters<typeof microNudge>[0] & {
  significant: boolean;
  lift: number | null;
}): number {
  if (row.significant && row.lift !== null) return boostForLift(row.lift);
  return microNudge(row);
}

/**
 * Load the per-pattern boost map for a site from measured attribution,
 * resolved for one visitor's traffic source (D4): a segment's own
 * adequately-powered verdict overrides the sitewide one, so a pattern that
 * wins on linkedin keeps running there even when the blended average is
 * negative. Never throws; returns {} when there's nothing significant yet or
 * the store is unavailable. Cached per site for TTL_MS.
 */
export async function loadPatternBoosts(
  site: string,
  trafficSource?: string | null,
): Promise<PatternBoost> {
  const now = Date.now();
  const hit = cache.get(site);
  if (hit && now - hit.at < TTL_MS) return resolveBoosts(hit.boosts, trafficSource);

  try {
    const { data } = await supabaseAdmin
      .from("angel_events")
      .select("type,payload,visitor_hash,decision_id,created_at")
      .eq("site", site)
      // pageview + scroll_depth feed the micro-conversion nudges.
      .in("type", ["adaptation_shown", "adaptation_withheld", "conversion", "pageview", "scroll_depth"])
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    // Datahygien (revisionen 2026-07-20): ägar-/testkonverteringar får aldrig
    // driva pattern-boosts — samma rensning som dashboardens läsväg.
    const events: DashEvent[] = cleanEvents(
      site,
      (data ?? []).map((r) => ({
        type: r.type,
        payload: (r.payload as Record<string, unknown>) ?? {},
        visitorHash: r.visitor_hash,
        decisionId: r.decision_id,
        createdAt: r.created_at,
      })),
    );

    const boosts: BoostSet = { overall: {}, bySegment: {} };
    for (const row of attribute(events)) {
      const b = boostFromRow(row);
      if (b === 0) continue;
      if (row.segment === null) {
        boosts.overall[row.pattern as PatternId] = b;
      } else {
        (boosts.bySegment[row.segment] ??= {})[row.pattern as PatternId] = b;
      }
    }

    cache.set(site, { at: now, boosts });
    return resolveBoosts(boosts, trafficSource);
  } catch (err) {
    console.warn(`[angel] performance boosts unavailable:`, err);
    return hit ? resolveBoosts(hit.boosts, trafficSource) : {};
  }
}

/** Merge: segment-specific verdicts override the sitewide ones. Exported for
 *  tests; pure. */
export function resolveBoosts(boosts: BoostSet, trafficSource?: string | null): PatternBoost {
  const seg = trafficSource ? boosts.bySegment[trafficSource] : undefined;
  return seg ? { ...boosts.overall, ...seg } : { ...boosts.overall };
}
