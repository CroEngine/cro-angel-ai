// Pure segment aggregation — the single, shared definition of "what a segment is".
// Both the dashboard (getSegments, RLS client) and the decision engine (/api/plan,
// admin client) call this so the numbers can never drift apart. No I/O here.

export interface SessionLite {
  source: string | null;
  visitor_id: string;
  bounced: boolean | null;
  max_scroll_pct: number | null;
  duration_ms: number | null;
}

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

export interface SegmentBaseline {
  bounceRate: number | null;
  avgScrollPct: number | null;
  avgDurationMs: number | null;
}

export interface SegmentAggregate {
  totalSessions: number;
  baseline: SegmentBaseline;
  segments: SegmentBehavior[]; // sorted by session count, desc
}

const SOURCE_LABELS: Record<string, string> = {
  direct: "Direct",
  organic: "Organic search",
  social: "Social",
  paid: "Paid",
  referral: "Referral",
  email: "Email",
};

export function labelFor(source: string): string {
  return SOURCE_LABELS[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

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

// Bucket sessions by source, returning each segment's behavior plus the site-wide
// baseline. Sessions with no source are bucketed as "direct".
export function aggregateSegments(rows: SessionLite[]): SegmentAggregate {
  const bySource = new Map<string, Acc>();
  const site = newAcc();

  for (const r of rows) {
    const key = r.source ?? "direct";
    let acc = bySource.get(key);
    if (!acc) bySource.set(key, (acc = newAcc()));
    add(acc, r);
    add(site, r);
  }

  const total = rows.length;
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

  return { totalSessions: total, baseline, segments };
}
