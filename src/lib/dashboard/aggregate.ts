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

/** Micro-conversions: steps on the way to the goal, counted per distinct
 *  exposed visitor. They NEVER enter the headline lift — they exist so the
 *  engine (and the owner) can read direction long before final conversions
 *  reach significance on low-volume sites. */
export interface MicroStats {
  /** Visitors who scrolled ≥75% of a page within the attribution window. */
  deepScroll: number;
  /** Visitors with ≥2 pageviews within the attribution window. */
  multiPage: number;
  /** Visitors who came back (a pageview after the window, within 7 days). */
  returned: number;
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
  /** Micro-conversion counts for the same exposed-visitor sets. */
  adaptedMicro: MicroStats;
  controlMicro: MicroStats;
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

/** One day's traffic in the display timezone. `visits` counts exposures
 *  (adaptation_shown + adaptation_withheld — the server logs one per page
 *  render, for ALL traffic including anonymous); `identified` counts distinct
 *  consented visitors (non-null hash) seen that day. */
export interface DayPoint {
  /** YYYY-MM-DD in the display timezone. */
  day: string;
  visits: number;
  identified: number;
  conversions: number;
}

/** Aggregated time-of-day profile across the whole window (display tz). */
export interface HourPoint {
  /** 0..23 in the display timezone. */
  hour: number;
  visits: number;
  identified: number;
}

/** One identified (consented) visitor's footprint — anonymous traffic carries
 *  no id by design and can't appear here. */
export interface VisitorSummary {
  hash: string;
  firstSeen: string;
  lastSeen: string;
  events: number;
  pageviews: number;
  ctaClicks: number;
  /** Deepest scroll bucket reached: 0 | 25 | 50 | 75 | 100. */
  maxScroll: number;
  conversions: number;
  /** Distinct patterns this visitor was exposed to (shown or withheld). */
  patterns: string[];
  /** Which measurement arm they landed in, if any. */
  arm: "adapted" | "control" | "mixed" | null;
  device: string | null;
  country: string | null;
  trafficSource: string | null;
  browser: string | null;
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
  timeseries: {
    daily: DayPoint[];
    hourly: HourPoint[];
  };
  visitors: VisitorSummary[];
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

/** Longest daily series the chart renders — older buckets are dropped. */
export const MAX_DAY_POINTS = 90;

/** Longest visitor list the dashboard shows (newest activity first). */
export const MAX_VISITORS = 50;

/** How long after an exposure a conversion still counts toward it (24 h). */
export const ATTRIBUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A pageview after the attribution window but within this horizon counts as
 *  a return visit (micro-conversion). */
export const MICRO_RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Deep scroll = at least this bucket. */
export const DEEP_SCROLL_DEPTH = 75;

// Minimum evidence before a lift may be called "significant". Without this a
// couple of lucky conversions cross |z| ≥ 1.96 and the bandit (which gates on
// `significant`) would flip or permanently suppress a pattern on pure noise.
// The thresholds enforce the normal-approximation validity condition for a
// two-proportion test: each arm needs ≥ MIN_ARM_EXPOSURES visitors and at least
// MIN_ARM_OUTCOMES conversions AND non-conversions (the "success–failure" rule).
export const MIN_ARM_EXPOSURES = 30;
export const MIN_ARM_OUTCOMES = 5;

function armValid(s: VariantStat): boolean {
  return (
    s.exposures >= MIN_ARM_EXPOSURES &&
    s.conversions >= MIN_ARM_OUTCOMES &&
    s.exposures - s.conversions >= MIN_ARM_OUTCOMES
  );
}

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
export function attribute(events: DashEvent[]): PatternAttribution[] {
  // Per-visitor event timelines (ms, sorted): conversions for the headline
  // metric, deep scrolls + pageviews for the micro-conversions.
  const conversionsByVisitor = new Map<string, number[]>();
  const deepScrollsByVisitor = new Map<string, number[]>();
  const pageviewsByVisitor = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, visitor: string, t: number) =>
    (map.get(visitor) ?? map.set(visitor, []).get(visitor)!).push(t);
  for (const e of events) {
    if (!e.visitorHash) continue;
    const t = ms(e.createdAt);
    if (Number.isNaN(t)) continue;
    if (e.type === "conversion") push(conversionsByVisitor, e.visitorHash, t);
    else if (e.type === "pageview") push(pageviewsByVisitor, e.visitorHash, t);
    else if (
      e.type === "scroll_depth" &&
      typeof e.payload.depth === "number" &&
      e.payload.depth >= DEEP_SCROLL_DEPTH
    ) {
      push(deepScrollsByVisitor, e.visitorHash, t);
    }
  }
  for (const map of [conversionsByVisitor, deepScrollsByVisitor, pageviewsByVisitor]) {
    for (const times of map.values()) times.sort((a, b) => a - b);
  }

  const countIn = (times: number[] | undefined, from: number, until: number): number => {
    if (!times) return 0;
    let n = 0;
    for (const t of times) if (t >= from && t <= until) n++;
    return n;
  };

  const converted = (visitor: string, from: number): boolean =>
    countIn(conversionsByVisitor.get(visitor), from, from + ATTRIBUTION_WINDOW_MS) > 0;

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

  const microStat = (visitors: Map<string, number>): MicroStats => {
    const m: MicroStats = { deepScroll: 0, multiPage: 0, returned: 0 };
    for (const [visitor, from] of visitors) {
      const until = from + ATTRIBUTION_WINDOW_MS;
      if (countIn(deepScrollsByVisitor.get(visitor), from, until) > 0) m.deepScroll++;
      if (countIn(pageviewsByVisitor.get(visitor), from, until) >= 2) m.multiPage++;
      if (countIn(pageviewsByVisitor.get(visitor), until, from + MICRO_RETURN_WINDOW_MS) > 0) {
        m.returned++;
      }
    }
    return m;
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
      adaptedMicro: microStat(byVariant.adapted),
      controlMicro: microStat(byVariant.control),
      lift: hasBoth ? adapted.rate - control.rate : null,
      z,
      // Require a valid, adequately-powered sample in BOTH arms, not just a
      // z-crossing — otherwise tiny-n noise reads as a proven win/loss.
      significant:
        z !== null && Math.abs(z) >= 1.96 && armValid(adapted) && armValid(control),
    });
  }

  return out.sort(
    (a, b) => b.adapted.exposures - a.adapted.exposures || a.pattern.localeCompare(b.pattern),
  );
}

// ---- time bucketing ----------------------------------------------------------

/** Exposure events: one per page render, logged server-side for ALL traffic
 *  (anonymous included) — the closest thing we store to "a visit". */
const isExposure = (t: string) => t === "adaptation_shown" || t === "adaptation_withheld";

/** Shift an event's UTC ms into the display timezone so its UTC getters read as
 *  local wall-clock. `tzOffsetMinutes` uses Date#getTimezoneOffset semantics
 *  (UTC − local, so Stockholm in summer is −120). */
const shifted = (iso: string, tzOffsetMinutes: number): Date | null => {
  const t = ms(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t - tzOffsetMinutes * 60_000);
};

/**
 * Bucket traffic by calendar day and by hour of day (both in the display tz).
 * Days are gap-filled with zeros between the first and last event so the chart
 * has a continuous axis; the series is capped to the newest MAX_DAY_POINTS.
 * Hours are always the full 0..23 profile aggregated across the window. Pure —
 * buckets derive only from event timestamps, never the clock.
 */
export function bucketByTime(
  events: DashEvent[],
  tzOffsetMinutes = 0,
): { daily: DayPoint[]; hourly: HourPoint[] } {
  type DayAcc = { visits: number; identified: Set<string>; conversions: number };
  const days = new Map<string, DayAcc>();
  const hours: { visits: number; identified: Set<string> }[] = Array.from(
    { length: 24 },
    () => ({ visits: 0, identified: new Set<string>() }),
  );

  for (const e of events) {
    const d = shifted(e.createdAt, tzOffsetMinutes);
    if (!d) continue;
    const dayKey = d.toISOString().slice(0, 10);
    const hour = d.getUTCHours();
    let day = days.get(dayKey);
    if (!day) {
      day = { visits: 0, identified: new Set(), conversions: 0 };
      days.set(dayKey, day);
    }
    if (isExposure(e.type)) {
      day.visits++;
      hours[hour].visits++;
    }
    if (e.visitorHash) {
      day.identified.add(e.visitorHash);
      hours[hour].identified.add(e.visitorHash);
    }
    if (e.type === "conversion") day.conversions++;
  }

  // Gap-fill: walk day by day from the earliest to the latest bucket. Stepping
  // in whole UTC days over the shifted timeline is DST-safe.
  const daily: DayPoint[] = [];
  const keys = [...days.keys()].sort();
  if (keys.length > 0) {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const first = Date.parse(`${keys[0]}T00:00:00Z`);
    const last = Date.parse(`${keys[keys.length - 1]}T00:00:00Z`);
    for (let t = first; t <= last; t += DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10);
      const acc = days.get(key);
      daily.push({
        day: key,
        visits: acc?.visits ?? 0,
        identified: acc?.identified.size ?? 0,
        conversions: acc?.conversions ?? 0,
      });
    }
  }

  return {
    daily: daily.slice(-MAX_DAY_POINTS),
    hourly: hours.map((h, hour) => ({ hour, visits: h.visits, identified: h.identified.size })),
  };
}

/**
 * Group events into per-visitor footprints (identified visitors only —
 * anonymous traffic has no id and is unlinkable by design). Sorted by most
 * recent activity, capped at MAX_VISITORS. Order-independent: the context
 * columns come from the NEWEST pageview by timestamp, not input position.
 */
export function summarizeVisitors(events: DashEvent[]): VisitorSummary[] {
  type Acc = {
    first: string;
    last: string;
    events: number;
    pageviews: number;
    ctaClicks: number;
    maxScroll: number;
    conversions: number;
    patterns: Set<string>;
    adapted: boolean;
    control: boolean;
    /** Timestamp of the pageview the context columns came from. */
    ctxAt: string | null;
    device: string | null;
    country: string | null;
    trafficSource: string | null;
    browser: string | null;
  };
  const byVisitor = new Map<string, Acc>();

  for (const e of events) {
    if (!e.visitorHash) continue;
    let acc = byVisitor.get(e.visitorHash);
    if (!acc) {
      acc = {
        first: e.createdAt,
        last: e.createdAt,
        events: 0,
        pageviews: 0,
        ctaClicks: 0,
        maxScroll: 0,
        conversions: 0,
        patterns: new Set(),
        adapted: false,
        control: false,
        ctxAt: null,
        device: null,
        country: null,
        trafficSource: null,
        browser: null,
      };
      byVisitor.set(e.visitorHash, acc);
    }
    acc.events++;
    if (e.createdAt < acc.first) acc.first = e.createdAt;
    if (e.createdAt > acc.last) acc.last = e.createdAt;
    if (e.type === "pageview") {
      acc.pageviews++;
      // The newest pageview (by timestamp — input order varies) provides the
      // context columns.
      if (acc.ctxAt === null || e.createdAt >= acc.ctxAt) {
        acc.ctxAt = e.createdAt;
        acc.device = str(e.payload.device) ?? acc.device;
        acc.country = str(e.payload.country) ?? acc.country;
        acc.trafficSource = str(e.payload.trafficSource) ?? acc.trafficSource;
        acc.browser = str(e.payload.browser) ?? acc.browser;
      }
    } else if (e.type === "cta_click") {
      acc.ctaClicks++;
    } else if (e.type === "scroll_depth") {
      const depth = typeof e.payload.depth === "number" ? e.payload.depth : 0;
      if (depth > acc.maxScroll) acc.maxScroll = depth;
    } else if (e.type === "conversion") {
      acc.conversions++;
    } else if (isExposure(e.type)) {
      for (const p of patternsOf(e.payload)) acc.patterns.add(p);
      if (e.type === "adaptation_shown") acc.adapted = true;
      else acc.control = true;
    }
  }

  return [...byVisitor.entries()]
    .map(([hash, a]) => ({
      hash,
      firstSeen: a.first,
      lastSeen: a.last,
      events: a.events,
      pageviews: a.pageviews,
      ctaClicks: a.ctaClicks,
      maxScroll: a.maxScroll,
      conversions: a.conversions,
      patterns: [...a.patterns].sort(),
      arm: (a.adapted && a.control
        ? "mixed"
        : a.adapted
          ? "adapted"
          : a.control
            ? "control"
            : null) as VisitorSummary["arm"],
      device: a.device,
      country: a.country,
      trafficSource: a.trafficSource,
      browser: a.browser,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.hash.localeCompare(b.hash))
    .slice(0, MAX_VISITORS);
}

export function aggregate(
  events: DashEvent[],
  inventory: InventoryEntry[],
  opts: { tzOffsetMinutes?: number } = {},
): DashboardMetrics {
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
    timeseries: bucketByTime(events, opts.tzOffsetMinutes ?? 0),
    visitors: summarizeVisitors(events),
    liveAdaptations,
    performance,
    attribution,
    inventory: inventoryGroups,
  };
}
