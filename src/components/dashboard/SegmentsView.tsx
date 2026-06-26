// Segments view (Intelligence Mode, observe-only). Leads with "What Angel is
// learning" — plain-language observations derived purely from measured deltas —
// then a per-segment behavior table. No recommendations, no adaptation yet: this
// is Angel forming a behavioral model per traffic source and showing its work.

import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSegments, type SegmentBaseline, type SegmentBehavior } from "@/lib/segments.functions";

export function SegmentsView({ siteId }: { siteId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["segments", siteId],
    queryFn: () => getSegments({ data: { siteId, days: 30 } }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="pt-6 text-sm text-destructive">
          Couldn’t load segments: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  if (data.totalSessions === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No sessions yet — install the snippet and Angel will start learning how each traffic
          source behaves.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What Angel is learning</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Observed from your last 30 days — measured, not guessed. Angel adapts nothing yet.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.learning && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
              Early signal — only {data.totalSessions.toLocaleString()} sessions so far. Angel keeps
              watching before it trusts these patterns.
            </div>
          )}

          {data.observations.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No segment is behaving notably differently from your site-wide average yet.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.observations.map((o, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span
                    className={
                      "mt-1.5 inline-block size-2 shrink-0 rounded-full " +
                      (o.tone === "bad" ? "bg-destructive" : "bg-emerald-500")
                    }
                  />
                  <span>{o.text}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Segment behavior
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Segment</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Bounce</TableHead>
                <TableHead className="text-right">Avg scroll</TableHead>
                <TableHead className="text-right">Avg time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.segments.map((s) => (
                <Row key={s.source} s={s} baseline={data.baseline} />
              ))}
              <TableRow className="border-t-2">
                <TableCell className="font-medium text-muted-foreground">Site-wide</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {data.totalSessions.toLocaleString()}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtPct(data.baseline.bounceRate, 1)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtPct(data.baseline.avgScrollPct, 100)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {fmtDuration(data.baseline.avgDurationMs)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ s, baseline }: { s: SegmentBehavior; baseline: SegmentBaseline }) {
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{s.label}</span>
        <span className="ml-2 text-xs text-muted-foreground tabular-nums">
          {Math.round(s.share * 100)}%
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{s.sessions.toLocaleString()}</TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtPct(s.bounceRate, 1)}
        <Delta value={s.bounceRate} base={baseline.bounceRate} scale={1} higherIsBad />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {fmtPct(s.avgScrollPct, 100)}
        <Delta value={s.avgScrollPct} base={baseline.avgScrollPct} scale={100} />
      </TableCell>
      <TableCell className="text-right tabular-nums">{fmtDuration(s.avgDurationMs)}</TableCell>
    </TableRow>
  );
}

// Small signed delta vs the site baseline, in percentage points. `higherIsBad`
// flips the color (a higher bounce rate is bad; deeper scroll is good).
function Delta({
  value,
  base,
  scale,
  higherIsBad = false,
}: {
  value: number | null;
  base: number | null;
  scale: number;
  higherIsBad?: boolean;
}) {
  if (value == null || base == null) return null;
  const dPts = Math.round((value - base) * scale);
  if (dPts === 0) return null;
  const good = higherIsBad ? dPts < 0 : dPts > 0;
  return (
    <span className={"ml-1.5 text-xs " + (good ? "text-emerald-600" : "text-destructive")}>
      {dPts > 0 ? "+" : ""}
      {dPts}
    </span>
  );
}

function fmtPct(x: number | null, scale: number): string {
  if (x == null) return "—";
  return `${Math.round(x * scale)}%`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
