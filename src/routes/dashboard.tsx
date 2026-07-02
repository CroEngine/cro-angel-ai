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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  rotateIngestKey,
  setConsentMode,
  setMeasurementConfig,
  type ConsentMode,
  type DashboardResponse,
  type SiteConfigView,
} from "@/lib/dashboard/dashboard.functions";
import type { SegmentBar, PatternAttribution } from "@/lib/dashboard/aggregate";

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
        <InstallCard site={site} ingestKey={d.siteConfig.ingestKey} disabled={!d.dbAvailable} />

        <ConsentControl site={site} mode={d.siteConfig.consentMode} disabled={!d.dbAvailable} />

        <MeasurementControl
          site={site}
          config={d.siteConfig}
          ctas={(d.metrics.inventory.find((g) => g.slot === "cta")?.items ?? []).filter(
            (i) => i.text && i.selector,
          )}
          disabled={!d.dbAvailable}
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
            <TabsTrigger value="segments">Visitor Segments</TabsTrigger>
            <TabsTrigger value="live">Live Adaptations</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="attribution">What&apos;s working</TabsTrigger>
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

function ConsentControl({
  site,
  mode,
  disabled,
}: {
  site: string;
  mode: ConsentMode;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const attested = mode === "attested";

  const mutation = useMutation({
    mutationFn: (next: ConsentMode) => setConsentMode({ data: { site, mode: next } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });

  function onToggle(next: boolean) {
    if (next) {
      setConfirmOpen(true); // enabling is a legal attestation → confirm first
    } else {
      mutation.mutate("anonymous"); // withdrawing needs no attestation
    }
  }

  return (
    <Card className={attested ? "border-emerald-300 bg-emerald-50/50 shadow-none" : "border-stone-200 shadow-none"}>
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            attested ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
          } [&>svg]:h-5 [&>svg]:w-5`}
        >
          {attested ? <ShieldCheck /> : <Shield />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {attested ? "Full tracking (attested)" : "Anonymous mode"}
            </span>
            <Badge variant="secondary" className={`text-[11px] font-mono tracking-wider ${attested ? "bg-emerald-700 text-white hover:bg-emerald-700" : ""}`}>
              {attested ? "attested" : "anonymous"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {attested
              ? "Angel stores a persistent visitor id and measures conversion lift for this site. Visitors who signal GPC/DNT are still excluded automatically."
              : "Angel adapts the page but stores no persistent id and sends no behavioural events. Turn this on only if you have a lawful basis / visitor consent."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mutation.isPending && <span className="text-xs text-muted-foreground">saving…</span>}
          {mutation.data?.ok === false && (
            <span className="text-xs text-rose-600">save failed</span>
          )}
          <Switch
            className="data-[state=checked]:bg-emerald-700"
            checked={attested}
            disabled={disabled || mutation.isPending}
            onCheckedChange={onToggle}
            aria-label="Attest lawful basis for full tracking"
          />
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enable full tracking for this site?</AlertDialogTitle>
            <AlertDialogDescription>
              By turning this on you attest that you have a lawful basis — for example valid
              visitor consent under GDPR/ePrivacy — for Angel to store a persistent visitor
              identifier and measure conversions on <strong>{site}</strong>. You remain the data
              controller. Visitors who signal Global Privacy Control or Do Not Track are excluded
              automatically. You can withdraw this at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-emerald-700 text-white hover:bg-emerald-600" onClick={() => mutation.mutate("attested")}>
              I attest — enable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
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

function InstallCard({
  site,
  ingestKey,
  disabled,
}: {
  site: string;
  ingestKey: string | null;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  // The snippet URL must always be the durable production origin. A dashboard
  // opened on a Netlify deploy preview (deploy-preview-N--site.netlify.app)
  // would otherwise hand out a tag pinned to an ephemeral, frozen build.
  const origin = (typeof window !== "undefined" ? window.location.origin : "").replace(
    /^https:\/\/deploy-preview-\d+--/,
    "https://",
  );

  const rotate = useMutation({
    mutationFn: () => rotateIngestKey({ data: { site } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });

  const keyAttr = ingestKey ? ` data-key="${ingestKey}"` : "";
  const snippet = `<script async src="${origin}/adaptive.js" data-site="${site}"${keyAttr}></script>`;

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
          {!ingestKey && (
            <Badge variant="secondary" className="text-[11px]">
              unkeyed — writes open
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-foreground">
          {snippet}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={copy} disabled={disabled}>
            {copied ? "Copied" : "Copy snippet"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => rotate.mutate()}
            disabled={disabled || rotate.isPending}
          >
            {rotate.isPending ? "Rotating…" : ingestKey ? "Rotate key" : "Generate key"}
          </Button>
          {rotate.data?.ok === false && <span className="text-xs text-rose-600">failed</span>}
          <p className="ml-auto text-xs text-muted-foreground">
            Paste once on the site. {ingestKey ? "Rotating invalidates the old key — update the tag." : "Generate a key to lock writes to this site."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function MeasurementControl({
  site,
  config,
  ctas,
  disabled,
}: {
  site: string;
  config: SiteConfigView;
  ctas: { id: string; text: string | null; selector: string | null }[];
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [holdout, setHoldout] = useState(String(config.holdoutPct));
  const [convUrl, setConvUrl] = useState(config.conversionUrl ?? "");
  const [convSel, setConvSel] = useState(config.conversionSelector ?? "");

  // Re-sync the form when the selected site (or its saved config) changes.
  useEffect(() => {
    setHoldout(String(config.holdoutPct));
    setConvUrl(config.conversionUrl ?? "");
    setConvSel(config.conversionSelector ?? "");
  }, [site, config.holdoutPct, config.conversionUrl, config.conversionSelector]);

  const holdoutNum = Math.max(0, Math.min(100, parseInt(holdout, 10) || 0));
  const dirty =
    holdoutNum !== config.holdoutPct ||
    convUrl.trim() !== (config.conversionUrl ?? "") ||
    convSel.trim() !== (config.conversionSelector ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      setMeasurementConfig({
        data: {
          site,
          holdoutPct: holdoutNum,
          conversionUrl: convUrl.trim(),
          conversionSelector: convSel.trim(),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });

  // Zero-config default: collapsed confirmation line. The three raw fields are
  // an expert mode behind "Change" — most owners only ever confirm.
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [site]);
  const goalCta = ctas.find((c) => c.selector === config.conversionSelector);
  const goalLabel = goalCta?.text
    ? `“${goalCta.text}”`
    : config.conversionSelector
      ? config.conversionSelector
      : config.conversionUrl
        ? `visiting ${config.conversionUrl}`
        : null;

  if (!editing) {
    return (
      <Card className="border-stone-200 shadow-none">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
          <span className="font-mono text-[11px] tracking-wider text-emerald-700">
            [ measurement ]
          </span>
          {goalLabel ? (
            <span className="text-sm text-stone-700">
              Your goal: <strong>{goalLabel}</strong>{" "}
              {config.conversionSource === "auto" && (
                <span className="font-mono text-[11px] tracking-wider text-stone-400">
                  (auto-detected)
                </span>
              )}
            </span>
          ) : (
            <span className="text-sm text-stone-500">
              Goal not set yet — Angel picks one automatically from your site&apos;s buttons after
              the first visits.
            </span>
          )}
          <span className="font-mono text-[11px] tracking-wider text-stone-400">
            · control group: {config.holdoutPct}%
          </span>
          {config.consentMode !== "attested" && (
            <span className="font-mono text-[11px] tracking-wider text-amber-600">
              · awaiting attestation above
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-stone-200 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ measurement ]</span>
          {config.consentMode !== "attested" && (
            <span className="text-xs font-normal text-muted-foreground">
              — takes effect once full tracking is attested above
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-stone-500"
            onClick={() => setEditing(false)}
          >
            Done
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="holdout" className="text-xs">
              Holdout (% control group)
            </Label>
            <Input
              id="holdout"
              type="number"
              min={0}
              max={100}
              value={holdout}
              disabled={disabled}
              onChange={(e) => setHoldout(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-url" className="text-xs">
              Conversion URL contains
            </Label>
            <Input
              id="conv-url"
              placeholder="/thank-you"
              value={convUrl}
              disabled={disabled}
              onChange={(e) => setConvUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-sel" className="text-xs">
              Conversion click (CSS selector)
            </Label>
            <Input
              id="conv-sel"
              placeholder="a[href*='signup'] button"
              value={convSel}
              disabled={disabled}
              onChange={(e) => setConvSel(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {ctas.length > 0 && (
            <Select value="" onValueChange={(v) => setConvSel(v)}>
              <SelectTrigger className="w-64" disabled={disabled}>
                <SelectValue placeholder="…or pick a button we found on your site" />
              </SelectTrigger>
              <SelectContent>
                {ctas.map((c) => (
                  <SelectItem key={c.id + c.selector} value={c.selector as string}>
                    {c.text}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex items-center gap-2">
            {mutation.isPending && <span className="text-xs text-muted-foreground">saving…</span>}
            {mutation.data?.ok === false && (
              <span className="text-xs text-rose-600">save failed</span>
            )}
            {mutation.isSuccess && mutation.data?.ok && !dirty && (
              <span className="text-xs text-emerald-600">saved</span>
            )}
            <Button
              size="sm"
              className="bg-emerald-700 text-white hover:bg-emerald-600"
              disabled={disabled || !dirty || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Save
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The snippet picks these up automatically — no changes needed on the site. A holdout keeps
          that share of visitors unadapted as a control group so conversion lift can be measured.
        </p>
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
