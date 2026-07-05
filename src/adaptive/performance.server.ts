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
import {
  attribute,
  MIN_ARM_EXPOSURES,
  type DashEvent,
  type MicroStats,
} from "@/lib/dashboard/aggregate";
import { PERF_MAX_BOOST, PERF_SUPPRESS, type PatternBoost } from "./decide";
import type { PatternId } from "./types";

/** How long a computed boost map stays warm before we recompute (5 min). */
const TTL_MS = 5 * 60 * 1000;
const EVENT_LIMIT = 5000;

const cache = new Map<string, { at: number; boosts: PatternBoost }>();

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
// never suppressing. The moment real lift is significant it takes over.
/** Max |priority delta| an engagement signal may contribute (⅓ of proven max). */
const MICRO_MAX_NUDGE = 10;
/** Minimum absolute composite-score gap between arms before nudging. */
const MICRO_MIN_DIFF = 0.05;
/** Minimum relative gap vs the control score (noise floor). */
const MICRO_MIN_REL = 0.25;

/** Composite engagement score, 0..1: weighted share of exposed visitors who
 *  scrolled deep / browsed on / came back. Weights favour the stronger
 *  intent signals; deterministic and documented, not fitted. */
function microScore(m: MicroStats, exposures: number): number {
  if (exposures <= 0) return 0;
  return (0.25 * m.deepScroll + 0.35 * m.multiPage + 0.4 * m.returned) / exposures;
}

/** The micro nudge for one attribution row, or 0 when the evidence is thin. */
export function microNudge(row: {
  adapted: { exposures: number };
  control: { exposures: number };
  adaptedMicro: MicroStats;
  controlMicro: MicroStats;
}): number {
  if (row.adapted.exposures < MIN_ARM_EXPOSURES || row.control.exposures < MIN_ARM_EXPOSURES) {
    return 0;
  }
  const a = microScore(row.adaptedMicro, row.adapted.exposures);
  const c = microScore(row.controlMicro, row.control.exposures);
  const diff = a - c;
  if (Math.abs(diff) < MICRO_MIN_DIFF) return 0;
  if (c > 0 && Math.abs(diff) / c < MICRO_MIN_REL) return 0;
  return Math.max(-MICRO_MAX_NUDGE, Math.min(MICRO_MAX_NUDGE, Math.round(diff * 60)));
}

/**
 * Load the per-pattern boost map for a site from measured attribution.
 * Never throws; returns {} when there's nothing significant yet or the store is
 * unavailable. Cached per site for TTL_MS.
 */
export async function loadPatternBoosts(site: string): Promise<PatternBoost> {
  const now = Date.now();
  const hit = cache.get(site);
  if (hit && now - hit.at < TTL_MS) return hit.boosts;

  try {
    const { data } = await supabaseAdmin
      .from("angel_events")
      .select("type,payload,visitor_hash,decision_id,created_at")
      .eq("site", site)
      // pageview + scroll_depth feed the micro-conversion nudges.
      .in("type", ["adaptation_shown", "adaptation_withheld", "conversion", "pageview", "scroll_depth"])
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    const events: DashEvent[] = (data ?? []).map((r) => ({
      type: r.type,
      payload: (r.payload as Record<string, unknown>) ?? {},
      visitorHash: r.visitor_hash,
      decisionId: r.decision_id,
      createdAt: r.created_at,
    }));

    const boosts: PatternBoost = {};
    for (const row of attribute(events)) {
      // A significant conversion verdict always wins (needs a holdout group).
      if (row.significant && row.lift !== null) {
        boosts[row.pattern as PatternId] = boostForLift(row.lift);
        continue;
      }
      // Otherwise: a mild engagement nudge while conversions accumulate.
      const nudge = microNudge(row);
      if (nudge !== 0) boosts[row.pattern as PatternId] = nudge;
    }

    cache.set(site, { at: now, boosts });
    return boosts;
  } catch (err) {
    console.warn(`[angel] performance boosts unavailable:`, err);
    return hit?.boosts ?? {};
  }
}
