// /dashboard — the customer dashboard (blueprint Step 8).
//
// Three views, one owner-question each: Overview (how is it going?), Visitors
// (who was here and what did they do?), and What's working (is Angel earning
// its keep?). Everything operational lives in the header Settings dialog.
// Data comes from getDashboard (server function → Supabase via service role),
// aggregated by src/lib/dashboard. When the DB is unavailable the dashboard
// renders a clean empty state.

import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { Sparkles, ShieldCheck, Shield } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OverviewPanel } from "@/components/overview-panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  confirmGoal,
  createSite,
  startCheckout,
  openBillingPortal,
  getDashboard,
  rotateIngestKey,
  setConsentMode,
  setServingEnabled,
  setServingRamp,
  type ConsentMode,
  type DashboardResponse,
  type SiteConfigView,
  type VariantView,
} from "@/lib/dashboard/dashboard.functions";
import type { GoalCandidate, GoalKind } from "@/adaptive/crawler-inventory";
import { RECENT_WINDOW_DAYS } from "@/lib/dashboard/aggregate";
import type { InventoryGroup } from "@/lib/dashboard/aggregate";

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
  const [site, setSite] = useState("hubspot");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { data, isFetching } = useQuery(dashboardQuery(site));

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  // If the selected site isn't in the list (the seed is just a fallback),
  // fall over to the first real site so the picker never shows a ghost.
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

  const cur = d.sites.find((s) => s.slug === site);
  const siteLabel = cur?.domain ?? cur?.name ?? site;

  return (
    <div className="min-h-screen bg-[#fafaf9] text-stone-900">
      <main className="mx-auto max-w-6xl space-y-6 px-6 pb-16 pt-7">
        {/* Kontroll-raden (Dashboard-1B v3): ingen produktbranding inne i
            dashboarden — mono-etiketten till vänster, TVÅ kontroller till
            höger: Account & settings (inkl. site settings + admin-sandbox)
            och sajtmenyn (byt sajt, Add site, Sign out). */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-stone-400">
            Adaptive layer · last {RECENT_WINDOW_DAYS} days
            {isFetching && <span className="ml-2 animate-pulse">updating…</span>}
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 items-center gap-1.5 rounded-[10px] border border-stone-200 bg-white px-3.5 text-[13px] text-stone-600 hover:bg-stone-50"
                >
                  Account &amp; settings <span className="text-[10px] text-stone-400">▾</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {d.sites.length > 0 && (
                  <DropdownMenuItem
                    disabled={!d.dbAvailable}
                    onSelect={() => setSettingsOpen(true)}
                  >
                    Site settings…
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setAccountOpen(true)}>Account…</DropdownMenuItem>
                {d.isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <a href="/sandbox">Sandbox</a>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 items-center gap-1.5 rounded-[10px] border border-stone-200 bg-white px-3.5 text-[13px] font-semibold text-stone-800 hover:bg-stone-50"
                >
                  {d.sites.length > 0 ? siteLabel : "No site yet"}{" "}
                  <span className="text-[10px] font-normal text-stone-400">▾</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {d.sites.map((s) => (
                  <DropdownMenuItem key={s.slug} onSelect={() => setSite(s.slug)}>
                    {s.name ?? s.slug}
                    {s.domain ? ` (${s.domain})` : ""}
                    {s.slug === site ? " ✓" : ""}
                  </DropdownMenuItem>
                ))}
                {d.sites.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => setAddOpen(true)}>Add site…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Menyernas dialoger — kontrollerade, utan egna triggers. */}
        {d.sites.length > 0 && (
          <SettingsControl
            site={site}
            config={d.siteConfig}
            inventory={d.metrics.inventory}
            disabled={!d.dbAvailable}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
          />
        )}
        <AccountControl open={accountOpen} onOpenChange={setAccountOpen} />
        <AddSiteControl
          onCreated={(slug) => setSite(slug)}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
        {d.sites.length === 0 ? (
          <Card className="border-stone-200 shadow-none">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Add your first site</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Give your site a short id. You&apos;ll get an install snippet to paste once — then
                  this dashboard fills with its adaptations and measured lift.
                </p>
              </div>
              <Button onClick={() => setAddOpen(true)}>Add site</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Onboarding only: once the snippet reports traffic the install card
            retires to Settings and the dashboard is just the product. Hidden
            when the store is unreachable — "no data" isn't "not installed",
            and the fallback config would render the wrong (keyless) tag. */}
            {d.dbAvailable && !installed && (
              <InstallCard
                site={site}
                ingestKey={d.siteConfig.ingestKey}
                domain={d.siteConfig.domain}
              />
            )}

            <BillingCard status={d.siteConfig.billingStatus} />

            {/* Day-0-granskningen (task #98): dag-0-värdet medan mätdatat
            samlas — kortet drar sig tillbaka när sajtens första variant
            finns, då har produkten tagit över berättelsen. */}
            {d.siteConfig.day0ReportUrl && (d.variants ?? []).length === 0 && (
              <Card className="shadow-none border-stone-200">
                <CardContent className="flex flex-wrap items-center gap-3 py-4">
                  <span className="font-mono text-[11px] tracking-wider text-emerald-700">
                    [ day-0 review ]
                  </span>
                  <p className="text-sm text-foreground">
                    A measured look at your page from the day you joined — while Angel collects live
                    visitor data.
                  </p>
                  <a
                    href={d.siteConfig.day0ReportUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-sm font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    View report ↗
                  </a>
                </CardContent>
              </Card>
            )}

            {/* Mål-kortet drar sig tillbaka till Settings när målet är bekräftat
            och mätningen rullar — det syns bara när det behöver ägaren. */}
            {(d.siteConfig.conversionSource !== "owner" ||
              d.siteConfig.consentMode !== "attested") && (
              <MeasurementControl
                site={site}
                config={d.siteConfig}
                ctas={(d.metrics.inventory.find((g) => g.slot === "cta")?.items ?? []).filter(
                  (i) => i.text && i.selector,
                )}
              />
            )}

            {!d.dbAvailable && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                No analytics store reached — showing an empty state. Events populate once the
                snippet runs and the server has <code>SUPABASE_SERVICE_ROLE_KEY</code> set (Netlify
                → Environment variables).
              </div>
            )}

            {/* Dashboard-1B v3: EN vy — hela berättelsen bor i panelen. Visitors-
            taben utgick (ersatt av källutforskaren + Journeys & signals);
            kontroll-raden ovanför bär perioden, så ingen sidtitel behövs. */}
            <OverviewPanel
              site={d.site}
              overview={d.metrics.overview}
              segments={d.metrics.segmentGroups}
              sessions={d.metrics.sessions}
              rageClicks={d.metrics.rageClicks}
              heatPages={d.metrics.heatPages}
              searches={d.metrics.searches}
              variants={d.variants ?? []}
              servingOn={d.siteConfig.servingEnabled}
              journey={d.journey ?? []}
            />
          </>
        )}
      </main>
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
  inventory,
  disabled,
  open,
  onOpenChange,
}: {
  site: string;
  config: SiteConfigView;
  inventory: InventoryGroup[];
  disabled: boolean;
  /* Styrs av Account & settings-menyn — dialogen har ingen egen trigger. */
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-[11px] tracking-wider text-emerald-700">
              [ settings ]
            </span>
            {site}
          </DialogTitle>
          <DialogDescription>Install tag, security and data terms for this site.</DialogDescription>
        </DialogHeader>
        {disabled ? (
          // The fallback config is a default, not this site's truth — showing
          // it here would present a keyless tag and "paused" terms as fact.
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            The data store can&apos;t be reached right now, so this site&apos;s settings can&apos;t
            be shown. Try again in a moment.
          </p>
        ) : (
          <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            <InstallSection site={site} ingestKey={config.ingestKey} />
            {/* Målet är alltid nåbart här — kortet på dashboarden visas bara
                när det behöver ägaren (obekräftat eller pausat). */}
            <GoalSection
              site={site}
              config={config}
              ctas={(inventory.find((g) => g.slot === "cta")?.items ?? []).filter(
                (i) => i.text && i.selector,
              )}
            />
            <ServingSection
              site={site}
              servingOn={config.servingEnabled}
              rampPct={config.rampPct}
            />
            <ConsentSection site={site} mode={config.consentMode} />
            <ContentSection inventory={inventory} />
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
        Paste once on the site — it never needs updating. Changes you make here apply automatically.
      </p>
    </section>
  );
}

/** Serverings-mastern + rampen — flyttade hit från gamla varianter-kortet
 *  (Dashboard-1B v2: dashboarden berättar, Settings styr). AV som default;
 *  besökare ser varianter först när ägaren slår på den här. */
function ServingSection({
  site,
  servingOn,
  rampPct,
}: {
  site: string;
  servingOn: boolean;
  rampPct: number;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setServingEnabled({ data: { site, enabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });
  const ramp = useMutation({
    mutationFn: (pct: 5 | 10 | 25 | 50) => setServingRamp({ data: { site, rampPct: pct } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });
  return (
    <section className="space-y-2">
      <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ serving ]</span>
      <div
        className={`flex flex-wrap items-center gap-3 rounded-md border p-3 ${
          servingOn ? "border-emerald-300 bg-emerald-50/50" : "border-stone-200"
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {servingOn ? "Variants can serve" : "Serving is OFF — visitors see the original page"}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The master switch for every variant on this site. Each variant also needs your explicit
            go-ahead (Start A/B) before it reaches any visitor.
          </p>
        </div>
        <Switch
          checked={servingOn}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v === true)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Ramp (share of the segment in the test):
        </span>
        {([5, 10, 25, 50] as const).map((p) => (
          <button
            key={p}
            type="button"
            disabled={ramp.isPending}
            onClick={() => ramp.mutate(p)}
            className={`rounded-md border px-2.5 py-1 font-mono text-[11px] tracking-wider disabled:opacity-50 ${
              rampPct === p
                ? "border-emerald-700 bg-emerald-700 text-white"
                : "border-stone-200 text-stone-600 hover:bg-stone-50"
            }`}
          >
            {p}%
          </button>
        ))}
      </div>
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
          {mutation.data?.ok === false && (
            <span className="text-xs text-rose-600">save failed</span>
          )}
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

/** Read-only: what the crawler found on the site. Adaptations only ever reuse
 *  this published content — surfaced here for transparency, not editing. */
function ContentSection({ inventory }: { inventory: InventoryGroup[] }) {
  return (
    <section className="space-y-2">
      <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ content ]</span>
      {inventory.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing harvested yet — Angel maps your published content after the first visits.
        </p>
      ) : (
        <div className="max-h-52 space-y-3 overflow-y-auto rounded-md border border-stone-200 p-3">
          {inventory.map((group) => (
            <div key={group.slot}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-stone-700">{group.slot}</span>
                <Badge variant="outline" className="text-[10px]">
                  {group.items.length}
                </Badge>
              </div>
              <ul className="mt-1 space-y-0.5">
                {group.items.slice(0, 8).map((item) => {
                  // Non-acquisition roles (support / login / legal / nav …) are
                  // shown for transparency but never used by the engine. Same
                  // precedence as the engine's resolveRole: rule verdict is a
                  // floor; a confident LLM label may demote, never promote.
                  const m = item.meta;
                  const conf = Number(m.llmConfidence ?? "0");
                  const role =
                    m.role && m.role !== "acquisition"
                      ? m.role
                      : m.llmRole && m.llmRole !== "acquisition" && conf >= 0.7
                        ? m.llmRole
                        : "acquisition";
                  const excluded = role !== "acquisition";
                  // The model suspected a non-conversion role but wasn't sure —
                  // the item stays in use; surface the doubt for the owner.
                  const uncertain =
                    !excluded && !!m.llmRole && m.llmRole !== "acquisition" && conf < 0.7;
                  return (
                    <li
                      key={item.id}
                      className={`truncate text-xs ${excluded ? "text-stone-400" : "text-stone-500"}`}
                    >
                      {item.text ?? item.selector ?? item.id}
                      {excluded && (
                        <span className="ml-1 font-mono text-[10px] tracking-wider text-stone-400">
                          · {role} — never used
                        </span>
                      )}
                      {uncertain && (
                        <span className="ml-1 font-mono text-[10px] tracking-wider text-amber-600">
                          · maybe {m.llmRole}?
                        </span>
                      )}
                    </li>
                  );
                })}
                {group.items.length > 8 && (
                  <li className="text-xs text-stone-400">…and {group.items.length - 8} more</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        What Angel found on your pages. Adaptations only ever reuse this published content — nothing
        is invented.
      </p>
    </section>
  );
}

function AccountControl({
  open,
  onOpenChange,
}: {
  /* Styrs av Account & settings-menyn — dialogen har ingen egen trigger. */
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }: { data: { user: { email?: string } | null } }) =>
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
      onOpenChange(false);
    }, 1200);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), setError(null), setDone(false))}>
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
  open,
  onOpenChange,
}: {
  onCreated: (slug: string) => void;
  /* Styrs av sajtmenyn ("Add site…") — dialogen har ingen egen trigger. */
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createSite({ data: { slug: slug.trim(), name: name.trim(), domain: domain.trim() } }),
    onSuccess: (res) => {
      if (!res.ok) {
        setError(
          res.reason === "taken"
            ? "That id is already taken."
            : res.reason === "domain_taken"
              ? "That domain is already connected to another account."
              : res.reason === "bad_domain"
                ? "That doesn't look like a website address (e.g. acme.com)."
                : "Couldn't create the site.",
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onCreated(res.slug!);
      onOpenChange(false);
      setSlug("");
      setName("");
      setDomain("");
      setError(null);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a site</DialogTitle>
          <DialogDescription>
            Enter your website address. The domain is bound to your account — the first visit from
            it verifies the installation automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-domain" className="text-xs">
              Your website
            </Label>
            <Input
              id="new-domain"
              placeholder="acme.com"
              value={domain}
              onChange={(e) => {
                const v = e.target.value;
                setDomain(v);
                // Härled id:t ur domänen tills användaren själv rört id-fältet.
                if (!slugTouched) {
                  setSlug(
                    v
                      .trim()
                      .toLowerCase()
                      .replace(/^https?:\/\//, "")
                      .replace(/^www\./, "")
                      .replace(/[/?#].*$/, ""),
                  );
                }
              }}
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
              <Label htmlFor="new-slug" className="text-xs">
                Site id
              </Label>
              <Input
                id="new-slug"
                placeholder="acme.com"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
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

/** Betalkortet (block 3): syns för sajter som inte är exempt (pilot/labb).
 *  none → starta prenumerationen (399 USD/mån, 30 dagar gratis, kort krävs);
 *  trialing/active → status + portal-länk; past_due/canceled → ärligt besked
 *  att serving är pausad (besökarna ser originalsidan, datan bevaras). */
function BillingCard({ status }: { status: string }) {
  const [busy, setBusy] = useState(false);
  if (status === "exempt") return null;
  const returnUrl = typeof window !== "undefined" ? `${window.location.origin}/dashboard` : "";

  async function go(fn: typeof startCheckout | typeof openBillingPortal) {
    setBusy(true);
    try {
      const res = await fn({ data: { returnUrl } });
      if (res.ok && res.url) window.location.href = res.url;
      else if (res.reason === "not_configured")
        alert("Billing isn't configured yet — running in free mode.");
    } finally {
      setBusy(false);
    }
  }

  const paused = status === "past_due" || status === "canceled";
  return (
    <Card
      className={`shadow-none ${paused ? "border-amber-300 bg-amber-50/50" : "border-stone-200"}`}
    >
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <span className="font-mono text-[11px] tracking-wider text-emerald-700">[ plan ]</span>
        {status === "none" && (
          <>
            <p className="text-sm text-foreground">
              <strong>$399/month — free until your first verified variant.</strong> Card required;
              you pay nothing until the system has produced a verified improvement for your site,
              then billing starts with 7 days notice. Cancel anytime; observation is always on.
            </p>
            <Button
              size="sm"
              disabled={busy}
              className="ml-auto bg-emerald-700 text-white hover:bg-emerald-600"
              onClick={() => go(startCheckout)}
            >
              {busy ? "Opening…" : "Start — free until proven"}
            </Button>
          </>
        )}
        {(status === "trialing" || status === "active") && (
          <>
            <p className="text-sm text-foreground">
              Subscription <strong>{status === "trialing" ? "trial" : "active"}</strong>.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              className="ml-auto"
              onClick={() => go(openBillingPortal)}
            >
              Manage billing
            </Button>
          </>
        )}
        {paused && (
          <>
            <p className="text-sm text-amber-900">
              <strong>Serving is paused</strong> — your visitors see the original page and your data
              is preserved. Resume your subscription to continue testing.
            </p>
            <Button
              size="sm"
              disabled={busy}
              className="ml-auto bg-emerald-700 text-white hover:bg-emerald-600"
              onClick={() => go(openBillingPortal)}
            >
              Resume
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Onboarding-only card: shown until the snippet reports its first traffic,
 *  then the tag retires to Settings. Copy is the only action — key rotation is
 *  a security operation and lives behind the password check in Settings. */
function InstallCard({
  site,
  ingestKey,
  domain,
}: {
  site: string;
  ingestKey: string | null;
  domain?: string | null;
}) {
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
        {domain && (
          <p className="text-xs text-muted-foreground">
            The first visit from <span className="font-mono">{domain}</span> verifies your domain
            automatically — nothing is ever shown to visitors before that, and you approve every
            change first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const GOAL_KIND_LABEL: Record<GoalKind, string> = {
  signup: "sign up",
  purchase: "purchase",
  booking: "booking",
  trial: "start trial",
  quote: "get a quote",
  contact: "contact",
  lead: "lead / callback",
  outbound: "outbound (affiliate)",
  start_flow: "start a flow",
  subscribe: "subscribe",
  download: "download",
  donate: "donate",
};

/** Mål-kortet på dashboardens yta — visas bara när det behöver ägaren
 *  (obekräftat mål eller pausad mätning). Bekräftat + mätande → målet bor i
 *  Settings via GoalSection, samma reträtt-mönster som install-kortet. */
function MeasurementControl(props: {
  site: string;
  config: SiteConfigView;
  ctas: { id: string; text: string | null; selector: string | null }[];
}) {
  return (
    <Card className="border-stone-200 shadow-none">
      <CardContent className="py-4">
        <GoalSection {...props} />
      </CardContent>
    </Card>
  );
}

function GoalSection({
  site,
  config,
  ctas,
}: {
  site: string;
  config: SiteConfigView;
  ctas: { id: string; text: string | null; selector: string | null }[];
}) {
  const queryClient = useQueryClient();
  const confirm = useMutation({
    mutationFn: (c: { selector: string; text?: string; url?: string; kind?: GoalKind }) =>
      confirmGoal({ data: { site, ...c } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard", site] }),
  });

  const confirmed = config.conversionSource === "owner";
  const activeSelector = config.conversionSelector;
  const goalCta = ctas.find((c) => c.selector === activeSelector);
  const activeText = goalCta?.text ?? config.conversionText ?? activeSelector;
  const candidates: GoalCandidate[] = config.goalCandidates ?? [];
  const paused = config.consentMode !== "attested";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] tracking-wider text-emerald-700">
          [ conversion goal ]
        </span>
        {config.businessType && (
          <span className="font-mono text-[10px] tracking-wider text-stone-400">
            detected: {config.businessType}
          </span>
        )}
        {confirmed ? (
          <span className="text-sm text-stone-700">
            Angel is working toward <strong>“{activeText}”</strong>, measured against a{" "}
            {config.holdoutPct || 12}% control group.
          </span>
        ) : activeSelector ? (
          <span className="text-sm text-stone-600">
            Auto-detected goal <strong>“{activeText}”</strong> — confirm it (or pick another) to
            lock it in.
          </span>
        ) : candidates.length > 0 ? (
          <span className="text-sm text-stone-600">
            Confirm your conversion goal to activate Angel — it won’t change or measure anything
            until you do.
          </span>
        ) : (
          <span className="text-sm text-stone-500">
            Angel is learning your page — goal candidates appear here after the first visits.
          </span>
        )}
        {paused && confirmed && (
          <span className="font-mono text-[11px] tracking-wider text-amber-600">
            · paused — turn on visitor information in Settings to measure
          </span>
        )}
      </div>

      {candidates.length > 0 && (
        <ul className="space-y-1.5">
          {candidates.map((c) => {
            const isActive = c.selector === activeSelector;
            return (
              <li
                key={`${c.rank}-${c.selector}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-stone-100 bg-stone-50/60 px-2.5 py-1.5"
              >
                <span className="font-mono text-[10px] tracking-wider text-stone-400">
                  {c.rank === 1 ? "primary" : `#${c.rank}`}
                </span>
                <span className="text-sm text-stone-800">{c.text}</span>
                <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 font-mono text-[10px] tracking-wider text-stone-500">
                  {GOAL_KIND_LABEL[c.kind] ?? c.kind}
                </span>
                {isActive && confirmed ? (
                  <span className="ml-auto font-mono text-[11px] tracking-wider text-emerald-700">
                    · active
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={confirm.isPending}
                    onClick={() =>
                      confirm.mutate({ selector: c.selector, text: c.text, kind: c.kind })
                    }
                    className="ml-auto font-mono text-[11px] tracking-wider text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-700 disabled:opacity-50"
                  >
                    {isActive ? "confirm" : "set as goal"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirm.isError && (
        <span className="font-mono text-[11px] tracking-wider text-amber-600">
          couldn’t save — try again
        </span>
      )}
    </div>
  );
}
