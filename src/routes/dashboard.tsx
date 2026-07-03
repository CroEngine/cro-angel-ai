// /dashboard — the customer dashboard (blueprint Step 8).
//
// Five views over a site's data: Overview, Visitor Segments, Live Adaptations,
// Performance, and Content Inventory. Data comes from getDashboard (server
// function → Supabase via service role), aggregated by src/lib/dashboard.
// When the DB is unavailable (e.g. local dev without a service-role key) the
// dashboard renders a clean empty state.

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  MousePointerClick,
  Eye,
  Users,
  Target,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Shield,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createSite,
  getDashboard,
  getVisitorTimeline,
  rotateIngestKey,
  setConsentMode,
  type ConsentMode,
  type DashboardResponse,
  type SiteConfigView,
  type TimelineEvent,
} from "@/lib/dashboard/dashboard.functions";
import type {
  SegmentBar,
  PatternAttribution,
  DayPoint,
  HourPoint,
  VisitorSummary,
} from "@/lib/dashboard/aggregate";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

const dashboardQuery = (site: string) => {
  // Buckets read as the owner's local wall-clock, not UTC. Part of the key so a
  // server-rendered fetch (offset 0) never masks the client's.
  const tzOffsetMinutes = typeof window === "undefined" ? 0 : new Date().getTimezoneOffset();
  return queryOptions({
    queryKey: ["dashboard", site, tzOffsetMinutes],
    queryFn: () => getDashboard({ data: { site, tzOffsetMinutes } }),
  });
};

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Angel Adaptive — Dashboard" },
      { name: "description", content: "Per-site performance of the Angel Adaptive layer." },
    ],
  }),
  // Client-only UX gate: send unauthenticated users to /login. The session lives
  // in localStorage (invisible during SSR), so we only check in the browser; the
  // real protection is server-side (requireSupabaseAuth on every dashboard
  // server-fn), so an unauthenticated request still can't read any data.
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const [site, setSite] = useState("demo");
  const { data, isFetching } = useQuery(dashboardQuery(site));

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  // If the selected site isn't in the list (e.g. the seeded "demo" was cleaned
  // up), fall over to the first real site so the picker never shows a ghost.
  const sites = data?.sites ?? [];
  useEffect(() => {
    if (sites.length > 0 && !sites.some((s) => s.slug === site)) {
      setSite(sites[0].slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return null;
  const d: DashboardResponse = data;
  // The snippet is "installed" once the site has reported any traffic —
  // exposures are server-logged for all visitors (anonymous included), and
  // pageviews cover consented-only history older than the exposure events.
  const installed =
    d.metrics.timeseries.daily.some((p) => p.visits > 0) || d.metrics.overview.pageviews > 0;

  return (
    <div className="min-h-screen bg-[#fafaf9] px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <span className="text-2xl leading-none text-emerald-700">✳</span> Angel
            </h1>
            <p className="mt-1 font-mono text-[11px] tracking-wider text-stone-400">
              [ per-site performance of the adaptive layer ]
              {isFetching && <span className="ml-2 animate-pulse">updating…</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {d.sites.length > 0 && (
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
            )}
            <AddSiteControl onCreated={(slug) => setSite(slug)} />
            {d.sites.length > 0 && (
              <SettingsControl
                site={site}
                config={d.siteConfig}
                disabled={!d.dbAvailable}
              />
            )}
            <AccountControl />
            <Button variant="outline" size="sm" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </header>

        {d.sites.length === 0 ? (
          <Card className="border-stone-200 shadow-none">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Add your first site</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Give your site a short id. You&apos;ll get an install snippet to paste once —
                  then this dashboard fills with its adaptations and measured lift.
                </p>
              </div>
              <AddSiteControl onCreated={(slug) => setSite(slug)} primary />
            </CardContent>
          </Card>
        ) : (
          <>
        {/* Onboarding only: once the snippet reports traffic the install card
            retires to Settings and the dashboard is just the product. Hidden
            when the store is unreachable — "no data" isn't "not installed",
            and the fallback config would render the wrong (keyless) tag. */}
        {d.dbAvailable && !installed && (
          <InstallCard site={site} ingestKey={d.siteConfig.ingestKey} />
        )}

        <MeasurementControl
          config={d.siteConfig}
          ctas={(d.metrics.inventory.find((g) => g.slot === "cta")?.items ?? []).filter(
            (i) => i.text && i.selector,
          )}
        />

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
            <TabsTrigger value="visitors">Visitors</TabsTrigger>
            <TabsTrigger value="segments">Visitor Segments</TabsTrigger>
            <TabsTrigger value="live">Live Adaptations</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="attribution">What&apos;s working</TabsTrigger>
            <TabsTrigger value="inventory">Content Inventory</TabsTrigger>
          </TabsList>

          {/* ---- Overview ---- */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <TrafficChart daily={d.metrics.timeseries.daily} hourly={d.metrics.timeseries.hourly} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Kpi icon={<Eye />} label="Pageviews" value={d.metrics.overview.pageviews} />
              <Kpi
                icon={<Users />}
                label="Identified visitors"
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

          {/* ---- Visitors (identified) ---- */}
          <TabsContent value="visitors" className="mt-4">
            {/* key: switching sites resets the selected-visitor dialog state */}
            <VisitorsPanel key={site} site={site} visitors={d.metrics.visitors} />
          </TabsContent>

          {/* ---- Visitor Segments ---- */}
          <TabsContent value="segments" className="mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-stone-200 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">By traffic source</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byTrafficSource} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card className="border-stone-200 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">By device</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byDevice} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card className="border-stone-200 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">By country</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byCountry} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card className="border-stone-200 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">By browser</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byBrowser} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card className="border-stone-200 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">By language</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList items={d.metrics.segments.byLanguage} empty="No pageviews yet." />
                </CardContent>
              </Card>
              <Card className="border-stone-200 shadow-none">
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
            <Card className="border-stone-200 shadow-none">
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
                              className="bg-emerald-50 font-mono text-[11px] text-emerald-800"
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
            <Card className="border-stone-200 shadow-none">
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

          {/* ---- What's working (attribution) ---- */}
          <TabsContent value="attribution" className="mt-4">
            <Card className="border-stone-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ lift ]</span>
                  Conversion lift by pattern
                </CardTitle>
              </CardHeader>
              <CardContent>
                {d.metrics.attribution.length === 0 ? (
                  <Empty>No attributable exposures yet.</Empty>
                ) : (
                  <>
                    <AttributionTable rows={d.metrics.attribution} />
                    <p className="mt-3 text-xs text-muted-foreground">
                      Lift compares the adapted group to the withheld control group
                      (enable a holdout with <code>data-holdout</code> on the snippet). A
                      conversion counts for a pattern when the same visitor converts within
                      24 h of being exposed. <strong>sig.</strong> marks a difference at ~95%
                      confidence.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---- Content Inventory ---- */}
          <TabsContent value="inventory" className="mt-4">
            {d.metrics.inventory.length === 0 ? (
              <Card className="border-stone-200 shadow-none">
                <CardContent className="py-6">
                  <Empty>No content inventory for this site yet.</Empty>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {d.metrics.inventory.map((group) => (
                  <Card key={group.slot} className="border-stone-200 shadow-none">
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
          </>
        )}
      </div>
    </div>
  );
}

/** The one durable install tag for a site. Strips deploy-preview origins so a
 *  dashboard opened on a preview never hands out an ephemeral URL. */
function buildSnippet(site: string, ingestKey: string | null): string {
  const origin = (typeof window !== "undefined" ? window.location.origin : "").replace(
    /^https:\/\/deploy-preview-\d+--/,
    "https://",
  );
  const keyAttr = ingestKey ? ` data-key="${ingestKey}"` : "";
  return `<script async src="${origin}/adaptive.js" data-site="${site}"${keyAttr}></script>`;
}

/** Per-site settings dialog: the install tag (with password-guarded key
 *  rotation) and the visitor-information terms. Lives in the header so the
 *  dashboard itself stays pure product. */
function SettingsControl({
  site,
  config,
  disabled,
}: {
  site: string;
  config: SiteConfigView;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-[11px] tracking-wider text-emerald-700">
              [ settings ]
            </span>
            {site}
          </DialogTitle>
          <DialogDescription>
            Install tag, security and data terms for this site.
          </DialogDescription>
        </DialogHeader>
        {disabled ? (
          // The fallback config is a default, not this site's truth — showing
          // it here would present a keyless tag and "paused" terms as fact.
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            The data store can&apos;t be reached right now, so this site&apos;s settings can&apos;t
            be shown. Try again in a moment.
          </p>
        ) : (
          <div className="space-y-6">
            <InstallSection site={site} ingestKey={config.ingestKey} />
            <ConsentSection site={site} mode={config.consentMode} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InstallSection({ site, ingestKey }: { site: string; ingestKey: string | null }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pw, setPw] = useState("");

  const snippet = buildSnippet(site, ingestKey);

  // The password travels WITH the rotation request — it's verified server-side
  // in rotateIngestKey, so the gate can't be bypassed by calling the endpoint
  // directly with a stolen session.
  const rotate = useMutation({
    mutationFn: (password: string) => rotateIngestKey({ data: { site, password } }),
    onSuccess: (res) => {
      if (res.ok) {
        setConfirming(false);
        setPw("");
        queryClient.invalidateQueries({ queryKey: ["dashboard", site] });
      }
    },
  });

  const rotateError = rotate.isError
    ? "Couldn't reach the server — try again."
    : rotate.data?.ok === false
      ? rotate.data.reason === "password"
        ? "Wrong password."
        : "Couldn't verify right now — try again in a moment."
      : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ install ]</span>
        {!ingestKey && (
          <Badge variant="secondary" className="text-[11px]">
            unkeyed — writes open
          </Badge>
        )}
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-foreground">
        {snippet}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          {copied ? "Copied" : "Copy snippet"}
        </Button>
        {!confirming && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              rotate.reset();
              setConfirming(true);
            }}
            disabled={rotate.isPending}
          >
            {rotate.isPending ? "Rotating…" : ingestKey ? "Rotate key" : "Generate key"}
          </Button>
        )}
      </div>
      {confirming && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            rotate.mutate(pw);
          }}
          className="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-3"
        >
          <p className="text-xs text-amber-900">
            {ingestKey
              ? "Rotating invalidates the current key — the tag on your site must be updated or its data stops. Enter your password to confirm."
              : "Generating a key locks writes to this site. Enter your password to confirm."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              className="h-8 w-48 bg-white text-sm"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />
            <Button
              type="submit"
              size="sm"
              className="bg-emerald-700 text-white hover:bg-emerald-600"
              disabled={rotate.isPending || pw.length === 0}
            >
              {rotate.isPending ? "Checking…" : "Confirm"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-stone-500"
              onClick={() => {
                setConfirming(false);
                setPw("");
                rotate.reset();
              }}
            >
              Cancel
            </Button>
          </div>
          {rotateError && <p className="text-xs text-rose-600">{rotateError}</p>}
        </form>
      )}
      <p className="text-xs text-muted-foreground">
        Paste once on the site — it never needs updating. Changes you make here apply
        automatically.
      </p>
    </section>
  );
}

/** 'attested' = collecting visitor information (on); 'anonymous' = paused. The
 *  lawful-basis acknowledgment happens once at signup, so this is just an
 *  on/pause switch filed under the account's terms. */
function ConsentSection({ site, mode }: { site: string; mode: ConsentMode }) {
  const queryClient = useQueryClient();
  const on = mode === "attested";

  const mutation = useMutation({
    mutationFn: (next: ConsentMode) => setConsentMode({ data: { site, mode: next } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });

  return (
    <section className="space-y-2">
      <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ terms ]</span>
      <div
        className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${
          on ? "border-emerald-300 bg-emerald-50/50" : "border-stone-200"
        }`}
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
            on ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
          } [&>svg]:h-4 [&>svg]:w-4`}
        >
          {on ? <ShieldCheck /> : <Shield />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Visitor information</span>
            <Badge
              variant="secondary"
              className={`font-mono text-[11px] tracking-wider ${
                on ? "bg-emerald-700 text-white hover:bg-emerald-700" : ""
              }`}
            >
              {on ? "on" : "paused"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {on
              ? "Angel uses a persistent visitor id and conversion events on this site to measure lift. Visitors who signal GPC or Do Not Track are always excluded."
              : "Paused — Angel adapts the page but stores no visitor id and records no events, so lift isn't measured on this site."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mutation.isPending && <span className="text-xs text-muted-foreground">saving…</span>}
          {mutation.data?.ok === false && <span className="text-xs text-rose-600">save failed</span>}
          <Switch
            className="data-[state=checked]:bg-emerald-700"
            checked={on}
            disabled={mutation.isPending}
            onCheckedChange={(next) => mutation.mutate(next ? "attested" : "anonymous")}
            aria-label="Collect visitor information on this site"
          />
        </div>
      </div>
    </section>
  );
}

function AccountControl() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: { email?: string } | null } }) =>
      setEmail(data.user?.email ?? null),
    );
  }, []);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pw.length < 8) {
      setError("At least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
    setPw("");
    setPw2("");
    setTimeout(() => {
      setDone(false);
      setOpen(false);
    }, 1200);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), setError(null), setDone(false))}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-[11px] tracking-wider text-emerald-700">
              [ account ]
            </span>
            {email ?? "…"}
          </DialogTitle>
          <DialogDescription>Change the password you sign in with.</DialogDescription>
        </DialogHeader>
        <form onSubmit={changePassword} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-pw" className="text-xs">
              New password
            </Label>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw2" className="text-xs">
              Repeat new password
            </Label>
            <Input
              id="new-pw2"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {done && <p className="text-sm text-emerald-700">Password changed.</p>}
          <DialogFooter>
            <Button
              type="submit"
              className="bg-emerald-700 text-white hover:bg-emerald-600"
              disabled={busy || done}
            >
              {busy ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddSiteControl({
  onCreated,
  primary,
}: {
  onCreated: (slug: string) => void;
  primary?: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createSite({ data: { slug: slug.trim(), name: name.trim(), domain: domain.trim() } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setError(res.reason === "taken" ? "That id is already taken." : "Couldn't create the site.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated(res.slug!);
      setOpen(false);
      setSlug("");
      setName("");
      setDomain("");
      setError(null);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={primary ? "default" : "outline"}>
          Add site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a site</DialogTitle>
          <DialogDescription>
            Pick a short id (letters, digits, . _ -). If a snippet already reported this id, you&apos;ll claim it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-slug" className="text-xs">
              Site id
            </Label>
            <Input
              id="new-slug"
              placeholder="acme.com"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="new-name" className="text-xs">
                Name (optional)
              </Label>
              <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-domain" className="text-xs">
                Domain (optional)
              </Label>
              <Input
                id="new-domain"
                placeholder="acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            className="bg-emerald-700 text-white hover:bg-emerald-600"
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            disabled={!slug.trim() || mutation.isPending}
          >
            {mutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Onboarding-only card: shown until the snippet reports its first traffic,
 *  then the tag retires to Settings. Copy is the only action — key rotation is
 *  a security operation and lives behind the password check in Settings. */
function InstallCard({ site, ingestKey }: { site: string; ingestKey: string | null }) {
  const [copied, setCopied] = useState(false);
  const snippet = buildSnippet(site, ingestKey);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <Card className="border-stone-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ install ]</span>
          <span className="text-sm font-normal text-muted-foreground">
            one tag, paste once — this card disappears when your first visit arrives
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-foreground">
          {snippet}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? "Copied" : "Copy snippet"}
          </Button>
          <p className="ml-auto text-xs text-muted-foreground">
            It never needs updating — changes in the dashboard apply automatically.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MeasurementControl({
  config,
  ctas,
}: {
  config: SiteConfigView;
  ctas: { id: string; text: string | null; selector: string | null }[];
}) {
  // Read-only by design: the goal and control group are chosen automatically —
  // there's nothing for the owner to configure. Resolve the goal selector to the
  // button's human text when we harvested it, otherwise fall back to the raw
  // selector / URL.
  const goalCta = ctas.find((c) => c.selector === config.conversionSelector);
  const goalLabel = goalCta?.text
    ? `“${goalCta.text}”`
    : config.conversionSelector
      ? config.conversionSelector
      : config.conversionUrl
        ? `visiting ${config.conversionUrl}`
        : null;
  const paused = config.consentMode !== "attested";

  return (
    <Card className="border-stone-200 shadow-none">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
        <span className="font-mono text-[11px] tracking-wider text-emerald-700">
          [ measurement ]
        </span>
        {goalLabel ? (
          <span className="text-sm text-stone-700">
            Measuring conversions to <strong>{goalLabel}</strong> against a{" "}
            {config.holdoutPct || 12}% control group — chosen automatically, nothing to set up.
          </span>
        ) : (
          <span className="text-sm text-stone-500">
            Angel picks your conversion goal automatically from your site&apos;s buttons after the
            first visits, then measures it against a {config.holdoutPct || 12}% control group.
          </span>
        )}
        {paused && (
          <span className="font-mono text-[11px] tracking-wider text-amber-600">
            · paused — turn on visitor information in Settings to measure
          </span>
        )}
      </CardContent>
    </Card>
  );
}

// ---- visitors over time -------------------------------------------------------

const CHART_TICK = { fontSize: 11, fontFamily: "ui-monospace, monospace", fill: "#a8a29e" };
const CHART_TOOLTIP_STYLE = {
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  border: "1px solid #e7e5e4",
  borderRadius: 8,
  background: "#fff",
  boxShadow: "none",
};

function LegendChip({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-stone-500">
      <span className={`h-2 w-2 rounded-full ${swatch}`} />
      {label}
    </span>
  );
}

function TrafficChart({ daily, hourly }: { daily: DayPoint[]; hourly: HourPoint[] }) {
  const [mode, setMode] = useState<"day" | "hour">("day");
  const hasData = daily.some((p) => p.visits > 0 || p.identified > 0 || p.conversions > 0);
  // A 1–2 point line/area is invisible without dots.
  const showDots = daily.length < 3;

  return (
    <Card className="border-stone-200 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
          <span className="font-mono text-[11px] tracking-wider text-emerald-700">
            [ visitors over time ]
          </span>
          <span className="flex flex-wrap items-center gap-3">
            <LegendChip swatch="bg-stone-300" label="page loads" />
            <LegendChip swatch="bg-emerald-300" label="identified visitors" />
            <LegendChip swatch="bg-emerald-700" label="conversions" />
          </span>
          <span className="ml-auto flex overflow-hidden rounded-md border border-stone-200">
            {(["day", "hour"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 font-mono text-[11px] tracking-wider transition ${
                  mode === m
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-500 hover:bg-stone-50"
                }`}
              >
                {m === "day" ? "by day" : "time of day"}
              </button>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <Empty>No traffic recorded yet — the chart fills as the snippet runs.</Empty>
        ) : mode === "day" ? (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
              <XAxis
                dataKey="day"
                tick={CHART_TICK}
                tickFormatter={(day: string) => day.slice(5)}
                tickLine={false}
                axisLine={{ stroke: "#e7e5e4" }}
              />
              <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Area
                type="monotone"
                dataKey="visits"
                name="page loads"
                stroke="#a8a29e"
                fill="#e7e5e4"
                fillOpacity={0.6}
                strokeWidth={1.5}
                dot={showDots}
              />
              <Area
                type="monotone"
                dataKey="identified"
                name="identified visitors"
                stroke="#059669"
                fill="#a7f3d0"
                fillOpacity={0.45}
                strokeWidth={1.5}
                dot={showDots}
              />
              <Line
                type="monotone"
                dataKey="conversions"
                name="conversions"
                stroke="#047857"
                strokeWidth={2}
                dot={showDots}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
              <XAxis
                dataKey="hour"
                tick={CHART_TICK}
                tickFormatter={(h: number) => `${h}`}
                tickLine={false}
                axisLine={{ stroke: "#e7e5e4" }}
              />
              <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                labelFormatter={(h) => `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`}
              />
              <Bar dataKey="visits" name="page loads" fill="#d6d3d1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="identified" name="identified visitors" fill="#059669" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {hasData && mode === "day" && (
          <p className="mt-2 font-mono text-[10px] tracking-wide text-stone-400">
            PAGE LOADS COUNT ALL TRAFFIC · IDENTIFIED VISITORS ARE THE CONSENTED SUBSET WITH A
            VISITOR ID · TIMES IN YOUR LOCAL TIMEZONE
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---- per-visitor drilldown ------------------------------------------------------

/** Human line for one timeline event; tone picks the dot colour. */
function describeEvent(e: TimelineEvent): { label: string; detail: string | null; dot: string } {
  const p = e.payload;
  const patterns = Array.isArray(p.patterns)
    ? (p.patterns as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  switch (e.type) {
    case "pageview": {
      const bits = [p.trafficSource, p.device, p.browser, p.country]
        .map((v) => (typeof v === "string" && v ? v : null))
        .filter(Boolean);
      return { label: "Page view", detail: bits.join(" · ") || null, dot: "bg-stone-400" };
    }
    case "adaptation_shown":
      return {
        label: "Adaptations applied",
        detail: patterns.join(", ") || "(none this page)",
        dot: "bg-emerald-500",
      };
    case "adaptation_withheld":
      return {
        label: "Control group — adaptations withheld",
        detail: patterns.join(", ") || null,
        dot: "bg-amber-400",
      };
    case "cta_click":
      return {
        label: "Clicked CTA",
        detail: typeof p.text === "string" ? `“${p.text}”` : null,
        dot: "bg-emerald-600",
      };
    case "scroll_depth":
      return {
        label: `Scrolled ${typeof p.depth === "number" ? p.depth : "?"}% of the page`,
        detail: null,
        dot: "bg-stone-300",
      };
    case "conversion":
      // The server already strips owner-supplied conversion meta down to the
      // numeric value; only that is shown.
      return {
        label: "Converted",
        detail: typeof p.value === "number" ? `value ${p.value}` : null,
        dot: "bg-emerald-700",
      };
    default:
      return { label: e.type, detail: null, dot: "bg-stone-300" };
  }
}

function ArmBadge({ arm }: { arm: VisitorSummary["arm"] }) {
  if (!arm) return <span className="text-xs text-stone-400">—</span>;
  if (arm === "control")
    return (
      <Badge variant="outline" className="font-mono text-[10px] tracking-wider text-amber-700">
        control
      </Badge>
    );
  return (
    <Badge className="bg-emerald-50 font-mono text-[10px] tracking-wider text-emerald-800 hover:bg-emerald-50">
      {arm}
    </Badge>
  );
}

function VisitorTimeline({ site, visitor }: { site: string; visitor: VisitorSummary }) {
  const { data, isPending } = useQuery({
    queryKey: ["visitor-timeline", site, visitor.hash],
    queryFn: () => getVisitorTimeline({ data: { site, visitorHash: visitor.hash } }),
  });

  if (isPending) {
    return <p className="py-6 text-center text-sm text-stone-400">loading history…</p>;
  }
  if (!data?.ok) {
    return <p className="py-6 text-center text-sm text-rose-600">Couldn&apos;t load this visitor.</p>;
  }
  return (
    <ol className="max-h-[55vh] space-y-0 overflow-y-auto pr-1">
      {data.events.map((e) => {
        const { label, detail, dot } = describeEvent(e);
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
            <span className="relative flex flex-col items-center">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
              <span className="mt-1 w-px flex-1 bg-stone-200" />
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium text-stone-800">{label}</span>
                <span className="font-mono text-[10px] tracking-wider text-stone-400">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              {detail && <p className="mt-0.5 text-xs text-stone-500">{detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function VisitorsPanel({ site, visitors }: { site: string; visitors: VisitorSummary[] }) {
  const [selected, setSelected] = useState<VisitorSummary | null>(null);

  return (
    <Card className="border-stone-200 shadow-none">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="font-mono text-[11px] tracking-wider text-emerald-700">
            [ visitors ]
          </span>
          Identified visitors
          <span className="text-xs font-normal text-muted-foreground">
            — consented visitors with a visitor id. Anonymous visitors are unlinkable by design.
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {visitors.length === 0 ? (
          <Empty>
            No identified visitors yet — they appear once visitor information is on and the
            snippet runs.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Visitor</th>
                  <th className="py-2 pr-3 font-medium">Last seen</th>
                  <th className="py-2 pr-3 font-medium">Context</th>
                  <th className="py-2 pr-3 text-right font-medium">Pages</th>
                  <th className="py-2 pr-3 text-right font-medium">Clicks</th>
                  <th className="py-2 pr-3 text-right font-medium">Scroll</th>
                  <th className="py-2 pr-3 font-medium">Arm</th>
                  <th className="py-2 text-right font-medium">Converted</th>
                </tr>
              </thead>
              <tbody>
                {visitors.map((v) => (
                  <tr
                    key={v.hash}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open activity for visitor ${v.hash.slice(0, 8)}`}
                    onClick={() => setSelected(v)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(v);
                      }
                    }}
                    className="cursor-pointer border-b border-border/60 transition hover:bg-stone-50 focus-visible:bg-stone-50 focus-visible:outline-none"
                  >
                    <td className="py-2 pr-3">
                      <span className="font-mono text-[12px] text-emerald-800">
                        {v.hash.slice(0, 8)}…
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {new Date(v.lastSeen).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {[v.trafficSource, v.device, v.country].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3 text-right text-stone-700">{v.pageviews}</td>
                    <td className="py-2 pr-3 text-right text-stone-700">{v.ctaClicks}</td>
                    <td className="py-2 pr-3 text-right text-stone-700">
                      {v.maxScroll > 0 ? `${v.maxScroll}%` : "—"}
                    </td>
                    <td className="py-2 pr-3">
                      <ArmBadge arm={v.arm} />
                    </td>
                    <td className="py-2 text-right">
                      {v.conversions > 0 ? (
                        <Badge className="bg-emerald-700 font-mono text-[10px] text-white hover:bg-emerald-700">
                          ✓ {v.conversions}
                        </Badge>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 font-mono text-[10px] tracking-wide text-stone-400">
              CLICK A ROW TO REPLAY THAT VISITOR&apos;S EXACT ACTIVITY · RANDOM PSEUDONYMOUS IDS —
              ANGEL NEVER COLLECTS NAMES, EMAILS OR IP ADDRESSES ITSELF
            </p>
          </div>
        )}

        <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-lg">
            {selected && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] tracking-wider text-emerald-700">
                      [ visitor ]
                    </span>
                    <span className="font-mono text-sm">{selected.hash.slice(0, 12)}…</span>
                    <ArmBadge arm={selected.arm} />
                    {selected.conversions > 0 && (
                      <Badge className="bg-emerald-700 font-mono text-[10px] text-white hover:bg-emerald-700">
                        converted
                      </Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    First seen {new Date(selected.firstSeen).toLocaleString()}
                    {selected.patterns.length > 0 &&
                      ` · exposed to: ${selected.patterns.join(", ")}`}
                  </DialogDescription>
                </DialogHeader>
                <VisitorTimeline site={site} visitor={selected} />
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
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
    <Card className="border-stone-200 shadow-none">
      <CardContent className="py-5">
        <div className="font-['Sora','Manrope',sans-serif] text-2xl font-semibold text-emerald-700">
          {value}
        </div>
        <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-stone-400">
          {label}
        </div>
        <span className="hidden">{icon}</span>
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
              className="h-full rounded-full bg-emerald-600"
              style={{ width: `${(item.pageviews / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function AttributionTable({ rows }: { rows: PatternAttribution[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Pattern</th>
            <th className="py-2 pr-3 text-right font-medium">Adapted</th>
            <th className="py-2 pr-3 text-right font-medium">CR</th>
            <th className="py-2 pr-3 text-right font-medium">Control</th>
            <th className="py-2 pr-3 text-right font-medium">CR</th>
            <th className="py-2 pr-3 text-right font-medium">Lift</th>
            <th className="py-2 text-right font-medium">Sig.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pattern} className="border-b border-border/60">
              <td className="py-2 pr-3">
                <span className="font-mono text-[13px] text-foreground">{r.pattern}</span>
              </td>
              <td className="py-2 pr-3 text-right text-muted-foreground">
                {r.adapted.conversions}/{r.adapted.exposures}
              </td>
              <td className="py-2 pr-3 text-right font-medium text-foreground">
                {r.adapted.exposures > 0 ? pct(r.adapted.rate) : "—"}
              </td>
              <td className="py-2 pr-3 text-right text-muted-foreground">
                {r.control.exposures > 0 ? `${r.control.conversions}/${r.control.exposures}` : "—"}
              </td>
              <td className="py-2 pr-3 text-right text-muted-foreground">
                {r.control.exposures > 0 ? pct(r.control.rate) : "—"}
              </td>
              <td className="py-2 pr-3 text-right">
                {r.lift === null ? (
                  <span className="text-muted-foreground">no control</span>
                ) : (
                  <span
                    className={
                      r.lift > 0
                        ? "font-semibold text-emerald-600"
                        : r.lift < 0
                          ? "font-semibold text-rose-600"
                          : "text-muted-foreground"
                    }
                  >
                    {r.lift > 0 ? "+" : ""}
                    {(r.lift * 100).toFixed(1)} pp
                  </span>
                )}
              </td>
              <td className="py-2 text-right">
                {r.significant ? (
                  <Badge className="bg-emerald-100 text-[11px] text-emerald-800">95%</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}
