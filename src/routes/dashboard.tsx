// /dashboard — the customer dashboard (blueprint Step 8).
//
// Five views over a site's data: Overview, Visitor Segments, Live Adaptations,
// Performance, and Content Inventory. Data comes from getDashboard (server
// function → Supabase via service role), aggregated by src/lib/dashboard.
// When the DB is unavailable (e.g. local dev without a service-role key) the
// dashboard renders a clean empty state.

import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, MousePointerClick, Eye, Users, Target, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDashboard, type DashboardResponse } from "@/lib/dashboard/dashboard.functions";
import type { SegmentBar } from "@/lib/dashboard/aggregate";

const dashboardQuery = (site: string) =>
  queryOptions({
    queryKey: ["dashboard", site],
    queryFn: () => getDashboard({ data: { site } }),
  });

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Angel Adaptive — Dashboard" },
      { name: "description", content: "Per-site performance of the Angel Adaptive layer." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery("demo")),
  component: Dashboard,
});

function Dashboard() {
  const [site, setSite] = useState("demo");
  const { data, isFetching } = useQuery(dashboardQuery(site));

  if (!data) return null;
  const d: DashboardResponse = data;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <Sparkles className="h-6 w-6 text-violet-600" /> Angel Adaptive
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Per-site performance of the adaptive layer.
              {isFetching && <span className="ml-2 animate-pulse">updating…</span>}
            </p>
          </div>
          <Select value={site} onValueChange={setSite}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="Select site" />
            </SelectTrigger>
            <SelectContent>
              {d.sites.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.name ?? s.slug}
                  {s.domain ? ` (${s.domain})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        {!d.dbAvailable && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No analytics store reached — showing an empty state. Events populate once the snippet
            runs and the server has <code>SUPABASE_SERVICE_ROLE_KEY</code> set (Netlify →
            Environment variables).
          </div>
        )}

        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="segments">Visitor Segments</TabsTrigger>
            <TabsTrigger value="live">Live Adaptations</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="inventory">Content Inventory</TabsTrigger>
          </TabsList>

          {/* ---- Overview ---- */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi icon={<Eye />} label="Pageviews" value={d.metrics.overview.pageviews} />
              <Kpi
                icon={<Users />}
                label="Unique visitors"
                value={d.metrics.overview.uniqueVisitors}
              />
              <Kpi
                icon={<Activity />}
                label="Adaptations shown"
                value={d.metrics.overview.adaptationsShown}
              />
              <Kpi
                icon={<MousePointerClick />}
                label="CTA clicks"
                value={d.metrics.overview.ctaClicks}
              />
              <Kpi icon={<Target />} label="Conversions" value={d.metrics.overview.conversions} />
              <Kpi
                icon={<Sparkles />}
                label="Conversion rate"
                value={`${(d.metrics.overview.conversionRate * 100).toFixed(1)}%`}
              />
            </div>
          </TabsContent>

          {/* ---- Visitor Segments ---- */}
          <TabsContent value="segments" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By traffic source</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byTrafficSource} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By device</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byDevice} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By country</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byCountry} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By browser</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byBrowser} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By language</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byLanguage} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">By campaign</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byCampaign} empty="No campaigns yet." />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ---- Live Adaptations ---- */}
          <TabsContent value="live" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent adaptations</CardTitle>
              </CardHeader>
              <CardContent>
                {d.metrics.liveAdaptations.length === 0 ? (
                  <Empty>No adaptations recorded yet.</Empty>
                ) : (
                  <ul className="divide-y divide-border">
                    {d.metrics.liveAdaptations.map((a, i) => (
                      <li
                        key={`${a.decisionId}-${i}`}
                        className="flex flex-wrap items-center gap-2 py-3"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {a.decisionId || "—"}
                        </span>
                        {a.trafficSource && <Badge variant="secondary">{a.trafficSource}</Badge>}
                        {a.device && <Badge variant="outline">{a.device}</Badge>}
                        <span className="flex flex-wrap gap-1">
                          {a.patterns.map((p) => (
                            <Badge
                              key={p}
                              className="bg-violet-100 font-mono text-[11px] text-violet-800"
                            >
                              {p}
                            </Badge>
                          ))}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {new Date(a.at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Performance ---- */}
          <TabsContent value="performance" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Adaptations by frequency</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  items={d.metrics.performance.map((p) => ({ key: p.pattern, pageviews: p.shown }))}
                  empty="No adaptations shown yet."
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Content Inventory ---- */}
          <TabsContent value="inventory" className="mt-4">
            {d.metrics.inventory.length === 0 ? (
              <Card>
                <CardContent className="py-6">
                  <Empty>No content inventory for this site yet.</Empty>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {d.metrics.inventory.map((group) => (
                  <Card key={group.slot}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <span className="font-mono">{group.slot}</span>
                        <Badge variant="outline">{group.items.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {group.items.map((item) => (
                          <li key={item.id} className="rounded border border-border p-2 text-sm">
                            <div className="font-medium text-foreground">
                              {item.text ?? (
                                <span className="italic text-muted-foreground">
                                  (no text — DOM slot)
                                </span>
                              )}
                            </div>
                            {item.selector && (
                              <div className="font-mono text-xs text-muted-foreground">
                                {item.selector}
                              </div>
                            )}
                            {Object.keys(item.meta).length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {Object.entries(item.meta).map(([k, v]) => (
                                  <Badge key={k} variant="secondary" className="text-[11px]">
                                    {k}: {v}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100 text-violet-700 [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-foreground">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function BarList({ items, empty }: { items: SegmentBar[]; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  const max = Math.max(...items.map((i) => i.pageviews), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.key} className="text-sm">
          <div className="mb-1 flex justify-between">
            <span className="font-medium text-foreground">{item.key}</span>
            <span className="text-muted-foreground">{item.pageviews}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-violet-500"
              style={{ width: `${(item.pageviews / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}
