// Segment intelligence (Phase 2 / Intelligence Mode, entry point). Angel groups a
// site's sessions by traffic source — the first behavioral "segment" dimension —
// and measures how each group actually behaves (bounce, scroll depth, dwell time)
// against the site-wide baseline. The output is observation only: every number is
// measured from real sessions and every sentence is a restatement of a measured
// delta. Angel never invents content here, and nothing is adapted — this is the
// "learn before adapting" stage made visible.
//
// Computed on read via the RLS-scoped client (no service-role, no new table): at
// Learn-Mode volumes a grouped scan of sessions is cheap, and the events_rollup /
// segments-table path is a scale optimization for later.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SegmentBehavior {
  source: string; // segment key (v1: derived traffic source)
  label: string; // human label for the source
  sessions: number;
  visitors: number;
  share: number; // 0..1 of total sessions in range
  bounceRate: number | null; // 0..1 over sessions with a known bounce
  avgScrollPct: number | null; // 0..100
  avgDurationMs: number | null;
}

export interface SegmentObservation {
  source: string;
  metric: "bounce" | "scroll";
  tone: "good" | "bad";
  text: string; // plain-language, derived purely from the measured deltas
}

export interface SegmentBaseline {
  bounceRate: number | null;
  avgScrollPct: number | null;
  avgDurationMs: number | null;
}

export interface SegmentIntelligence {
  totalSessions: number;
  learning: boolean; // true while the sample is too thin to trust the signal
  baseline: SegmentBaseline;
  segments: SegmentBehavior[];
  observations: SegmentObservation[];
}

// Significance gates — when to *surface* a claim. They guard against over-claiming
// on thin data; the claim's content is always the measured number, never invented.
const MIN_SEGMENT_SESSIONS = 20; // don't characterise a segment below this
const SITE_LEARNING_THRESHOLD = 200; // below this total, flag "early signal"
const BOUNCE_DELTA = 0.15; // 15pts vs baseline before we say anything
const SCROLL_DELTA = 12; // 12pts of average scroll depth

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct",
  organic: "Organic search",
  social: "Social",
  paid: "Paid",
  referral: "Referral",
  email: "Email",
};

function labelFor(source: string): string {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

type SessionLite = {
  source: string | null;
  visitor_id: string;
  bounced: boolean | null;
  max_scroll_pct: number | null;
  duration_ms: number | null;
};

// Running accumulator per segment — sums kept alongside counts so each average is
// taken only over the sessions that actually carried that signal.
interface Acc {
  sessions: number;
  visitors: Set<string>;
  bounceKnown: number;
  bounceCount: number;
  scrollSum: number;
  scrollKnown: number;
  durSum: number;
  durKnown: number;
}

function newAcc(): Acc {
  return {
    sessions: 0,
    visitors: new Set(),
    bounceKnown: 0,
    bounceCount: 0,
    scrollSum: 0,
    scrollKnown: 0,
    durSum: 0,
    durKnown: 0,
  };
}

function add(acc: Acc, r: SessionLite) {
  acc.sessions += 1;
  acc.visitors.add(r.visitor_id);
  if (r.bounced != null) {
    acc.bounceKnown += 1;
    if (r.bounced) acc.bounceCount += 1;
  }
  if (r.max_scroll_pct != null) {
    acc.scrollKnown += 1;
    acc.scrollSum += r.max_scroll_pct;
  }
  if (r.duration_ms != null) {
    acc.durKnown += 1;
    acc.durSum += r.duration_ms;
  }
}

const rate = (n: number, d: number): number | null => (d > 0 ? n / d : null);
const avg = (sum: number, d: number): number | null => (d > 0 ? sum / d : null);
const pct = (x: number): number => Math.round(x * 100);

function buildObservations(
  segments: SegmentBehavior[],
  baseline: SegmentBaseline,
): SegmentObservation[] {
  const out: SegmentObservation[] = [];

  for (const s of segments) {
    if (s.sessions < MIN_SEGMENT_SESSIONS) continue;

    // Bounce vs baseline.
    if (s.bounceRate != null && baseline.bounceRate != null) {
      const d = s.bounceRate - baseline.bounceRate;
      if (d >= BOUNCE_DELTA) {
        out.push({
          source: s.source,
          metric: "bounce",
          tone: "bad",
          text: `${s.label} visitors bounce at ${pct(s.bounceRate)}% — ${pct(d)}pts above your ${pct(baseline.bounceRate)}% average.`,
        });
      } else if (d <= -BOUNCE_DELTA) {
        out.push({
          source: s.source,
          metric: "bounce",
          tone: "good",
          text: `${s.label} visitors stick around — ${pct(s.bounceRate)}% bounce vs your ${pct(baseline.bounceRate)}% average.`,
        });
      }
    }

    // Scroll depth vs baseline.
    if (s.avgScrollPct != null && baseline.avgScrollPct != null) {
      const d = s.avgScrollPct - baseline.avgScrollPct;
      if (d <= -SCROLL_DELTA) {
        out.push({
          source: s.source,
          metric: "scroll",
          tone: "bad",
          text: `${s.label} visitors scroll just ${Math.round(s.avgScrollPct)}% down the page — short of your ${Math.round(baseline.avgScrollPct)}% average.`,
        });
      } else if (d >= SCROLL_DELTA) {
        out.push({
          source: s.source,
          metric: "scroll",
          tone: "good",
          text: `${s.label} visitors read deep — ${Math.round(s.avgScrollPct)}% average scroll vs ${Math.round(baseline.avgScrollPct)}% site-wide.`,
        });
      }
    }
  }

  // Strongest signal first: bad news before good, then by the segment's reach.
  const segShare = new Map(segments.map((s) => [s.source, s.share]));
  return out
    .sort((a, b) => {
      if (a.tone !== b.tone) return a.tone === "bad" ? -1 : 1;
      return (segShare.get(b.source) ?? 0) - (segShare.get(a.source) ?? 0);
    })
    .slice(0, 5);
}

export const getSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { siteId: string; days?: number }) =>
    z
      .object({ siteId: z.string().uuid(), days: z.number().int().min(1).max(90).optional() })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<SegmentIntelligence> => {
    const days = data.days ?? 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    // RLS confines this to the owner's sessions; eq() narrows to the one site.
    const { data: rows, error } = await context.supabase
      .from("sessions")
      .select("source, visitor_id, bounced, max_scroll_pct, duration_ms")
      .eq("site_id", data.siteId)
      .gte("started_at", since)
      .limit(20_000);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as SessionLite[];
    const bySource = new Map<string, Acc>();
    const site = newAcc();

    for (const r of list) {
      const key = r.source ?? "direct";
      let acc = bySource.get(key);
      if (!acc) bySource.set(key, (acc = newAcc()));
      add(acc, r);
      add(site, r);
    }

    const total = list.length;
    const baseline: SegmentBaseline = {
      bounceRate: rate(site.bounceCount, site.bounceKnown),
      avgScrollPct: avg(site.scrollSum, site.scrollKnown),
      avgDurationMs: avg(site.durSum, site.durKnown),
    };

    const segments: SegmentBehavior[] = [...bySource.entries()]
      .map(([source, a]) => ({
        source,
        label: labelFor(source),
        sessions: a.sessions,
        visitors: a.visitors.size,
        share: total > 0 ? a.sessions / total : 0,
        bounceRate: rate(a.bounceCount, a.bounceKnown),
        avgScrollPct: avg(a.scrollSum, a.scrollKnown),
        avgDurationMs: avg(a.durSum, a.durKnown),
      }))
      .sort((x, y) => y.sessions - x.sessions);

    return {
      totalSessions: total,
      learning: total < SITE_LEARNING_THRESHOLD,
      baseline,
      segments,
      observations: buildObservations(segments, baseline),
    };
  });
