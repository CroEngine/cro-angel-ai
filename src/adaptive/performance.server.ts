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
import { attribute, type DashEvent } from "@/lib/dashboard/aggregate";
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
      .in("type", ["adaptation_shown", "adaptation_withheld", "conversion"])
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
      // Only act on statistically significant results (needs a holdout group).
      if (!row.significant || row.lift === null) continue;
      boosts[row.pattern as PatternId] = boostForLift(row.lift);
    }

    cache.set(site, { at: now, boosts });
    return boosts;
  } catch (err) {
    console.warn(`[angel] performance boosts unavailable:`, err);
    return hit?.boosts ?? {};
  }
}
