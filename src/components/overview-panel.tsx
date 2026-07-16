// Dashboard "Overview" — den kurerade 1B-layouten ur design-handoffen
// (design_handoff_angel_redesign, 2026-07-16): svarskort + KPI-rutnät +
// tvåpanels källutforskare (träd → detalj).
//
// Prototypens siffror var demo. Här driver RIKTIG data varje yta, med ärliga
// lägen i stället för påhitt: inga servande varianter ⇒ "Observing"; för
// tunt underlag ⇒ "Too early to tell" (success–failure-regeln, samma predikat
// som A/B-utvärderaren); lift och sannolikhet räknas ur variant-armarna med
// samma z-test som allt annat. Ingen yta visar ett tal vi inte kan försvara.

import { useMemo, useState } from "react";

import { armStatValid, twoProportionZ } from "@/lib/dashboard/aggregate";

import type {
  Overview,
  RageSignal,
  SegmentSummary,
  SessionSummary,
} from "@/lib/dashboard/aggregate";
import type { VariantView } from "@/lib/dashboard/dashboard.functions";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (r: number, digits = 1) => `${(r * 100).toFixed(digits)}%`;

/** Ensidig normal-CDF ur z — "sannolikheten att liften är äkta". Abramowitz–
 *  Stegun-approximation; samma tal-art som vinnar-utvärderarens grindar. */
function probFromZ(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

interface Arms {
  variant: { visits: number; conversions: number };
  control: { visits: number; conversions: number };
}

/** Summera armarna över en uppsättning servande/vinnande varianter. */
function sumArms(variants: VariantView[]): Arms | null {
  const live = variants.filter(
    (v) => (v.status === "serving" || v.status === "winner") && v.abTest,
  );
  if (live.length === 0) return null;
  const acc: Arms = { variant: { visits: 0, conversions: 0 }, control: { visits: 0, conversions: 0 } };
  for (const v of live) {
    acc.variant.visits += v.abTest!.variant.visits;
    acc.variant.conversions += v.abTest!.variant.conversions;
    acc.control.visits += v.abTest!.control.visits;
    acc.control.conversions += v.abTest!.control.conversions;
  }
  return acc;
}

interface ArmVerdict {
  state: "observing" | "insufficient" | "measured";
  liftRel: number | null;
  prob: number | null;
  arms: Arms | null;
}

function judgeArms(arms: Arms | null): ArmVerdict {
  if (!arms) return { state: "observing", liftRel: null, prob: null, arms: null };
  const ok =
    armStatValid(arms.variant.visits, arms.variant.conversions) &&
    armStatValid(arms.control.visits, arms.control.conversions);
  const crV = arms.variant.visits > 0 ? arms.variant.conversions / arms.variant.visits : 0;
  const crC = arms.control.visits > 0 ? arms.control.conversions / arms.control.visits : 0;
  const liftRel = crC > 0 ? (crV - crC) / crC : null;
  if (!ok) return { state: "insufficient", liftRel, prob: null, arms };
  const z = twoProportionZ(
    arms.variant.conversions,
    arms.variant.visits,
    arms.control.conversions,
    arms.control.visits,
  );
  return { state: "measured", liftRel, prob: z === null ? null : probFromZ(z), arms };
}

/** Finaste servande/vinnande variant vars segmentnyckel är prefix av `key`
 *  (samma lån-styrka-regel som serve-vägen), för detaljpanelen. */
function variantFor(variants: VariantView[], key: string): VariantView | null {
  const dims = key.split("·");
  let best: VariantView | null = null;
  for (const v of variants) {
    if (v.status !== "serving" && v.status !== "winner") continue;
    const vd = v.segmentKey.split("·");
    if (vd.length > dims.length) continue;
    if (!vd.every((d, i) => d === dims[i])) continue;
    if (!best || vd.length > best.segmentKey.split("·").length) best = v;
  }
  return best;
}

const KIND_BY_DEPTH = ["Channel", "Channel · Device", "Channel · Device · Country", "Full segment"];

export function OverviewPanel({
  overview,
  segments,
  sessions,
  rageClicks,
  variants,
  rampPct,
}: {
  overview: Overview;
  segments: SegmentSummary[];
  sessions: SessionSummary[];
  rageClicks: RageSignal[];
  variants: VariantView[];
  rampPct: number;
}) {
  // ── trädet: nycklarna ÄR hierarkin (grov→fin, prefix = förälder) ──────────
  const byKey = useMemo(() => new Map(segments.map((s) => [s.key, s])), [segments]);
  const children = useMemo(() => {
    const m = new Map<string | null, SegmentSummary[]>();
    for (const s of segments) {
      const parent = s.depth === 1 ? null : s.key.split("·").slice(0, -1).join("·");
      const list = m.get(parent) ?? [];
      list.push(s);
      m.set(parent, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.visits - a.visits);
    return m;
  }, [segments]);

  const roots = children.get(null) ?? [];
  const [open, setOpen] = useState<Set<string>>(() => new Set(roots.slice(0, 1).map((r) => r.key)));
  const [selected, setSelected] = useState<string | null>(roots[0]?.key ?? null);
  const sel = selected ? (byKey.get(selected) ?? null) : null;

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
  walk(roots, 0);

  const activate = (s: SegmentSummary) => {
    setSelected(s.key);
    if ((children.get(s.key) ?? []).length > 0) {
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(s.key)) next.delete(s.key);
        else next.add(s.key);
        return next;
      });
    }
  };

  // ── svarskortet: summerade armar över allt som serverar ───────────────────
  const site = judgeArms(sumArms(variants));

  // ── detaljpanelen: variant + armar + resor + frustration för valet ────────
  const selVariant = sel ? variantFor(variants, sel.key) : null;
  const selArms = selVariant?.abTest
    ? judgeArms({
        variant: selVariant.abTest.variant,
        control: selVariant.abTest.control,
      })
    : judgeArms(null);
  const selDims = sel?.key.split("·") ?? [];
  const selJourneys = sessions
    .filter((j) => {
      if (!sel) return false;
      if (selDims[0] && (j.channel ?? "okänd") !== selDims[0]) return false;
      if (selDims[1] && (j.device ?? "okänd") !== selDims[1]) return false;
      if (selDims[2] && (j.country ?? "okänd") !== selDims[2]) return false;
      if (selDims[3] && (j.isReturning ? "återkommande" : "ny") !== selDims[3]) return false;
      return true;
    })
    .slice(0, 3);

  const kpis = [
    { label: "Pageviews", value: fmt(overview.pageviews) },
    { label: "Identified visitors", value: fmt(overview.uniqueVisitors) },
    { label: "Conversions", value: fmt(overview.conversions) },
    { label: "Conversion rate", value: pct(overview.conversionRate) },
  ];

  return (
    <div className="space-y-4">
      {/* rad 1 — svarskortet + KPI:er */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div
          className="rounded-2xl border p-6"
          style={{
            borderColor: site.state === "measured" && (site.liftRel ?? 0) > 0 ? "#d1fae5" : "#e7e5e4",
            background:
              site.state === "measured" && (site.liftRel ?? 0) > 0
                ? "linear-gradient(180deg,#f0fdf7,#ffffff)"
                : "#fff",
          }}
        >
          <div className="font-mono text-[10.5px] uppercase tracking-[.14em] text-emerald-600">
            Is Angel earning its keep?
          </div>
          {site.state === "observing" && (
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
          {site.state === "insufficient" && site.arms && (
            <>
              <div className="mt-2 font-heading text-3xl font-bold tracking-tight text-stone-800">
                Too early to tell
              </div>
              <p className="mt-2 text-[13.5px] text-stone-600">
                {fmt(site.arms.variant.visits)} adapted and {fmt(site.arms.control.visits)} control
                visitors so far — the honest answer needs more of both.
              </p>
            </>
          )}
          {site.state === "measured" && site.liftRel !== null && (
            <>
              <div
                className="mt-2 font-heading text-3xl font-bold tracking-tight"
                style={{ color: site.liftRel > 0 ? "#065f46" : "#78350f" }}
              >
                {site.liftRel > 0
                  ? `Yes — +${(site.liftRel * 100).toFixed(0)}% lift`
                  : `Not yet — ${(site.liftRel * 100).toFixed(0)}%`}
              </div>
              <p className="mt-2 text-[13.5px] text-stone-600">
                Adapted visitors convert {site.liftRel > 0 ? "more" : "less"} than the held-back
                control group.
              </p>
              {site.prob !== null && (
                <div className="mt-4 flex items-center gap-2.5">
                  <div className="h-1.5 max-w-[300px] flex-1 overflow-hidden rounded-full bg-stone-200">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${Math.round(site.prob * 100)}%` }}
                    />
                  </div>
                  <span className="text-[12.5px] text-stone-600">
                    <b className="text-emerald-900">{Math.round(site.prob * 100)}%</b> probability
                    it&apos;s real
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-[13px] border border-[#f0eee9] bg-white px-[18px] py-4">
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
        {/* vänster: trädet */}
        <div className="w-[400px] flex-none border-r border-[#f0eee9] px-[22px] pb-7 pt-6 max-lg:w-full max-lg:border-r-0 max-lg:border-b">
          <div className="font-heading text-[15px] font-semibold">Sources</div>
          <div className="mb-3.5 mt-0.5 text-[11.5px] text-stone-400">
            Channel → device → country. Click to break down.
          </div>
          <div className="flex items-center gap-2.5 border-b border-[#f4f2ef] px-2.5 pb-2">
            <span className="flex-1 text-[10px] font-bold uppercase tracking-[.07em] text-[#c4beb6]">Source</span>
            <span className="w-14 text-right text-[10px] font-bold uppercase tracking-[.07em] text-[#c4beb6]">Visits</span>
            <span className="w-[46px] text-right text-[10px] font-bold uppercase tracking-[.07em] text-[#c4beb6]">Lift</span>
          </div>
          {rows.length === 0 && (
            <div className="px-2.5 py-6 text-[12.5px] text-stone-400">
              Groups appear as soon as visitors arrive.
            </div>
          )}
          {rows.map(({ s, depth, caret }) => {
            const v = variantFor(variants, s.key);
            const lift =
              v?.abTest && v.segmentKey === s.key ? judgeArms({
                variant: v.abTest.variant,
                control: v.abTest.control,
              }) : null;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => activate(s)}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-[11px] text-left hover:bg-[#f7f6f4]"
                style={{ background: selected === s.key ? "#f0fdf7" : undefined }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft: depth * 22 }}>
                  <span className="w-[11px] flex-none text-[10px] text-stone-400">{caret}</span>
                  <span className="truncate text-[13px] font-semibold">{s.label}</span>
                </div>
                <span className="w-14 text-right text-[12.5px] tabular-nums text-stone-500">{fmt(s.visits)}</span>
                <span className="w-[46px] text-right text-[11.5px] font-bold text-emerald-700">
                  {lift?.liftRel != null ? `${lift.liftRel > 0 ? "+" : ""}${(lift.liftRel * 100).toFixed(0)}%` : "—"}
                </span>
              </button>
            );
          })}
        </div>

        {/* höger: detaljpanelen */}
        <div className="min-w-0 flex-1 px-8 pb-8 pt-7">
          {!sel && (
            <div className="py-16 text-center text-[13.5px] text-stone-400">
              Select a group to see how Angel performs for it.
            </div>
          )}
          {sel && (
            <>
              <div className="font-mono text-[10.5px] uppercase tracking-[.12em] text-stone-400">
                {KIND_BY_DEPTH[sel.depth - 1] ?? "Segment"}
              </div>
              <div className="mt-1 font-heading text-[25px] font-bold tracking-tight">
                {sel.label}
              </div>
              <div className="mt-1.5 text-[13px] text-stone-500">
                {sel.adequate
                  ? `${fmt(sel.visits)} visits in the window — enough to read on its own.`
                  : `Only ${fmt(sel.visits)} visits — borrowing strength from the parent group until this one can stand alone.`}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
                <div className="rounded-xl border border-[#f0eee9] px-4 py-[15px]">
                  <div className="text-[11px] font-semibold text-stone-400">Visitors</div>
                  <div className="mt-1 font-heading text-[21px] font-semibold">{fmt(sel.visits)}</div>
                </div>
                <div className="rounded-xl border border-[#f0eee9] px-4 py-[15px]">
                  <div className="text-[11px] font-semibold text-stone-400">Conversion rate</div>
                  <div className="mt-1 font-heading text-[21px] font-semibold">{pct(sel.conversionRate)}</div>
                </div>
                <div
                  className="rounded-xl border px-4 py-[15px]"
                  style={
                    selArms.liftRel != null
                      ? { borderColor: "#d1fae5", background: "#f0fdf7" }
                      : { borderColor: "#f0eee9" }
                  }
                >
                  <div className="text-[11px] font-semibold" style={{ color: selArms.liftRel != null ? "#059669" : "#a8a29e" }}>
                    Lift vs control
                  </div>
                  <div className="mt-1 font-heading text-[21px] font-semibold" style={{ color: selArms.liftRel != null ? "#065f46" : "#a8a29e" }}>
                    {selArms.liftRel != null ? `${selArms.liftRel > 0 ? "+" : ""}${(selArms.liftRel * 100).toFixed(0)}%` : "—"}
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-2.5 font-heading text-sm font-semibold">Adapted vs control</div>
                {selArms.arms ? (
                  <>
                    <div className="overflow-hidden rounded-xl border border-[#f0eee9]">
                      <div className="flex bg-[#faf9f7] px-[18px] py-2.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-stone-400">
                        <span className="flex-1">Arm</span>
                        <span className="w-[92px] text-right">Visitors</span>
                        <span className="w-[100px] text-right">Conv. rate</span>
                        <span className="w-[92px] text-right">Conversions</span>
                      </div>
                      {(
                        [
                          ["Adapted", selArms.arms.variant, "#065f46"],
                          ["Control", selArms.arms.control, "#78716c"],
                        ] as const
                      ).map(([label, arm, color]) => (
                        <div key={label} className="flex items-center border-t border-[#f0eee9] px-[18px] py-3 text-[13px] tabular-nums">
                          <span className="flex-1 font-semibold" style={{ color }}>{label}</span>
                          <span className="w-[92px] text-right">{fmt(arm.visits)}</span>
                          <span className="w-[100px] text-right font-semibold">
                            {arm.visits > 0 ? pct(arm.conversions / arm.visits) : "—"}
                          </span>
                          <span className="w-[92px] text-right">{fmt(arm.conversions)}</span>
                        </div>
                      ))}
                    </div>
                    {selArms.state === "measured" && selArms.prob !== null ? (
                      <div className="mt-3 flex items-center gap-2.5">
                        <div className="h-1.5 max-w-[240px] flex-1 overflow-hidden rounded-full bg-stone-200">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.round(selArms.prob * 100)}%` }} />
                        </div>
                        <span className="text-[12.5px] text-stone-600">
                          <b className="text-emerald-900">{Math.round(selArms.prob * 100)}%</b> probability the lift is real
                        </span>
                      </div>
                    ) : (
                      <div className="mt-3 text-[12.5px] text-stone-400">
                        Too few conversions on one of the arms yet — no probability is claimed until the math holds.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-stone-200 px-[18px] py-5 text-[13px] text-stone-400">
                    No test is running for this group yet.
                  </div>
                )}
              </div>

              <div className="mt-6 flex items-center justify-between rounded-xl border border-[#f0eee9] px-[18px] py-[15px]">
                <div>
                  <div className="text-[11px] font-semibold text-stone-400">Winning variant for this source</div>
                  <div className="mt-0.5 text-sm font-semibold">
                    {selVariant ? `${selVariant.path} · ${selVariant.segmentKey}` : "None yet — Angel proposes one when the group has earned it"}
                  </div>
                </div>
                {selVariant && (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11.5px] font-bold text-emerald-700">
                    {selVariant.status === "winner" ? "winner · 100%" : `serving ${rampPct}%`}
                  </span>
                )}
              </div>

              <div className="mt-7 grid grid-cols-2 gap-5 max-md:grid-cols-1">
                <div>
                  <div className="mb-2.5 font-heading text-sm font-semibold">Recent journeys</div>
                  {selJourneys.length === 0 && (
                    <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                      No recorded journeys for this group in the window.
                    </div>
                  )}
                  {selJourneys.map((j) => (
                    <div key={j.sessionId} className="border-t border-[#f4f2ef] py-2.5">
                      <div className="truncate font-mono text-[11.5px] text-stone-600">
                        {(j.pageOrder.length ? j.pageOrder : [j.landingPath ?? "/"]).join(" → ")}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-stone-400">
                          {Math.round(j.engagedMs / 1000)}s engaged
                        </span>
                        <span
                          className="text-[11.5px] font-semibold"
                          style={{ color: j.converted ? "#047857" : j.formAbandoned ? "#d97706" : "#78716c" }}
                        >
                          {j.converted ? "converted" : j.formAbandoned ? "abandoned form" : "browsed"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-2.5 font-heading text-sm font-semibold">Frustration signals</div>
                  {rageClicks.length === 0 && (
                    <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                      No rage clicks recorded. Good.
                    </div>
                  )}
                  {rageClicks.slice(0, 3).map((g) => (
                    <div key={g.ref} className="flex items-center justify-between border-t border-[#f4f2ef] py-2.5">
                      <span className="truncate font-mono text-[11.5px] text-stone-600">{g.ref}</span>
                      <span className="ml-3 flex-none text-[12px] font-semibold text-amber-600">
                        {g.bursts} rage bursts
                      </span>
                    </div>
                  ))}
                  <div className="mt-3 text-[11.5px] leading-normal text-stone-400">
                    Site-wide diagnostics — Angel never changes anything automatically from these.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
