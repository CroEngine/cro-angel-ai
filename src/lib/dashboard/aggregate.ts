// Angel Adaptive — dashboard aggregation (blueprint Step 8).
//
// Pure functions that turn raw angel_events rows + content inventory into the
// view model the customer dashboard renders (Overview, Visitor Segments, Live
// Adaptations, Performance, Content Inventory). No IO, no clock — so the whole
// thing is unit-tested against synthetic events. The server function in
// dashboard.functions.ts feeds it real rows from Supabase.

/** A minimal projection of an angel_events row. */
export interface DashEvent {
  type: string;
  payload: Record<string, unknown>;
  visitorHash: string | null;
  decisionId: string | null;
  createdAt: string; // ISO timestamp
}

/** A minimal projection of an angel_content_inventory row. */
export interface InventoryEntry {
  slot: string;
  id: string;
  text: string | null;
  selector: string | null;
  meta: Record<string, string>;
}

export interface Overview {
  pageviews: number;
  uniqueVisitors: number;
  adaptationsShown: number;
  ctaClicks: number;
  conversions: number;
  /** conversions / pageviews, 0..1. */
  conversionRate: number;
}

export interface SegmentBar {
  key: string;
  pageviews: number;
}

export interface LiveAdaptation {
  decisionId: string;
  patterns: string[];
  trafficSource: string | null;
  device: string | null;
  at: string;
}

export interface PatternStat {
  pattern: string;
  shown: number;
}

/** Conversion outcome for one variant (adapted vs control) of a pattern. */
export interface VariantStat {
  /** Distinct visitors exposed to (or withheld from) this pattern. */
  exposures: number;
  /** Distinct exposed visitors who converted within the attribution window. */
  conversions: number;
  /** conversions / exposures, 0..1 (0 when no exposures). */
  rate: number;
}

/**
 * "What's working": per-pattern causal read. Joins each visitor's earliest
 * `adaptation_shown` (adapted) / `adaptation_withheld` (control) to any later
 * `conversion` by that same visitor within ATTRIBUTION_WINDOW_MS.
 */
export interface PatternAttribution {
  pattern: string;
  adapted: VariantStat;
  control: VariantStat;
  /** adapted.rate − control.rate; null when there's no control group to
   *  compare against (holdout off / no withheld exposures yet). */
  lift: number | null;
  /** Two-proportion z score for the rate difference; null without both groups. */
  z: number | null;
  /** True when both variants have exposures and |z| ≥ 1.96 (~95%). */
  significant: boolean;
}

export interface InventoryGroup {
  slot: string;
  items: InventoryEntry[];
}

export interface DashboardMetrics {
  overview: Overview;
  segments: {
    byTrafficSource: SegmentBar[];
    byDevice: SegmentBar[];
    byCountry: SegmentBar[];
    byBrowser: SegmentBar[];
    byLanguage: SegmentBar[];
    byCampaign: SegmentBar[];
  };
  liveAdaptations: LiveAdaptation[];
  performance: PatternStat[];
  attribution: PatternAttribution[];
  inventory: InventoryGroup[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function patternsOf(payload: Record<string, unknown>): string[] {
  const p = payload.patterns;
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}

/** Count occurrences of a key into a sorted (desc) bar list. */
function tally(pairs: (string | null)[], fallback = "unknown"): SegmentBar[] {
  const counts = new Map<string, number>();
  for (const raw of pairs) {
    const key = raw ?? fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, pageviews]) => ({ key, pageviews }))
    .sort((a, b) => b.pageviews - a.pageviews || a.key.localeCompare(b.key));
}

export const MAX_LIVE_ADAPTATIONS = 25;

/** How long after an exposure a conversion still counts toward it (24 h). */
export const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
};

/** Two-proportion z score for (c1/n1) vs (c2/n2), or null if a group is empty
 *  or the pooled variance is degenerate. */
function twoProportionZ(c1: number, n1: number, c2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pooled = (c1 + c2) / (n1 + n2);
  const denom = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (denom === 0) return null;
  return (p1 - p2) / denom;
}

/**
 * Attribute conversions to the patterns a visitor was exposed to. For every
 * (pattern, variant) we take each visitor's EARLIEST exposure and count them as
 * converted if that same visitor has any conversion in
 * [exposure, exposure + window]. Distinct-visitor throughout, so repeat
 * pageviews don't inflate the numbers. Exposures without a visitorHash can't be
 * joined and are ignored.
 */
function attribute(events: DashEvent[]): PatternAttribution[] {
  // visitorHash -> sorted conversion times (ms)
  const conversionsByVisitor = new Map<string, number[]>();
  for (const e of events) {
    if (e.type !== "conversion" || !e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    (conversionsByVisitor.get(e.visitorHash) ?? conversionsByVisitor.set(e.visitorHash, []).get(e.visitorHash)!).push(t);
  }
  for (const times of conversionsByVisitor.values()) times.sort((a, b) => a - b);

  const converted = (visitor: string, from: number): boolean => {
    const times = conversionsByVisitor.get(visitor);
    if (!times) return false;
    const until = from + ATTRIBUTION_WINDOW_MS;
    for (const t of times) if (t >= from && t <= until) return true;
    return false;
  };

  // pattern -> variant -> visitor -> earliest exposure time (ms)
  type VariantKey = "adapted" | "control";
  const exposures = new Map<string, Record<VariantKey, Map<string, number>>>();
  for (const e of events) {
    const variant: VariantKey | null =
      e.type === "adaptation_shown" ? "adapted" : e.type === "adaptation_withheld" ? "control" : null;
    if (!variant || !e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    for (const pattern of patternsOf(e.payload)) {
      let byVariant = exposures.get(pattern);
      if (!byVariant) {
        byVariant = { adapted: new Map(), control: new Map() };
        exposures.set(pattern, byVariant);
      }
      const seen = byVariant[variant];
      const prev = seen.get(e.visitorHash);
      if (prev === undefined || t < prev) seen.set(e.visitorHash, t);
    }
  }

  const stat = (visitors: Map<string, number>): VariantStat => {
    let conversions = 0;
    for (const [visitor, from] of visitors) if (converted(visitor, from)) conversions++;
    const exp = visitors.size;
    return { exposures: exp, conversions, rate: exp > 0 ? conversions / exp : 0 };
  };

  const out: PatternAttribution[] = [];
  for (const [pattern, byVariant] of exposures) {
    const adapted = stat(byVariant.adapted);
    const control = stat(byVariant.control);
    const hasBoth = adapted.exposures > 0 && control.exposures > 0;
    const z = hasBoth
      ? twoProportionZ(adapted.conversions, adapted.exposures, control.conversions, control.exposures)
      : null;
    out.push({
      pattern,
      adapted,
      control,
      lift: hasBoth ? adapted.rate - control.rate : null,
      z,
      significant: z !== null && Math.abs(z) >= 1.96,
    });
  }

  return out.sort(
    (a, b) => b.adapted.exposures - a.adapted.exposures || a.pattern.localeCompare(b.pattern),
  );
}

export function aggregate(events: DashEvent[], inventory: InventoryEntry[]): DashboardMetrics {
  const pageviewEvents = events.filter((e) => e.type === "pageview");
  const shownEvents = events.filter((e) => e.type === "adaptation_shown");

  const visitors = new Set<string>();
  for (const e of events) if (e.visitorHash) visitors.add(e.visitorHash);

  const pageviews = pageviewEvents.length;
  const conversions = events.filter((e) => e.type === "conversion").length;

  const overview: Overview = {
    pageviews,
    uniqueVisitors: visitors.size,
    adaptationsShown: shownEvents.length,
    ctaClicks: events.filter((e) => e.type === "cta_click").length,
    conversions,
    conversionRate: pageviews > 0 ? conversions / pageviews : 0,
  };

  const segments = {
    byTrafficSource: tally(pageviewEvents.map((e) => str(e.payload.trafficSource))),
    byDevice: tally(pageviewEvents.map((e) => str(e.payload.device))),
    byCountry: tally(pageviewEvents.map((e) => str(e.payload.country))),
    byBrowser: tally(pageviewEvents.map((e) => str(e.payload.browser))),
    byLanguage: tally(pageviewEvents.map((e) => str(e.payload.language))),
    byCampaign: tally(
      pageviewEvents.map((e) => str(e.payload.campaign)),
      "(ingen)",
    ),
  };

  const liveAdaptations: LiveAdaptation[] = [...shownEvents]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_LIVE_ADAPTATIONS)
    .map((e) => ({
      decisionId: e.decisionId ?? "",
      patterns: patternsOf(e.payload),
      trafficSource: str(e.payload.trafficSource),
      device: str(e.payload.device),
      at: e.createdAt,
    }));

  const patternCounts = new Map<string, number>();
  for (const e of shownEvents) {
    for (const p of patternsOf(e.payload)) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
    }
  }
  const performance: PatternStat[] = [...patternCounts.entries()]
    .map(([pattern, shown]) => ({ pattern, shown }))
    .sort((a, b) => b.shown - a.shown || a.pattern.localeCompare(b.pattern));

  const bySlot = new Map<string, InventoryEntry[]>();
  for (const item of inventory) {
    (bySlot.get(item.slot) ?? bySlot.set(item.slot, []).get(item.slot)!).push(item);
  }
  const inventoryGroups: InventoryGroup[] = [...bySlot.entries()]
    .map(([slot, items]) => ({ slot, items }))
    .sort((a, b) => a.slot.localeCompare(b.slot));

  const attribution = attribute(events);

  return {
    overview,
    segments,
    liveAdaptations,
    performance,
    attribution,
    inventory: inventoryGroups,
  };
}
