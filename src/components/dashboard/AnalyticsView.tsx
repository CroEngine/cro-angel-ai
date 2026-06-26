// Learn-Mode analytics for one site: stat cards, a sessions-over-time area chart,
// simple breakdown bars (source / device / country), and a recent-sessions table.
// Reads aggregated session dimensions from getSiteAnalytics (RLS-scoped).

import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, XAxis } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getSiteAnalytics } from "@/lib/dashboard.functions";

const areaConfig = {
  sessions: { label: "Sessions", color: "var(--primary)" },
} satisfies ChartConfig;

export function AnalyticsView({ siteId }: { siteId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", siteId],
    queryFn: () => getSiteAnalytics({ data: { siteId, days: 7 } }),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-48 sm:col-span-2" />
      </div>
    );
  }
  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="pt-6 text-sm text-destructive">
          Couldn’t load analytics: {(error as Error).message}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Sessions (7d)" value={data.totals.sessions} />
        <Stat label="Unique visitors (7d)" value={data.totals.visitors} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Sessions over time
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.totals.sessions === 0 ? (
            <EmptyHint />
          ) : (
            <ChartContainer config={areaConfig} className="aspect-auto h-48 w-full">
              <AreaChart data={data.byDay} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={fmtDay}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Area
                  dataKey="sessions"
                  type="natural"
                  stroke="var(--color-sessions)"
                  fill="var(--color-sessions)"
                  fillOpacity={0.18}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Breakdown title="By source" items={data.bySource} />
        <Breakdown title="By device" items={data.byDevice} />
        <Breakdown title="By country" items={data.byCountry} />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Recent sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <EmptyHint />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Scroll</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.source}</TableCell>
                    <TableCell>{s.device}</TableCell>
                    <TableCell>{s.country}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.scrollPct != null ? `${s.scrollPct}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtDuration(s.durationMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-3xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function Breakdown({ title, items }: { title: string; items: { name: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {items.length === 0 && <p className="text-xs text-muted-foreground">No data yet</p>}
        {items.map((i) => (
          <div key={i.name}>
            <div className="flex items-center justify-between text-xs">
              <span className="truncate">{i.name}</span>
              <span className="tabular-nums text-muted-foreground">{i.value}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded bg-primary"
                style={{ width: `${(i.value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyHint() {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      No sessions yet — install the snippet and traffic will appear here.
    </p>
  );
}

function fmtDay(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
