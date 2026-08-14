// Dashboard "Overview" — Dashboard-1B v2 ur ägarens designbundle (2026-07-16):
// svarskort + KPI:er → tvåpanels källutforskare med KOLLAPSAT träd + filter,
// "All sources"-översikt som default (rankade kanaler), scopad variantlista
// med riktiga åtgärder + "se live", hopslagna Recent journeys med rage-bursts
// som EN siffra, och "Journeys & signals" med klick-heatmap som POPUP i samma
// idiom som Compare (ägarbeslut 2026-07-17: "exakt så som vi ser compare, ska
// vi se journey och rageclicks — ett popupfönster med sandbox-spegeln").
//
// Prototypens siffror var demo. Här driver RIKTIG data varje yta, med ärliga
// lägen i stället för påhitt: inga servande varianter ⇒ "Observing"; för tunt
// underlag ⇒ "Too early to tell"; lift/sannolikhet ur variant-armarna med
// samma z-test som vinnar-utvärderaren; heatmapen ritar bara positionsbärande
// klick (samlas från och med snippet-versionen med koordinater) och säger
// ärligt när underlaget saknas. Ingen yta visar ett tal vi inte kan försvara.
// Statistikhjälpare bor i dashboard/variant-stats, popuperna i
// dashboard/overlays (sajt-genomgången 2026-07-18).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setVariantStatus, setVariantSuccess } from "@/lib/dashboard/dashboard.functions";
import { parentSegmentKey, segmentDims } from "@/lib/segment-key";
import { reuseProvenanceLabel } from "@/lib/dashboard/reuse-provenance";
import { abMetricLabels, measuredHeadline, type AbMetric } from "./dashboard/ab-metric-labels";
import { CompareOverlay, JourneysOverlay } from "./dashboard/overlays";
import {
  enLabel,
  fmt,
  judgeArms,
  KIND_BY_DEPTH,
  liftFmt,
  liftForKey,
  metricTableRows,
  pct,
  scopedVariants,
  STATUS_PILL,
  sumArms,
  variantFor,
} from "./dashboard/variant-stats";

import type {
  Overview,
  RageSignal,
  SearchTerm,
  SegmentSummary,
  SessionSummary,
  TopSection,
} from "@/lib/dashboard/aggregate";
import { honestPercent } from "@/adaptive/redesign/select";
import type { VariantView } from "@/lib/dashboard/dashboard.functions";
import type { JourneyMilestone } from "@/lib/dashboard/journey";
import type { ArmVerdict } from "./dashboard/variant-stats";
import type { SuccessSpec } from "@/adaptive-lab/metrics";

/** Planens härkomst i ägarens språk. Okända/saknade värden ger ingen rad alls
 *  — hellre tyst än en gissad etikett (varianter födda före provenansen). */
function planSourceLabel(src: string | null): string | null {
  if (src === "katalog/selector") return "from catalog (model pick)";
  if (src === "katalog/floor") return "from catalog (rule pick)";
  if (src === "designer") return "from designer";
  // Bevis-lyftets nödfall: raden syntetiserades i verifieringen ur sidans egen
  // text när det valda draget hölls av grinden — varken katalog eller designer.
  if (src === "proof-insert") return "from proof lift (gate fallback)";
  return null;
}

export function OverviewPanel({
  site,
  overview,
  segments,
  sessions,
  rageClicks,
  searches,
  variants,
  servingOn,
  otherDomains = [],
  journey = [],
  topSections = [],
}: {
  site: string;
  overview: Overview;
  segments: SegmentSummary[];
  sessions: SessionSummary[];
  rageClicks: RageSignal[];
  searches: SearchTerm[];
  variants: VariantView[];
  servingOn: boolean;
  /** Topp-domänerna bakom "other websites" (ägarbeslut 2026-07-26: samla nu,
   *  visa senare). Servern tröskelgrindar — tom lista tills hinken bär, och
   *  blocket nedan är då helt vilande. */
  otherDomains?: { domain: string; visits: number }[];
  journey?: JourneyMilestone[];
  /** Blockbibliotekets läsvy (ägarfråga 2026-08-10): sajtens mest engagerande
   *  sektioner ur censusen. Tom lista ⇒ kortet är helt vilande. */
  topSections?: TopSection[];
}) {
  // ── trädet: nycklarna ÄR hierarkin (grov→fin, prefix = förälder) ──────────
  const byKey = useMemo(() => new Map(segments.map((s) => [s.key, s])), [segments]);
  const children = useMemo(() => {
    const m = new Map<string | null, SegmentSummary[]>();
    for (const s of segments) {
      // Djup 4 (besökartyp new/returning) förtjänar sin plats i trädet
      // (ägarbeslut 2026-07-17): raden visas bara när splitten bär egen
      // volym eller en variant riktar sig mot exakt den nyckeln — tunna
      // rader fälls in i föräldern. DATAT är orört: dimensionen finns kvar
      // i rollup, detektor och serving; det här gäller bara radvisningen.
      if (
        s.depth === 4 &&
        !s.adequate &&
        !variants.some(
          (v) =>
            v.segmentKey === s.key &&
            (v.status === "verified" || v.status === "serving" || v.status === "winner"),
        )
      ) {
        continue;
      }
      const parent = s.depth === 1 ? null : parentSegmentKey(s.key);
      const list = m.get(parent) ?? [];
      list.push(s);
      m.set(parent, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.visits - a.visits);
    return m;
  }, [segments, variants]);
  const roots = children.get(null) ?? [];

  // Designens default: ALLT hopfällt, "All sources" valt — översikten är tyst.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string>("all");
  const [q, setQ] = useState("");
  const [journeysOpen, setJourneysOpen] = useState(false);
  const [compareId, setCompareId] = useState<string | null>(null);
  // Utfällbar mätartabell per variantrad (ägarbeslut 2026-07-27: alla siffror,
  // men bara bakom ett klick — grundvyn brusfri). Ett id i taget, klick igen
  // stänger — samma mönster som compareId.
  const [metricsId, setMetricsId] = useState<string | null>(null);

  const sel = selected === "all" ? null : (byKey.get(selected) ?? null);

  interface Row {
    s: SegmentSummary;
    depth: number;
    caret: string;
  }
  const rows: Row[] = [];
  const walk = (list: SegmentSummary[], depth: number) => {
    for (const s of list) {
      const kids = children.get(s.key) ?? [];
      rows.push({ s, depth, caret: kids.length === 0 ? "" : open.has(s.key) ? "▾" : "▸" });
      if (kids.length > 0 && open.has(s.key)) walk(kids, depth + 1);
    }
  };
  const qNorm = q.trim().toLowerCase();
  walk(qNorm ? roots.filter((r) => r.label.toLowerCase().includes(qNorm)) : roots, 0);

  const activate = (s: SegmentSummary) => {
    setSelected(s.key);
    setCompareId(null);
    if ((children.get(s.key) ?? []).length > 0) {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(s.key)) next.delete(s.key);
        else next.add(s.key);
        return next;
      });
    }
  };

  // ── ägarens variant-åtgärder (flyttade hit från gamla varianter-kortet) ───
  const queryClient = useQueryClient();
  const [statusError, setStatusError] = useState<string | null>(null);
  const status = useMutation({
    mutationFn: (args: { variantId: string; status: "serving" | "winner" | "retired" }) =>
      setVariantStatus({ data: { site, ...args } }),
    onSuccess: (res) => {
      setStatusError(res.ok ? null : (res.reason ?? "couldn't save"));
      queryClient.invalidateQueries({ queryKey: ["dashboard", site] });
    },
    // Transportfel efter ett BEKRÄFTAT statusbyte gav noll återkoppling
    // (UI-buggjaktens fynd 2026-08-14) — rejection landar i samma felyta.
    onError: () => setStatusError("couldn't save — network error; nothing was changed"),
  });
  // Kontraktsredigeraren: ägaren väljer primärt mått + guardrails per variant.
  // {ok:false} är ett RESOLVED svar — utan koll stängde editorn som om det
  // sparats och ägarens val försvann tyst (UI-buggjaktens fynd 2026-08-14).
  const [contractError, setContractError] = useState<string | null>(null);
  const contract = useMutation({
    mutationFn: (args: { variantId: string; success: SuccessSpec }) =>
      setVariantSuccess({ data: { site, ...args } }),
    onSuccess: (res) => {
      setContractError(res.ok ? null : (res.reason ?? "couldn't save"));
      queryClient.invalidateQueries({ queryKey: ["dashboard", site] });
    },
    onError: () => setContractError("couldn't save — network error; your edit is kept"),
  });
  // Draften hör till EN variant: nyckeln är variant-id, inte en boolean —
  // annars överlever variant A:s öppna draft ett segmentbyte och sparas på
  // variant B (UI-buggjaktens fynd 2026-08-14).
  const [editingContract, setEditingContract] = useState<string | null>(null);
  const [draftPrimary, setDraftPrimary] = useState("conversion");
  const [draftGuards, setDraftGuards] = useState<string[]>(["bounce", "engaged"]);
  // Varje trafikpåverkande statusbyte bekräftas — en felklickning ska inte
  // starta eller stoppa ett A/B.
  const askStatus = (v: VariantView, next: "serving" | "winner" | "retired", label: string) => {
    if (window.confirm(`${label} for ${v.segmentKey}?`)) {
      status.mutate({ variantId: v.id, status: next });
    }
  };

  // ── svarskortet: summerade armar över allt som serverar ───────────────────
  const siteVerdict = judgeArms(sumArms(variants));
  // Vad `conversions`-fälten FAKTISKT räknar: sajtens testMetric är gemensamt
  // för alla varianter, så första levande armen bär sanningen för summan.
  const siteMetric: AbMetric | null =
    variants.find((v) => (v.status === "serving" || v.status === "winner") && v.abTest)?.abTest
      ?.metric ?? null;
  // Rubriken firar bara ett win-domslut, och kontrollarm utan konverteringar
  // (liftRel null) får en egen ärlig mening i stället för ett tomt kort.
  const siteHeadline =
    siteVerdict.state === "measured"
      ? measuredHeadline(siteVerdict.measured?.verdict, siteVerdict.liftRel, siteMetric)
      : null;

  // ── valet: armar + resor + varianter ──────────────────────────────────────
  const selVariant = sel ? variantFor(variants, sel.key) : null;
  const selArms = selVariant?.abTest
    ? judgeArms({ variant: selVariant.abTest.variant, control: selVariant.abTest.control })
    : judgeArms(null);
  const selDims = sel ? segmentDims(sel.key) : [];
  const journeyMatches = (j: SessionSummary) => {
    if (!sel) return true;
    if (selDims[0] && (j.channel ?? "okänd") !== selDims[0]) return false;
    if (selDims[1] && (j.device ?? "okänd") !== selDims[1]) return false;
    if (selDims[2] && (j.country ?? "okänd") !== selDims[2]) return false;
    if (selDims[3] && (j.isReturning ? "återkommande" : "ny") !== selDims[3]) return false;
    return true;
  };
  const selJourneys = sessions.filter(journeyMatches);
  const selScoped = sel ? scopedVariants(variants, sel.key) : [];
  const rageTotal = rageClicks.reduce((a, g) => a + g.bursts, 0);

  // All sources-panelens tal: summan av rötterna (samma träd ägaren tittar på).
  const totVisits = roots.reduce((a, s) => a + s.visits, 0);
  const totConversions = roots.reduce((a, s) => a + s.conversions, 0);

  const kpis = [
    { label: "Pageviews", value: fmt(overview.pageviews) },
    { label: "Identified visitors", value: fmt(overview.uniqueVisitors) },
    { label: "Conversions", value: fmt(overview.conversions) },
    { label: "Conversion rate", value: pct(overview.conversionRate) },
  ];

  // Armtabellen delas mellan All sources (summerade armar) och ett valt
  // segment (variantens armar) — samma ärliga tre lägen.
  const METRIC_EN: Record<string, string> = {
    conversion: "conversions",
    form_submit: "form submits",
    cta_click: "CTA clicks",
    pricing_view: "pricing views",
    engaged: "engagement",
    deep_scroll: "deep scroll",
    return_visit: "return visits",
    bounce: "bounce",
  };
  const armsBlock = (
    verdict: ArmVerdict,
    success?: SuccessSpec | null,
    metric?: AbMetric | null,
  ) => {
    // Rubrikerna följer VariantAbView.metric: i continuation-läget bär
    // `conversions`-fälten fortsättningar (UI-buggjaktens fynd 2026-08-14) —
    // continuation-tal ska aldrig visas under conversion-rubriker.
    const labels = abMetricLabels(metric);
    return (
      <div className="mt-6">
        <div className="mb-2.5 font-heading text-sm font-semibold">Adapted vs control</div>
        {verdict.arms ? (
          <>
            <div className="overflow-hidden rounded-xl border border-[#f0eee9]">
              <div className="flex bg-[#faf9f7] px-[18px] py-2.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-stone-400">
                <span className="flex-1">Arm</span>
                <span className="w-[92px] text-right">Visitors</span>
                <span className="w-[100px] text-right">{labels.rateLabel}</span>
                <span className="w-[92px] text-right">{labels.countLabel}</span>
              </div>
              {(
                [
                  ["Adapted", verdict.arms.variant, "#065f46"],
                  ["Control", verdict.arms.control, "#78716c"],
                ] as const
              ).map(([label, arm, color]) => (
                <div
                  key={label}
                  className="flex items-center border-t border-[#f0eee9] px-[18px] py-3 text-[13px] tabular-nums"
                >
                  <span className="flex-1 font-semibold" style={{ color }}>
                    {label}
                  </span>
                  <span className="w-[92px] text-right">{fmt(arm.visits)}</span>
                  <span className="w-[100px] text-right font-semibold">
                    {arm.visits > 0 ? pct(arm.conversions / arm.visits) : "—"}
                  </span>
                  <span className="w-[92px] text-right">{fmt(arm.conversions)}</span>
                </div>
              ))}
            </div>
            {verdict.state === "measured" && verdict.prob !== null ? (
              <div className="mt-3 flex items-center gap-2.5">
                <div className="h-1.5 max-w-[240px] flex-1 overflow-hidden rounded-full bg-stone-200">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${Math.round(verdict.prob * 100)}%` }}
                  />
                </div>
                <span className="text-[12.5px] text-stone-600">
                  <b className="text-emerald-900">{Math.round(verdict.prob * 100)}%</b> probability
                  the lift is real
                </span>
              </div>
            ) : (
              <div className="mt-3 text-[12.5px] text-stone-400">
                {verdict.measured
                  ? verdict.measured.reason
                  : "Too few conversions on one of the arms yet — no probability is claimed until the math holds."}
              </div>
            )}
            {verdict.state === "measured" && verdict.measured ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-stone-500">
                <span
                  className="rounded-full px-2 py-0.5 font-semibold"
                  style={
                    verdict.measured.verdict === "win"
                      ? { background: "#d1fae5", color: "#065f46" }
                      : verdict.measured.verdict === "loss"
                        ? { background: "#fee2e2", color: "#991b1b" }
                        : { background: "#f5f5f4", color: "#57534e" }
                  }
                >
                  {verdict.measured.verdict.replace("_", " ")}
                </span>
                {verdict.measured.upliftRelCi ? (
                  <span className="tabular-nums">
                    lift CI {Math.round(verdict.measured.upliftRelCi[0] * 100)}%…
                    {Math.round(verdict.measured.upliftRelCi[1] * 100)}%
                  </span>
                ) : null}
              </div>
            ) : null}
            {verdict.state === "measured" &&
            verdict.measured?.verdict === "no_effect" &&
            success?.mdeRel &&
            verdict.measured.upliftRelCi &&
            (verdict.measured.upliftRelCi[1] >= success.mdeRel ||
              verdict.measured.upliftRelCi[0] <= -success.mdeRel) ? (
              <div className="mt-2 text-[12px] text-stone-500">
                The CI still allows ±{Math.round(success.mdeRel * 100)}% — underpowered, keep
                measuring rather than calling it flat.
              </div>
            ) : null}
            <div className="mt-2 text-[11.5px] text-stone-400">
              {success
                ? `Judged on ${METRIC_EN[success.primary] ?? success.primary} only (MDE ±${Math.round((success.mdeRel ?? 0.1) * 100)}%); ${
                    success.guardrails.length
                      ? success.guardrails.map((g) => METRIC_EN[g] ?? g).join(" & ") +
                        " guard the test — they can pause it, never win it."
                      : "no guardrails declared."
                  }`
                : `Judged on ${labels.judgedOn} only; engagement and bounce guard the test — they can pause it, never win it (docs/metric-hierarchy.md).`}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-stone-200 px-[18px] py-5 text-[13px] text-stone-400">
            No test is running {sel ? "for this group" : ""} yet.
          </div>
        )}
      </div>
    );
  };

  // ── dashboardvyn ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Resan till bevisat (stanna-tills-bevisat): synlig tills första ärliga
          domslutet — insamlingsperioden ska kännas som pågående mätning, inte
          tystnad. Döljs när berättelsen är klar (verdict done). */}
      <JourneyCard journey={journey} />

      {/* rad 1 — svarskortet + KPI:er */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div
          className="rounded-2xl border p-6"
          style={{
            borderColor: siteHeadline?.celebrate ? "#d1fae5" : "#e7e5e4",
            background: siteHeadline?.celebrate
              ? "linear-gradient(180deg,#f0fdf7,#ffffff)"
              : "#fff",
          }}
        >
          <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-emerald-600">
            Is Angel earning its keep?
          </div>
          {siteVerdict.state === "observing" && (
            <>
              <div className="mt-2 font-heading text-3xl font-bold tracking-tight text-stone-800">
                Observing
              </div>
              <p className="mt-2 text-[13.5px] text-stone-600">
                No adaptations are live yet — Angel is learning your traffic. Approved variants
                start measuring here.
              </p>
            </>
          )}
          {siteVerdict.state === "insufficient" && siteVerdict.arms && (
            <>
              <div className="mt-2 font-heading text-3xl font-bold tracking-tight text-stone-800">
                Too early to tell
              </div>
              <p className="mt-2 text-[13.5px] text-stone-600">
                {fmt(siteVerdict.arms.variant.visits)} adapted and{" "}
                {fmt(siteVerdict.arms.control.visits)} control visitors so far — the honest answer
                needs more of both.
              </p>
            </>
          )}
          {siteHeadline && (
            <>
              <div
                className="mt-2 font-heading text-3xl font-bold tracking-tight"
                style={{ color: siteHeadline.celebrate ? "#065f46" : "#78350f" }}
              >
                {siteHeadline.title}
              </div>
              <p className="mt-2 text-[13.5px] text-stone-600">{siteHeadline.body}</p>
              {siteVerdict.prob !== null && (
                <div className="mt-4 flex items-center gap-2.5">
                  <div className="h-1.5 max-w-[300px] flex-1 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.round(siteVerdict.prob * 100)}%` }}
                    />
                  </div>
                  <span className="text-[12.5px] text-stone-600">
                    <b className="text-emerald-900">{Math.round(siteVerdict.prob * 100)}%</b>{" "}
                    probability it&apos;s real
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="rounded-[13px] border border-[#f0eee9] bg-white px-[18px] py-4"
            >
              <div className="text-[11.5px] font-semibold text-stone-400">{k.label}</div>
              <div className="mt-1 font-heading text-[22px] font-semibold tracking-tight">
                {k.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* rad 2 — källutforskaren */}
      <div className="flex items-stretch overflow-hidden rounded-2xl border border-stone-200 bg-white max-lg:flex-col">
        {/* vänster: trädet — kollapsat som default, med filter + All sources */}
        <div className="flex w-[400px] flex-none flex-col border-r border-[#f0eee9] px-[22px] pb-7 pt-6 max-lg:w-full max-lg:border-b max-lg:border-r-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-heading text-[15px] font-semibold">Sources</div>
            <div className="text-[11px] text-stone-400">
              {roots.length} channel{roots.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="mt-0.5 text-[11.5px] text-stone-400">
            Pick a source to isolate it. Drill in for device &amp; country.
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter sources…"
            className="mt-3 h-[34px] rounded-[9px] border border-stone-200 bg-[#faf9f7] px-3 text-[12.5px] outline-none"
          />
          <button
            type="button"
            onClick={() => {
              setSelected("all");
              setCompareId(null);
            }}
            className="mt-3 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[11px] text-left hover:bg-[#f7f6f4]"
            style={{ background: selected === "all" ? "#f0fdf7" : undefined }}
          >
            <span className="w-[11px] flex-none" />
            <span className="flex-1 text-[13px] font-bold">All sources</span>
            <span className="w-14 text-right text-[12.5px] tabular-nums text-stone-500">
              {fmt(totVisits)}
            </span>
            <span className="w-[46px] text-right text-[11.5px] font-bold text-emerald-700">
              {liftFmt(siteVerdict.liftRel)}
            </span>
          </button>
          <div className="flex items-center gap-2.5 border-b border-[#f4f2ef] px-2.5 pb-2 pt-3.5">
            <span className="flex-1 text-[10px] font-bold uppercase tracking-[.07em] text-[#c4beb6]">
              Source
            </span>
            <span className="w-14 text-right text-[10px] font-bold uppercase tracking-[.07em] text-[#c4beb6]">
              Visits
            </span>
            <span className="w-[46px] text-right text-[10px] font-bold uppercase tracking-[.07em] text-[#c4beb6]">
              Lift
            </span>
          </div>
          <div className="-mx-1.5 max-h-[440px] flex-1 overflow-y-auto px-1.5">
            {rows.length === 0 && (
              <div className="px-2.5 py-6 text-[12.5px] text-stone-400">
                {qNorm
                  ? "No source matches the filter."
                  : "Groups appear as soon as visitors arrive."}
              </div>
            )}
            {rows.map(({ s, depth, caret }) => {
              const lift = liftForKey(variants, s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => activate(s)}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[11px] text-left hover:bg-[#f7f6f4]"
                  style={{ background: selected === s.key ? "#f0fdf7" : undefined }}
                >
                  <div
                    className="flex min-w-0 flex-1 items-center gap-2"
                    style={{ paddingLeft: depth * 22 }}
                  >
                    <span className="w-[11px] flex-none text-[10px] text-stone-400">{caret}</span>
                    <span className="truncate text-[13px] font-semibold">{enLabel(s.label)}</span>
                  </div>
                  <span className="w-14 text-right text-[12.5px] tabular-nums text-stone-500">
                    {fmt(s.visits)}
                  </span>
                  <span className="w-[46px] text-right text-[11.5px] font-bold text-emerald-700">
                    {liftFmt(lift)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* höger: detaljpanelen */}
        <div className="min-w-0 flex-1 px-8 pb-8 pt-7">
          {/* ---- All sources: den tysta översikten ---- */}
          {!sel && (
            <>
              <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400">
                Overview
              </div>
              <div className="mt-1 font-heading text-[25px] font-bold tracking-tight">
                All sources
              </div>
              <div className="mt-1.5 text-[13px] text-stone-500">
                {roots.length} channel{roots.length === 1 ? "" : "s"} · pick one to isolate its data
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
                <div className="rounded-xl border border-[#f0eee9] px-4 py-[15px]">
                  <div className="text-[11px] font-semibold text-stone-400">Visitors</div>
                  <div className="mt-1 font-heading text-[21px] font-semibold">
                    {fmt(totVisits)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#f0eee9] px-4 py-[15px]">
                  <div className="text-[11px] font-semibold text-stone-400">Conversion rate</div>
                  <div className="mt-1 font-heading text-[21px] font-semibold">
                    {totVisits > 0 ? pct(totConversions / totVisits) : "—"}
                  </div>
                </div>
                <div
                  className="rounded-xl border px-4 py-[15px]"
                  style={
                    siteVerdict.liftRel != null
                      ? { borderColor: "#d1fae5", background: "#f0fdf7" }
                      : { borderColor: "#f0eee9" }
                  }
                >
                  <div
                    className="text-[11px] font-semibold"
                    style={{ color: siteVerdict.liftRel != null ? "#059669" : "#a8a29e" }}
                  >
                    Lift vs control
                  </div>
                  <div
                    className="mt-1 font-heading text-[21px] font-semibold"
                    style={{ color: siteVerdict.liftRel != null ? "#065f46" : "#a8a29e" }}
                  >
                    {liftFmt(siteVerdict.liftRel)}
                  </div>
                </div>
              </div>

              {armsBlock(siteVerdict, null, siteMetric)}

              <div className="mt-6">
                <div className="mb-2.5 flex items-baseline gap-2">
                  <div className="font-heading text-sm font-semibold">Channels</div>
                  <div className="text-[11.5px] text-stone-400">
                    by visitors · click to drill in
                  </div>
                </div>
                {roots.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-200 px-[18px] py-5 text-[13px] text-stone-400">
                    Channels appear as soon as visitors arrive.
                  </div>
                ) : (
                  <>
                    <div className="overflow-hidden rounded-xl border border-[#f0eee9]">
                      {roots.slice(0, 6).map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => activate(c)}
                          className="flex w-full items-center gap-3 border-t border-[#f4f2ef] px-4 py-3 text-left first:border-t-0 hover:bg-[#faf9f7]"
                        >
                          <span className="flex-1 text-[13px] font-semibold">
                            {enLabel(c.label)}
                          </span>
                          <span className="w-[70px] text-right text-[12.5px] tabular-nums text-stone-500">
                            {fmt(c.visits)}
                          </span>
                          <span className="w-[52px] text-right text-[12px] font-bold text-emerald-700">
                            {liftFmt(liftForKey(variants, c.key))}
                          </span>
                          <span className="flex-none text-[12px] text-[#c4beb6]">→</span>
                        </button>
                      ))}
                    </div>
                    {roots.length > 6 && (
                      <div className="mt-2.5 text-[11.5px] text-stone-400">
                        + {roots.length - 6} more sources · use the filter to find one
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {/* ---- valt segment ---- */}
          {sel && (
            <>
              <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400">
                {KIND_BY_DEPTH[sel.depth - 1] ?? "Segment"}
              </div>
              <div className="mt-1 font-heading text-[25px] font-bold tracking-tight">
                {enLabel(sel.label)}
              </div>
              <div className="mt-1.5 text-[13px] text-stone-500">
                {sel.adequate
                  ? `${fmt(sel.visits)} visits in the window — enough to read on its own.`
                  : `Only ${fmt(sel.visits)} visits — borrowing strength from the parent group until this one can stand alone.`}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
                <div className="rounded-xl border border-[#f0eee9] px-4 py-[15px]">
                  <div className="text-[11px] font-semibold text-stone-400">Visitors</div>
                  <div className="mt-1 font-heading text-[21px] font-semibold">
                    {fmt(sel.visits)}
                  </div>
                </div>
                <div className="rounded-xl border border-[#f0eee9] px-4 py-[15px]">
                  <div className="text-[11px] font-semibold text-stone-400">Conversion rate</div>
                  <div className="mt-1 font-heading text-[21px] font-semibold">
                    {pct(sel.conversionRate)}
                  </div>
                </div>
                <div
                  className="rounded-xl border px-4 py-[15px]"
                  style={
                    selArms.liftRel != null
                      ? { borderColor: "#d1fae5", background: "#f0fdf7" }
                      : { borderColor: "#f0eee9" }
                  }
                >
                  <div
                    className="text-[11px] font-semibold"
                    style={{ color: selArms.liftRel != null ? "#059669" : "#a8a29e" }}
                  >
                    Lift vs control
                  </div>
                  <div
                    className="mt-1 font-heading text-[21px] font-semibold"
                    style={{ color: selArms.liftRel != null ? "#065f46" : "#a8a29e" }}
                  >
                    {liftFmt(selArms.liftRel)}
                  </div>
                </div>
              </div>

              {armsBlock(selArms, selVariant?.success, selVariant?.abTest?.metric)}
              {selVariant ? (
                <div className="mt-2">
                  {editingContract !== selVariant.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        const sp = selVariant.success ?? {
                          primary: "conversion",
                          guardrails: ["bounce", "engaged"],
                        };
                        setDraftPrimary(sp.primary);
                        setDraftGuards([...sp.guardrails]);
                        setContractError(null);
                        setEditingContract(selVariant.id);
                      }}
                      className="text-[11.5px] font-semibold text-stone-500 underline decoration-dotted hover:text-stone-700"
                    >
                      Edit success contract
                    </button>
                  ) : (
                    <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[12px]">
                      <label className="font-semibold text-stone-600">Judged on</label>
                      <select
                        value={draftPrimary}
                        onChange={(e) => {
                          setDraftPrimary(e.target.value);
                          setDraftGuards((g) => g.filter((x) => x !== e.target.value));
                        }}
                        className="rounded border border-stone-300 bg-white px-1.5 py-0.5"
                      >
                        {["conversion", "engaged", "deep_scroll", "cta_click", "form_submit"].map(
                          (m) => (
                            <option key={m} value={m}>
                              {METRIC_EN[m] ?? m}
                            </option>
                          ),
                        )}
                      </select>
                      <span className="font-semibold text-stone-600">guarded by</span>
                      {["bounce", "engaged", "cta_click", "form_submit", "conversion"]
                        .filter((m) => m !== draftPrimary)
                        .map((m) => {
                          const on = draftGuards.includes(m);
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() =>
                                setDraftGuards((g) =>
                                  on ? g.filter((x) => x !== m) : g.length >= 4 ? g : [...g, m],
                                )
                              }
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                on
                                  ? "border-emerald-600 bg-emerald-50 text-emerald-800"
                                  : "border-stone-300 bg-white text-stone-500"
                              }`}
                            >
                              {METRIC_EN[m] ?? m}
                            </button>
                          );
                        })}
                      <button
                        type="button"
                        disabled={contract.isPending}
                        onClick={() =>
                          contract.mutate(
                            {
                              variantId: selVariant.id,
                              success: {
                                primary: draftPrimary,
                                guardrails: draftGuards,
                                mdeRel: selVariant.success?.mdeRel ?? 0.1,
                              },
                            },
                            // Stäng bara vid VERKLIG lyckad skrivning — vid
                            // {ok:false}/nätverksfel står editorn kvar med
                            // draften och felet nedan.
                            {
                              onSuccess: (res) => {
                                if (res.ok) setEditingContract(null);
                              },
                            },
                          )
                        }
                        className="rounded-lg bg-emerald-700 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingContract(null)}
                        className="text-[11.5px] font-semibold text-stone-500 hover:text-stone-700"
                      >
                        Cancel
                      </button>
                      {contractError && (
                        <span className="text-[11.5px] font-semibold text-red-600">
                          {contractError}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {/* "Other websites" avmystifierad: vilka sajter länkarna faktiskt
                  kommer från. Renderas BARA för other-valet och BARA när servern
                  släppt igenom volymen — annars noll yta (brus-principen). */}
              {segmentDims(sel.key)[0] === "other" && otherDomains.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2.5 flex items-baseline gap-2">
                    <div className="font-heading text-sm font-semibold">Top referring sites</div>
                    <div className="text-[11.5px] text-stone-400">
                      where these visitors came from
                    </div>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[#f0eee9]">
                    {otherDomains.map((d) => (
                      <div
                        key={d.domain}
                        className="flex items-center justify-between border-t border-[#f4f2ef] px-[18px] py-2.5 first:border-t-0"
                      >
                        <span className="min-w-0 truncate font-mono text-[12px] text-stone-700">
                          {d.domain}
                        </span>
                        <span className="ml-3 flex-none text-[12px] tabular-nums text-stone-500">
                          {fmt(d.visits)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* varianterna som hör till valet — ägarens knappar bor här */}
              <div className="mt-6">
                <div className="mb-2.5 flex items-baseline gap-2">
                  <div className="font-heading text-sm font-semibold">Variants</div>
                  <div className="text-[11.5px] text-stone-400">in {enLabel(sel.label)}</div>
                </div>
                {selScoped.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-200 px-[18px] py-5 text-[13px] text-stone-400">
                    {/* Ärlighet om grinden (glutenforum-fyndet): designer byggs PER
                        SIDA, så gruppens sajtsumma kan se "klar" ut medan ingen
                        enskild sida bär volymen. Visa progressen mot det som
                        faktiskt låser upp — bästa sidan mot per-sida-grinden. */}
                    None yet — Angel designs per page, and proposes one once a single page gathers
                    enough of this group.
                    {sel.bestPage ? (
                      <div className="mt-2.5 flex items-center gap-2.5 text-[12px]">
                        <span className="flex-none text-stone-500">Closest page:</span>
                        <div className="h-1.5 w-[96px] flex-none overflow-hidden rounded-full bg-stone-200">
                          <div
                            className="h-full rounded-full bg-stone-400"
                            style={{
                              width: `${Math.min(100, Math.round((sel.bestPage.visits / sel.bestPage.gate) * 100))}%`,
                            }}
                          />
                        </div>
                        <span className="flex-none tabular-nums text-stone-500">
                          {fmt(sel.bestPage.visits)}/{fmt(sel.bestPage.gate)} visits
                        </span>
                        <span className="min-w-0 truncate font-mono text-[11.5px]">
                          {sel.bestPage.path}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-[#f0eee9]">
                    {selScoped.map((v) => {
                      const arms = v.abTest
                        ? judgeArms({ variant: v.abTest.variant, control: v.abTest.control })
                        : null;
                      const pill = STATUS_PILL[v.status] ?? STATUS_PILL.verified;
                      return (
                        <div key={v.id} className="border-t border-[#f4f2ef] first:border-t-0">
                          <div className="flex items-center gap-3.5 px-4 py-3">
                            <div
                              className={
                                "min-w-0 flex-1" +
                                (v.abTest?.allMetrics ? " cursor-pointer select-none" : "")
                              }
                              onClick={
                                v.abTest?.allMetrics
                                  ? () => setMetricsId(metricsId === v.id ? null : v.id)
                                  : undefined
                              }
                              title={
                                v.abTest?.allMetrics
                                  ? metricsId === v.id
                                    ? "Hide all metrics"
                                    : "Show all metrics"
                                  : undefined
                              }
                            >
                              <div className="truncate font-mono text-[12px] text-stone-800">
                                {v.abTest?.allMetrics && (
                                  <span className="mr-1 text-stone-400">
                                    {metricsId === v.id ? "▾" : "▸"}
                                  </span>
                                )}
                                {v.segmentKey} <span className="text-[#c4beb6]">·</span>{" "}
                                <span className="text-stone-400">{v.path}</span>
                                {/* Härkomsten (steg 11): kom förslaget ur den
                                    beteende-rankade katalogen eller ur den fria
                                    designern? Skrevs i evidence men lästes av
                                    ingen förrän nu (granskningsfynd 2026-08-08). */}
                                {planSourceLabel(v.planSource) ? (
                                  <>
                                    {" "}
                                    <span className="text-[#c4beb6]">·</span>{" "}
                                    <span
                                      className="text-stone-400"
                                      title={`Plan source: ${v.planSource}`}
                                    >
                                      {planSourceLabel(v.planSource)}
                                    </span>
                                  </>
                                ) : null}
                                {/* Blockbibliotekets proveniens: återbrukat
                                    bevisat block — ägaren ska se VAR det vann.
                                    Överföringen hit är obevisad tills cellens
                                    eget A/B körts (tooltip säger det rakt ut). */}
                                {v.reusedFrom ? (
                                  <>
                                    {" "}
                                    <span className="text-[#c4beb6]">·</span>{" "}
                                    <span
                                      className="text-emerald-700"
                                      title={
                                        reuseProvenanceLabel(v.reusedKind ?? "text", v.reusedFrom)
                                          .title
                                      }
                                    >
                                      {
                                        reuseProvenanceLabel(v.reusedKind ?? "text", v.reusedFrom)
                                          .label
                                      }
                                    </span>
                                  </>
                                ) : null}
                              </div>
                              <div className="mt-0.5 text-[11.5px] text-stone-500">
                                {arms?.arms ? (
                                  <>
                                    variant{" "}
                                    {arms.arms.variant.visits > 0
                                      ? pct(
                                          arms.arms.variant.conversions / arms.arms.variant.visits,
                                        )
                                      : "—"}{" "}
                                    · control{" "}
                                    {arms.arms.control.visits > 0
                                      ? pct(
                                          arms.arms.control.conversions / arms.arms.control.visits,
                                        )
                                      : "—"}{" "}
                                    <span
                                      className="font-bold"
                                      style={{
                                        color: (arms.liftRel ?? 0) >= 0 ? "#047857" : "#dc2626",
                                      }}
                                    >
                                      {liftFmt(arms.liftRel)}
                                    </span>
                                    {/* Ärlig tidshorisont (gap-audit Tier-1): när datat inte
                                        räcker sägs det RAKT hur långt bort ett domslut är vid
                                        sajtens verkliga trafik — i stället för en evig
                                        "measuring" som ser ut som framsteg. */}
                                    {v.abTest?.outcome === "insufficient_data" &&
                                      v.abTest.prognosis && (
                                        <span className="text-stone-400">
                                          {" "}
                                          · verdict needs ~
                                          {v.abTest.prognosis.neededPerArm.toLocaleString()}/arm
                                          {v.abTest.prognosis.estDaysAtSiteTraffic !== null &&
                                            ` (≈${v.abTest.prognosis.estDaysAtSiteTraffic.toLocaleString()} days at current traffic)`}
                                        </span>
                                      )}
                                  </>
                                ) : v.status === "verified" ? (
                                  "verified — waiting for your go-ahead"
                                ) : (
                                  "measuring — too early to read"
                                )}
                              </div>
                              {/* Utspädningsdiagnostiken (flimmervakten): laddningar
                                  som loggades som visad variant men fick originalet.
                                  Riktningen är konservativ (varianten ser sämre ut än
                                  den är), men ägaren ska SE den — orsakerna kräver
                                  olika åtgärder. Räknat i det lästa händelsefönstret. */}
                              {v.applySkips && v.applySkips.total > 0 && (
                                <div
                                  className="mt-0.5 text-[11px] text-amber-700"
                                  title={
                                    "Loads counted as exposed to the variant where the visitor actually saw the original (recent event window). " +
                                    "viewport-guard: the visitor stayed in the target region the whole window, so the flicker guard refused a visible move. " +
                                    "targets-missing: the variant's targets never appeared on the page. " +
                                    "wiped-not-restored: the site's framework re-rendered and wiped an applied variant. " +
                                    "Dilution pulls the measured effect toward zero: it understates a good variant's lift and can mask a harmful one's damage — keep this number low."
                                  }
                                >
                                  {v.applySkips.total} skipped{" "}
                                  {v.applySkips.total === 1 ? "apply" : "applies"}
                                  {" — "}
                                  {(
                                    [
                                      ["viewport-guard", v.applySkips.byReason["viewport-guard"]],
                                      ["targets-missing", v.applySkips.byReason["targets-missing"]],
                                      ["wiped", v.applySkips.byReason["wiped-not-restored"]],
                                      ["other", v.applySkips.byReason.other],
                                    ] as const
                                  )
                                    .filter(([, n]) => n > 0)
                                    .map(([label, n]) => `${n} ${label}`)
                                    .join(" · ")}
                                </div>
                              )}
                            </div>
                            <span
                              className="flex-none rounded-full px-[9px] py-[3px] text-[11px] font-semibold"
                              style={{ background: pill.bg, color: pill.color }}
                            >
                              {v.status === "winner" ? "winner · 100%" : v.status}
                            </span>
                            {v.heldReason ? (
                              // Självläkningen (slice 3): maskinellt pausad tills
                              // källans nya text passerat grindarna — ägarens
                              // status orörd, ingen åtgärd krävs av ägaren.
                              <span
                                className="flex-none rounded-full px-[9px] py-[3px] text-[11px] font-semibold"
                                style={{ background: "#fffbeb", color: "#b45309" }}
                                title={v.heldReason}
                              >
                                {v.heldReason?.startsWith("guardrail:")
                                  ? "paused — guardrail harmed"
                                  : "paused — source changed"}
                              </span>
                            ) : null}
                            {v.ruling?.verdict === "guardrail_breach" ? (
                              <span
                                title={`Skyddsmått försämrat: ${v.ruling.breachedMetrics
                                  .map((m) => METRIC_EN[m] ?? m)
                                  .join(", ")} — primärvinst köper inte guardrail-skada.`}
                                className="flex-none rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700"
                              >
                                guardrail harmed — pause recommended
                              </span>
                            ) : null}
                            {/* EN primär åtgärd per rad (design v3):
                                verified → Start A/B; rekommenderad vinnare →
                                Make winner; annars Compare. Resten bor i ···. */}
                            {v.status === "verified" ? (
                              <button
                                type="button"
                                disabled={status.isPending}
                                onClick={() => askStatus(v, "serving", "Start the A/B test")}
                                className="flex-none rounded-lg border border-stone-300 bg-white px-[13px] py-1.5 text-[12.5px] font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
                              >
                                Start A/B
                              </button>
                            ) : v.status === "serving" &&
                              v.abTest?.outcome === "recommend_winner" ? (
                              <button
                                type="button"
                                disabled={status.isPending}
                                onClick={() =>
                                  askStatus(
                                    v,
                                    "winner",
                                    "Make winner — serves 100% of the segment and ends the measurement",
                                  )
                                }
                                className="flex-none rounded-lg bg-emerald-700 px-[13px] py-1.5 text-[12.5px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                              >
                                Make winner
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setCompareId(compareId === v.id ? null : v.id)}
                                className="flex-none rounded-lg border border-stone-200 bg-white px-[13px] py-1.5 text-[12.5px] font-semibold text-stone-600 hover:bg-stone-50"
                              >
                                {compareId === v.id ? "Hide" : "Compare"}
                              </button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  title="More actions"
                                  className="flex-none px-1 text-[16px] leading-none text-stone-400 hover:text-stone-600"
                                >
                                  ···
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() => setCompareId(compareId === v.id ? null : v.id)}
                                >
                                  {compareId === v.id ? "Hide comparison" : "Compare"}
                                </DropdownMenuItem>
                                {v.status === "verified" && (
                                  <DropdownMenuItem
                                    disabled={status.isPending}
                                    onSelect={() => askStatus(v, "serving", "Start the A/B test")}
                                  >
                                    Start A/B
                                  </DropdownMenuItem>
                                )}
                                {v.status === "serving" &&
                                  v.abTest?.outcome === "recommend_winner" && (
                                    <DropdownMenuItem
                                      disabled={status.isPending}
                                      onSelect={() =>
                                        askStatus(
                                          v,
                                          "winner",
                                          "Make winner — serves 100% of the segment and ends the measurement",
                                        )
                                      }
                                    >
                                      Make winner
                                    </DropdownMenuItem>
                                  )}
                                {(v.status === "serving" || v.status === "winner") && (
                                  <DropdownMenuItem
                                    disabled={status.isPending}
                                    className="text-red-600"
                                    onSelect={() =>
                                      askStatus(
                                        v,
                                        "retired",
                                        "Stop the variant (control takes back 100%)",
                                      )
                                    }
                                  >
                                    Stop variant
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {/* Hela mätartabellen — läsning, aldrig besluts-yta:
                              domslutet fattas av huvudmåttet + skyddsvetona. */}
                          {metricsId === v.id && v.abTest?.allMetrics && (
                            <div className="border-t border-[#f4f2ef] bg-[#faf9f7] px-4 py-3">
                              <div className="flex pb-1.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-stone-400">
                                <div className="flex-1">Metric</div>
                                <div className="w-[130px] text-right" style={{ color: "#065f46" }}>
                                  Adapted
                                </div>
                                <div className="w-[130px] text-right">Control</div>
                              </div>
                              {metricTableRows(v.abTest.allMetrics).map((r) => (
                                <div
                                  key={r.label}
                                  className="flex border-t border-[#f0eee9] py-1.5 text-[11.5px]"
                                >
                                  <div className="flex-1 text-stone-500">{r.label}</div>
                                  <div className="w-[130px] text-right font-mono tabular-nums text-stone-800">
                                    {r.variant}
                                  </div>
                                  <div className="w-[130px] text-right font-mono tabular-nums text-stone-500">
                                    {r.control}
                                  </div>
                                </div>
                              ))}
                              <div className="mt-2 text-[10.5px] text-stone-400">
                                Reading only — the verdict is decided by the primary metric, with
                                guardrail vetoes on harm.
                              </div>
                            </div>
                          )}
                          {compareId === v.id && (
                            <CompareOverlay site={site} v={v} onClose={() => setCompareId(null)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {statusError && <div className="mt-2 text-[12px] text-red-600">{statusError}</div>}
                {!servingOn && selScoped.some((v) => v.status !== "verified") && (
                  <div className="mt-2 text-[11.5px] text-stone-400">
                    Serving is switched off for the site — variants only reach visitors when the
                    master switch in Settings is on.
                  </div>
                )}
              </div>

              {/* resorna — rage-signalerna hopslagna till EN siffra */}
              <div className="mt-7">
                <div className="mb-1.5 flex items-center justify-between gap-2.5">
                  <div className="font-heading text-sm font-semibold">Recent journeys</div>
                  <button
                    type="button"
                    onClick={() => setJourneysOpen(true)}
                    title="View journeys & frustration heatmap"
                    className="inline-flex items-center gap-[7px] rounded-full border px-[11px] py-1 text-[12px] font-semibold"
                    style={{
                      background: "#fff7ed",
                      borderColor: "#fed7aa",
                      color: "#c2660c",
                    }}
                  >
                    <span
                      className="h-[7px] w-[7px] rounded-full"
                      style={{ background: "#d97706" }}
                    />
                    {rageTotal} rage bursts
                    <span style={{ color: "#f0a559" }}>→</span>
                  </button>
                </div>
                {selJourneys.length === 0 && (
                  <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                    No recorded journeys for this group in the window.
                  </div>
                )}
                {selJourneys.slice(0, 3).map((j) => (
                  <button
                    key={j.sessionId}
                    type="button"
                    onClick={() => setJourneysOpen(true)}
                    className="-mx-2.5 flex w-[calc(100%+20px)] items-center gap-2.5 rounded-lg border-t border-[#f4f2ef] px-2.5 py-2.5 text-left hover:bg-[#faf9f7]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11.5px] text-stone-600">
                        {(j.pageOrder.length ? j.pageOrder : [j.landingPath ?? "/"]).join(" → ")}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-stone-400">
                          {Math.round(j.engagedMs / 1000)}s engaged
                        </span>
                        <span
                          className="text-[11.5px] font-semibold"
                          style={{
                            color: j.converted
                              ? "#047857"
                              : j.formAbandoned
                                ? "#d97706"
                                : "#78716c",
                          }}
                        >
                          {j.converted
                            ? "converted"
                            : j.formAbandoned
                              ? "abandoned form"
                              : "browsed"}
                        </span>
                      </div>
                    </div>
                    <span className="flex-none text-[12px] text-[#c4beb6]">→</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* rad 3 — blockbibliotekets läsvy (ägarfråga 2026-08-10: "mest omtyckta
          styckena"). ÄRLIGHETEN I RUBRIKVALET: detta är uppmätt UPPMÄRKSAMHET
          (≥1 s synlighet på orörda laddningar) — inte bevisad konvertering;
          attribution utan test är positionsbias. Sorteringen är evidensviktad
          med sätets krympning så tunna stickprov inte toppar. Tom lista
          (censusen ung / under evidensgolvet) ⇒ hela kortet vilar. */}
      {topSections.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          <div className="px-[22px] pt-6">
            <div className="flex items-baseline gap-2">
              <div className="font-heading text-[15px] font-semibold">Most engaging sections</div>
              <div className="text-[11px] text-stone-400">
                what visitors actually stop and look at
              </div>
            </div>
            <div className="mt-0.5 text-[11.5px] text-stone-400">
              Share of untouched loads where the section stayed in view ≥1s — measured attention,
              not proven conversion. Ranked with the same evidence weighting the engine uses, so
              thin samples can&apos;t top the list.
            </div>
          </div>
          <div className="mt-3.5">
            <div className="flex bg-[#faf9f7] px-[22px] py-2.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-stone-400">
              <span className="flex-1">Section</span>
              <span className="w-[84px] text-right">Seen ≥1s</span>
              <span className="w-[84px] text-right">Loads</span>
            </div>
            {topSections.map((s) => (
              <div
                key={`${s.path}::${s.heading}`}
                className="flex items-center border-t border-[#f0eee9] px-[22px] py-2.5 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate">
                  {s.heading}{" "}
                  <span className="font-mono text-[11.5px] text-stone-400">{s.path}</span>
                </span>
                {/* honestPercent: delad kantavrundnings-regel med väljar-menyn. */}
                <span className="w-[84px] text-right font-semibold tabular-nums">
                  {honestPercent(s.engagement)}%
                </span>
                <span className="w-[84px] text-right tabular-nums text-stone-500">
                  {s.visits.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {journeysOpen && (
        <JourneysOverlay
          site={site}
          journeys={selJourneys}
          rageClicks={rageClicks}
          searches={searches}
          contextLabel={sel ? enLabel(sel.label) : "All sources"}
          // Segmentets enhetsdimension låser heatmap-vyn (tablet ⇒ desktop-
          // layouten, samma bucketing som attributionen); okänd enhet låser
          // inte — då är växeln fortfarande meningsfull.
          lockedDevice={
            selDims[1] === "mobile"
              ? "mobile"
              : selDims[1] === "desktop" || selDims[1] === "tablet"
                ? "desktop"
                : null
          }
          onClose={() => setJourneysOpen(false)}
        />
      )}
    </div>
  );
}

/** Resan till bevisat — stanna-tills-bevisat-berättelsen (journey.ts).
 *  Varje detaljrad är en mätning ur sajtens eget data; "current" bär den
 *  fylliga raden, senaste "done" behåller sin (vad hände nyss + vad pågår).
 *  När det ärliga domslutet finns är berättelsen klar och kortet försvinner —
 *  då ÄR dashboardens riktiga siffror berättelsen. */
/** Minimeringsvalet minns per webbläsare — kortet är guld första veckorna
 *  och brus när ägaren kan resan utantill (ägarbeslut 2026-07-27). */
const ROAD_MIN_KEY = "angel-road-minimized";

function JourneyCard({ journey }: { journey: JourneyMilestone[] }) {
  // Hooks FÖRE alla early-returns (React-regeln). localStorage läses i en
  // effect — inte i initialiseraren — så SSR-hydreringen aldrig spricker;
  // priset är en kort expanderad blink för den som minimerat.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(ROAD_MIN_KEY) === "1") setMinimized(true);
    } catch {
      /* lagring blockerad — kortet börjar expanderat */
    }
  }, []);
  const toggle = () =>
    setMinimized((prev) => {
      try {
        localStorage.setItem(ROAD_MIN_KEY, prev ? "0" : "1");
      } catch {
        /* valet gäller då bara denna vy */
      }
      return !prev;
    });

  if (journey.length === 0) return null;
  const verdictDone = journey.find((m) => m.id === "verdict")?.state === "done";
  if (verdictDone) return null;
  const doneCount = journey.filter((m) => m.state === "done").length;
  const lastDoneIdx = journey.reduce((acc, m, i) => (m.state === "done" ? i : acc), -1);
  const current = journey.find((m) => m.state === "current");

  return (
    <div
      className={`rounded-2xl border border-stone-200 bg-white ${minimized ? "px-6 py-4" : "p-6"}`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!minimized}
        title={minimized ? "Expand" : "Minimize"}
        className="flex w-full cursor-pointer items-baseline justify-between text-left"
      >
        <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-emerald-600">
          The road to proven
        </div>
        <div className="font-mono text-[10.5px] text-stone-400">
          {doneCount} / {journey.length} <span className="ml-1">{minimized ? "▸" : "▾"}</span>
        </div>
      </button>
      {minimized && current && (
        <div className="mt-1 text-[12px] text-stone-500">
          Now: <span className="font-semibold text-stone-700">{current.title}</span>
        </div>
      )}
      {minimized ? null : (
        <ol className="mt-4 space-y-0">
          {journey.map((m, i) => {
            const showDetail = m.state === "current" || i === lastDoneIdx;
            return (
              <li key={m.id} className="relative flex gap-3 pb-3 last:pb-0">
                {i < journey.length - 1 && (
                  <span
                    className="absolute left-[7px] top-5 h-full w-px"
                    style={{ background: m.state === "done" ? "#a7f3d0" : "#e7e5e4" }}
                  />
                )}
                <span
                  className="relative mt-1 flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full text-[9px] font-bold"
                  style={{
                    background:
                      m.state === "done"
                        ? "#047857"
                        : m.state === "current"
                          ? "#ecfdf5"
                          : "#f5f5f4",
                    color: m.state === "done" ? "#fff" : "#a8a29e",
                    border:
                      m.state === "current" ? "1.5px solid #047857" : "1.5px solid transparent",
                  }}
                >
                  {m.state === "done" ? "✓" : ""}
                  {m.state === "current" && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-700" />
                  )}
                </span>
                <div className="min-w-0">
                  <div
                    className={`text-[13px] font-semibold ${
                      m.state === "upcoming"
                        ? "text-stone-400"
                        : m.state === "current"
                          ? "text-stone-900"
                          : "text-stone-600"
                    }`}
                  >
                    {m.title}
                  </div>
                  {showDetail && (
                    <p
                      className={`mt-0.5 text-[12.5px] leading-relaxed ${
                        m.state === "current" ? "text-stone-600" : "text-stone-400"
                      }`}
                    >
                      {m.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
