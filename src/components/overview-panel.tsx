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

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createPagePreview, createVariantPreview } from "@/lib/dashboard/sandbox.functions";
import { setVariantStatus } from "@/lib/dashboard/dashboard.functions";
import { armStatValid, twoProportionZ } from "@/lib/dashboard/aggregate";
import { isDimsPrefix, parentSegmentKey, segmentDims, segmentKeysRelated } from "@/lib/segment-key";

import type {
  ClickHeat,
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
  const acc: Arms = {
    variant: { visits: 0, conversions: 0 },
    control: { visits: 0, conversions: 0 },
  };
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
 *  (samma lån-styrka-regel som serve-vägen). */
function variantFor(variants: VariantView[], key: string): VariantView | null {
  const dims = segmentDims(key);
  let best: VariantView | null = null;
  for (const v of variants) {
    if (v.status !== "serving" && v.status !== "winner") continue;
    const vd = segmentDims(v.segmentKey);
    if (!isDimsPrefix(vd, dims)) continue;
    if (!best || vd.length > segmentDims(best.segmentKey).length) best = v;
  }
  return best;
}

/** Uppmätt lift för en trädnod: bara när en variant serverar EXAKT den nyckeln. */
function liftForKey(variants: VariantView[], key: string): number | null {
  const v = variantFor(variants, key);
  if (!v?.abTest || v.segmentKey !== key) return null;
  return judgeArms({ variant: v.abTest.variant, control: v.abTest.control }).liftRel;
}

/** Varianterna som hör till ett val: nyckeln själv, allt under den, och den
 *  grövre variant som faktiskt serverar hit (lånad styrka). */
function scopedVariants(variants: VariantView[], key: string): VariantView[] {
  return variants.filter((v) => {
    if (v.status !== "verified" && v.status !== "serving" && v.status !== "winner") return false;
    return segmentKeysRelated(v.segmentKey, key);
  });
}

const KIND_BY_DEPTH = ["Channel", "Device", "Country", "Visitor type"];

const STATUS_PILL: Record<string, { bg: string; color: string }> = {
  verified: { bg: "#eff6ff", color: "#3730a3" },
  serving: { bg: "#ecfdf5", color: "#047857" },
  winner: { bg: "#d1fae5", color: "#065f46" },
};

/** Visningsöversättning av segment-tokens: nycklarna (lagrade i variant-
 *  segment_keys och byggda av aggregatets rollup) behåller sina tokens —
 *  bara ETIKETTEN blir engelska. */
const TOKEN_EN: Record<string, string> = { okänd: "unknown", ny: "new", återkommande: "returning" };
const enLabel = (label: string) =>
  label
    .split(" · ")
    .map((t) => TOKEN_EN[t] ?? t)
    .join(" · ");

const liftFmt = (liftRel: number | null) =>
  liftRel != null ? `${liftRel > 0 ? "+" : ""}${(liftRel * 100).toFixed(0)}%` : "—";

/** Heatmapens backdrop: den RIKTIGA sidan i spegeln (orörd, utan Angel),
 *  skalad till hela dokumenthöjden så klickens y-% träffar rätt. Spegeln är
 *  opak origin och kan inte läsas — sidan rapporterar sin egen höjd via
 *  postMessage (höjdrapportören injiceras av mirror-endpointen när h=1). */
function HeatMirror({
  src,
  overlay,
  maxHeight = 560,
  frameW = 1280,
}: {
  src: string;
  overlay: React.ReactNode;
  maxHeight?: number | string;
  /** Spegelns viewportbredd — MÅSTE matcha layouten klicken mättes i
   *  (390 = mobil, 1280 = desktop); x är % av besökarens viewportbredd. */
  frameW?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(700);
  const [docH, setDocH] = useState(2200);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWrapW(el.clientWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; h?: number } | null;
      if (d && d.type === "angel-mirror-height" && typeof d.h === "number") {
        // Klampad: en fientlig speglad sida kan bara flytta punkter i ägarens
        // egen vy av just den sidan — men vi tar inga orimliga värden.
        setDocH(Math.min(20000, Math.max(600, Math.round(d.h))));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const scale = wrapW > 0 ? Math.min(1, wrapW / frameW) : 0.5;
  return (
    <div
      ref={wrapRef}
      className="overflow-y-auto overflow-x-hidden rounded-[10px] border border-[#f0eee9] bg-white"
      style={{ maxHeight }}
    >
      {/* Inner-boxen har EXAKT spegelns visuella bredd (centrerad när smalare
          än wrappen — mobilvyn) så overlay-punkternas % mappar mot iframe-
          boxen, inte mot wrappens fulla bredd. */}
      <div
        className="relative mx-auto"
        style={{ height: Math.round(docH * scale), width: Math.round(frameW * scale) }}
      >
        <iframe
          src={src}
          title="Click heatmap backdrop"
          sandbox="allow-scripts"
          style={{
            width: frameW,
            height: docH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: 0,
            // Backdroppen är en karta, inte en sida att klicka på — pekaren
            // ska scrolla/hovra lagret ovanpå.
            pointerEvents: "none",
          }}
        />
        <div className="absolute inset-0">{overlay}</div>
      </div>
    </div>
  );
}

/** Mänskligt läsbara ändrings-chips för Compare-toppraden: "Moved 'X' #4 → #2"
 *  ur comparison-ordningen, "Rewrote a heading" för retext. Max 3 + "+N". */
function changeChips(v: VariantView): { shown: string[]; more: number } {
  const cmp = v.comparison;
  const out: string[] = [];
  for (const o of v.ops) {
    if (o.op === "move_up") {
      if (cmp?.movedLabel) {
        const from = cmp.orderBefore.indexOf(cmp.movedLabel) + 1;
        const to = cmp.orderAfter.indexOf(cmp.movedLabel) + 1;
        out.push(
          from > 0 && to > 0
            ? `Moved "${cmp.movedLabel}" #${from} → #${to}`
            : `Moved "${cmp.movedLabel}" up`,
        );
      } else {
        out.push("Moved a section up");
      }
    } else if (o.op === "set_text") {
      out.push("Rewrote a heading");
    } else {
      out.push(o.op);
    }
  }
  const dedup = out.filter((c, i) => out.indexOf(c) === i);
  return { shown: dedup.slice(0, 3), more: Math.max(0, dedup.length - 3) };
}

/** Compare i HELSKÄRM (ägarbeslut: panelen blev för liten): EN stor spegel av
 *  den riktiga sidan med en Variant/Original-växel — variantläget öppnas med
 *  angel_debug=1 så varje ändrat element ringmarkeras med tagg ("moved up" /
 *  "rewrote this text") och sidan scrollar till första ändringen. Bägge
 *  lägena hålls monterade så växlingen är omedelbar. Spegeln skriver aldrig
 *  events; Esc stänger; body-scrollen låses medan vyn är öppen. */
function CompareOverlay({
  site,
  v,
  onClose,
}: {
  site: string;
  v: VariantView;
  onClose: () => void;
}) {
  const preview = useQuery({
    queryKey: ["variantPreview", site, v.id],
    queryFn: () => createVariantPreview({ data: { site, variantId: v.id } }),
    // Spegel-tokens lever 30 min — återanvänd svaret medan vyn togglas.
    staleTime: 5 * 60 * 1000,
  });
  const [mode, setMode] = useState<"variant" | "original">("variant");
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 1280, h: 800 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [preview.data?.ok]);

  const frameW = preview.data?.mobile ? 390 : 1280;
  const scale = stage.w > 0 ? Math.min(1, stage.w / frameW) : 1;
  const chips = changeChips(v);
  const pill = STATUS_PILL[v.status] ?? STATUS_PILL.verified;

  return createPortal(
    // Centrerad modal (ägarbeslut: inte helskärm) — dimmad bakgrund, klick
    // utanför stänger. Panelen är fortfarande STOR (nästan hela vyn) så
    // spegeln får plats; ingen skugga (designspråket), bakgrunden separerar.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="flex h-[min(88vh,900px)] w-full max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* topprad: identitet till vänster, ändrings-chips i mitten, växeln till höger */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-[13px] text-stone-600 hover:text-stone-900"
          >
            ← Back
          </button>
          <span className="truncate font-mono text-[12px] text-stone-800">
            {v.segmentKey} <span className="text-[#c4beb6]">·</span>{" "}
            <span className="text-stone-400">{v.path}</span>
          </span>
          <span
            className="rounded-full px-[9px] py-[3px] text-[11px] font-semibold"
            style={{ background: pill.bg, color: pill.color }}
          >
            {v.status === "winner" ? "winner · 100%" : v.status}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 max-md:hidden">
            {chips.shown.map((c) => (
              <span
                key={c}
                className="truncate rounded-full border border-[#d1fae5] bg-[#ecfdf5] px-[11px] py-[3px] font-mono text-[11px] text-emerald-700"
              >
                {c}
              </span>
            ))}
            {chips.more > 0 && (
              <span className="font-mono text-[11px] text-stone-400">+{chips.more} more</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            {mode === "variant" && (
              <span className="flex items-center gap-1.5 text-[11px] text-stone-400 max-md:hidden">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[3px]"
                  style={{ outline: "2px solid #10b981", outlineOffset: 1 }}
                />
                changes are marked on the page
              </span>
            )}
            <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
              {(
                [
                  ["variant", "Variant"],
                  ["original", "Original"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className="rounded-[7px] px-[13px] py-[5px] text-[12.5px] font-semibold"
                  style={
                    mode === m ? { background: "#161513", color: "#fff" } : { color: "#57534e" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* scenen: hela resterande höjden — sidan scrollar inne i spegeln */}
        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-white">
          {preview.isPending && (
            <div className="flex h-full items-center justify-center text-[13px] text-stone-400">
              Mirroring the page…
            </div>
          )}
          {preview.data?.ok &&
            preview.data.mirrorPath &&
            preview.data.mirrorOffPath &&
            (
              [
                ["variant", `${preview.data.mirrorPath}&angel_debug=1`],
                ["original", preview.data.mirrorOffPath],
              ] as const
            ).map(([m, src]) => (
              <iframe
                key={m}
                src={src}
                title={m === "variant" ? "This variant" : "Original page"}
                sandbox="allow-scripts"
                className="absolute left-0 top-0"
                style={{
                  width: frameW,
                  height: Math.round(stage.h / scale),
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  border: 0,
                  // Bägge monterade → växlingen är omedelbar (ingen omladdning).
                  visibility: mode === m ? "visible" : "hidden",
                }}
              />
            ))}
          {(preview.isError || (preview.data && !preview.data.ok)) && (
            <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-stone-400">
              {preview.data?.reason === "no_domain"
                ? "The live preview needs the site's domain — add it in Settings and the page mirrors here."
                : "The live preview isn't available right now — try again in a moment."}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Journeys & signals i SAMMA popup-idiom som Compare (ägarbeslut 2026-07-17):
 *  centrerad modal med sandbox-spegeln av riktiga sidan som scen, klick-
 *  heatmapen + rage-markörerna ritade ovanpå, Clicks/Rage/Both-växeln i topp-
 *  raden där Compares Variant/Original-växel bor, resorna + frustrations-
 *  signalerna i sidokolumnen. Esc stänger; body-scrollen låses; spegeln
 *  skriver aldrig events. Samma ärliga lägen som förut: "samlar in"-overlay
 *  när positionsdata saknas, siluett-fallback när domänen inte är satt. */
function JourneysOverlay({
  site,
  heat,
  journeys,
  rageClicks,
  contextLabel,
  lockedDevice,
  onClose,
}: {
  site: string;
  heat: ClickHeat;
  journeys: SessionSummary[];
  rageClicks: RageSignal[];
  contextLabel: string;
  /** Satt när segmentvalet redan pinnar enheten (google·desktop → "desktop"):
   *  vyn låses dit och Mobile/Desktop-växeln döljs — att kunna växla till en
   *  annan enhet än den man borrat in i vore motsägelsefullt (ägarfynd
   *  2026-07-17). */
  lockedDevice?: "mobile" | "desktop" | null;
  onClose: () => void;
}) {
  const [heatMode, setHeatMode] = useState<"clicks" | "rage" | "both">("clicks");
  // Layoutvyn: x/y är % av BESÖKARENS viewport/dokument — punkterna är bara
  // meningsfulla mot en spegel i samma layoutbredd, så vyn väljer enhetsklass
  // (mobil 390 / desktop 1280) och default är den med mest underlag.
  const [deviceChoice, setDeviceChoice] = useState<"mobile" | "desktop" | null>(null);
  const device =
    lockedDevice ??
    deviceChoice ??
    (heat.desktop.sampled > heat.mobile.sampled ? "desktop" : "mobile");
  const view = device === "mobile" ? heat.mobile : heat.desktop;
  const frameW = device === "mobile" ? 390 : 1280;
  // Backdroppen (riktiga sidan i spegeln) hämtas när modalen monteras — den
  // ÄR öppen-grinden; tokens lever 30 min så växlingar återanvänder svaret.
  const backdrop = useQuery({
    queryKey: ["pagePreview", site, heat.path],
    queryFn: () => createPagePreview({ data: { site, path: heat.path } }),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const showClicks = heatMode === "clicks" || heatMode === "both";
  const showRage = heatMode === "rage" || heatMode === "both";
  const maxN = Math.max(1, ...view.clicks.map((c) => c.n));
  // Klicktäthet är MAGNITUD → sekventiell EN-tons ramp (blå, ljus→mörk) —
  // inte grön→amber→röd (regnbågs- och CVD-fällan, och rött är reserverat
  // för rage-markörerna/status). Varje punkt är en skarp 14px-kärna med vit
  // ring (syns mot vilket sidinnehåll som helst) + en mjuk gloria via
  // gradient — de gamla blur-suddarna var oläsliga (ägarfynd 2026-07-17).
  const RAMP = ["#86b6ef", "#2a78d6", "#0d366b"] as const;
  const rampAt = (rel: number) => (rel > 0.66 ? RAMP[2] : rel > 0.33 ? RAMP[1] : RAMP[0]);

  // Punkterna + "samlar in"-läget delas mellan backdropparna: den levande
  // spegeln av RIKTIGA sidan (när domänen finns) och siluett-fallbacken.
  const otherSampled = device === "mobile" ? heat.desktop.sampled : heat.mobile.sampled;
  const overlay =
    view.sampled === 0 ? (
      <div className="absolute inset-0 flex items-center justify-center bg-white/70 p-8 text-center">
        <p className="max-w-sm text-[13px] text-stone-500">
          {otherSampled > 0 && !lockedDevice
            ? `No positioned clicks from ${device} visitors on this page yet — switch to ${device === "mobile" ? "Desktop" : "Mobile"} above.`
            : "Click positions start collecting from your visitors' next page loads — the map draws itself as real data arrives. Nothing here is simulated."}
        </p>
      </div>
    ) : (
      <>
        {showClicks &&
          view.clicks.map((c, i) => {
            const rel = c.n / maxN;
            const hue = rampAt(rel);
            const halo = Math.round(40 + rel * 80);
            return (
              <div
                key={`c${i}`}
                className="pointer-events-none absolute"
                style={{ top: `${c.y}%`, left: `${c.x}%` }}
              >
                <div
                  className="absolute rounded-full"
                  style={{
                    width: halo,
                    height: halo,
                    transform: "translate(-50%,-50%)",
                    background: `radial-gradient(circle, ${hue}47, transparent 70%)`,
                  }}
                />
                <div
                  className="absolute h-[14px] w-[14px] rounded-full border-2 border-white"
                  style={{
                    transform: "translate(-50%,-50%)",
                    background: hue,
                    boxShadow: `0 0 0 1px ${hue}33`,
                  }}
                />
              </div>
            );
          })}
        {showRage &&
          view.rage.map((r, i) => (
            <div
              key={`r${i}`}
              title={r.ref}
              className="absolute flex h-[26px] w-[26px] items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{
                top: `${r.y}%`,
                left: `${r.x}%`,
                transform: "translate(-50%,-50%)",
                background: "rgba(220,38,38,.92)",
                boxShadow: "0 0 0 6px rgba(220,38,38,.26), 0 0 0 13px rgba(220,38,38,.13)",
              }}
            >
              {r.n}
            </div>
          ))}
      </>
    );

  return createPortal(
    // Samma centrerade modal som Compare — dimmad bakgrund, klick utanför
    // stänger, panelen nästan hela vyn så spegeln får plats.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="flex h-[min(88vh,900px)] w-full max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* topprad: identitet till vänster, växeln till höger — Compare-idiomet */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-[13px] text-stone-600 hover:text-stone-900"
          >
            ← Back
          </button>
          <span className="font-heading text-[14px] font-semibold">Journeys &amp; signals</span>
          <span className="truncate font-mono text-[12px] text-stone-400">
            {contextLabel} <span className="text-[#c4beb6]">·</span> {heat.path}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {view.sampled > 0 && (
              <span className="text-[11px] text-stone-400 max-md:hidden">
                {fmt(view.sampled)} sampled clicks
              </span>
            )}
            {/* Layoutväxeln: klicken ritas bara mot spegeln i samma bredd som
                besökarens layout — siffrorna säger var underlaget finns.
                Pinnar segmentvalet redan enheten är växeln meningslös och
                döljs (vyn är låst dit). */}
            {!lockedDevice && (
              <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
                {(
                  [
                    ["mobile", `Mobile (${heat.mobile.sampled})`],
                    ["desktop", `Desktop (${heat.desktop.sampled})`],
                  ] as const
                ).map(([d, label]) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDeviceChoice(d)}
                    className="rounded-[7px] px-[11px] py-[5px] text-[12px] font-semibold"
                    style={
                      device === d ? { background: "#161513", color: "#fff" } : { color: "#57534e" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
              {(
                [
                  ["clicks", "Clicks"],
                  ["rage", "Rage clicks"],
                  ["both", "Both"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setHeatMode(m)}
                  className="rounded-[7px] px-[11px] py-[5px] text-[12px] font-semibold"
                  style={
                    heatMode === m ? { background: "#161513", color: "#fff" } : { color: "#57534e" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* scenen: heatmapen över spegeln + resorna/frustrationen i sidokolumn */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div>
              {backdrop.data?.ok && backdrop.data.mirrorPath ? (
                // key: breddbyte remountar spegeln — höjdrapportören fyrar
                // bara vid load, och mobil-/desktoplayouten har olika höjd.
                <HeatMirror
                  key={device}
                  src={backdrop.data.mirrorPath}
                  overlay={overlay}
                  maxHeight="calc(88vh - 190px)"
                  frameW={frameW}
                />
              ) : (
                <div className="relative h-[460px] overflow-hidden rounded-[10px] border border-[#f0eee9] bg-white p-[22px]">
                  {/* siluett-fallback — utan domän finns ingen sida att spegla */}
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-20 rounded-[5px] bg-[#eae7e2]" />
                    <div className="flex gap-2.5">
                      <div className="h-3 w-[52px] rounded bg-[#f0eee9]" />
                      <div className="h-3 w-[52px] rounded bg-[#f0eee9]" />
                      <div className="h-3 w-[66px] rounded bg-[#f0eee9]" />
                    </div>
                  </div>
                  <div className="mt-11 text-center">
                    <div className="mx-auto h-[30px] w-[58%] rounded-[7px] bg-[#eae7e2]" />
                    <div className="mx-auto mt-3.5 h-[13px] w-[44%] rounded bg-[#f0eee9]" />
                    <div className="mx-auto mt-2 h-[13px] w-[36%] rounded bg-[#f0eee9]" />
                    <div className="mx-auto mt-6 h-10 w-[170px] rounded-[9px] bg-stone-200" />
                  </div>
                  <div className="mt-12 grid grid-cols-3 gap-3.5">
                    <div className="h-24 rounded-[9px] bg-[#f7f6f4]" />
                    <div className="h-24 rounded-[9px] bg-[#f7f6f4]" />
                    <div className="h-24 rounded-[9px] bg-[#f7f6f4]" />
                  </div>
                  {overlay}
                </div>
              )}
              <div className="mt-3 flex items-center gap-4 text-[11px] text-stone-500">
                {showClicks && (
                  <span className="flex items-center gap-2">
                    low
                    <span
                      className="h-2 w-24 rounded-[5px]"
                      style={{
                        background: "linear-gradient(90deg, #b7d3f6, #2a78d6, #0d366b)",
                      }}
                    />
                    high click density
                  </span>
                )}
                {showRage && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ background: "rgba(220,38,38,.92)" }}
                    />
                    rage clicks (n)
                  </span>
                )}
                {heat.unattributed > 0 && (
                  <span className="ml-auto">
                    {heat.unattributed} click{heat.unattributed === 1 ? "" : "s"} without a known
                    device layout — not drawn.
                  </span>
                )}
                {backdrop.data && !backdrop.data.ok && backdrop.data.reason === "no_domain" && (
                  <span className={heat.unattributed > 0 ? "" : "ml-auto"}>
                    Set the site&apos;s domain in Settings to draw the map over the real page.
                  </span>
                )}
              </div>
            </div>

            {/* resor + frustrationssignaler */}
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                <div className="font-heading text-sm font-semibold">Recent journeys</div>
                {journeys.length === 0 && (
                  <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                    No recorded journeys for this group in the window.
                  </div>
                )}
                {journeys.slice(0, 5).map((j) => (
                  <div key={j.sessionId} className="border-t border-[#f4f2ef] py-[11px]">
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
                          color: j.converted ? "#047857" : j.formAbandoned ? "#d97706" : "#78716c",
                        }}
                      >
                        {j.converted ? "converted" : j.formAbandoned ? "abandoned form" : "browsed"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                <div className="font-heading text-sm font-semibold">Frustration signals</div>
                {rageClicks.length === 0 && (
                  <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                    No rage clicks recorded. Good.
                  </div>
                )}
                {rageClicks.map((g) => (
                  <div
                    key={g.ref}
                    className="flex items-center justify-between border-t border-[#f4f2ef] py-[11px]"
                  >
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
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function OverviewPanel({
  site,
  overview,
  segments,
  sessions,
  rageClicks,
  heat,
  variants,
  servingOn,
}: {
  site: string;
  overview: Overview;
  segments: SegmentSummary[];
  sessions: SessionSummary[];
  rageClicks: RageSignal[];
  heat: ClickHeat;
  variants: VariantView[];
  servingOn: boolean;
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
  });
  // Varje trafikpåverkande statusbyte bekräftas — en felklickning ska inte
  // starta eller stoppa ett A/B.
  const askStatus = (v: VariantView, next: "serving" | "winner" | "retired", label: string) => {
    if (window.confirm(`${label} for ${v.segmentKey}?`)) {
      status.mutate({ variantId: v.id, status: next });
    }
  };

  // ── svarskortet: summerade armar över allt som serverar ───────────────────
  const siteVerdict = judgeArms(sumArms(variants));

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
  const armsBlock = (verdict: ArmVerdict) => (
    <div className="mt-6">
      <div className="mb-2.5 font-heading text-sm font-semibold">Adapted vs control</div>
      {verdict.arms ? (
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
              Too few conversions on one of the arms yet — no probability is claimed until the math
              holds.
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-stone-200 px-[18px] py-5 text-[13px] text-stone-400">
          No test is running {sel ? "for this group" : ""} yet.
        </div>
      )}
    </div>
  );

  // ── dashboardvyn ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* rad 1 — svarskortet + KPI:er */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div
          className="rounded-2xl border p-6"
          style={{
            borderColor:
              siteVerdict.state === "measured" && (siteVerdict.liftRel ?? 0) > 0
                ? "#d1fae5"
                : "#e7e5e4",
            background:
              siteVerdict.state === "measured" && (siteVerdict.liftRel ?? 0) > 0
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
          {siteVerdict.state === "measured" && siteVerdict.liftRel !== null && (
            <>
              <div
                className="mt-2 font-heading text-3xl font-bold tracking-tight"
                style={{ color: siteVerdict.liftRel > 0 ? "#065f46" : "#78350f" }}
              >
                {siteVerdict.liftRel > 0
                  ? `Yes — +${(siteVerdict.liftRel * 100).toFixed(0)}% lift`
                  : `Not yet — ${(siteVerdict.liftRel * 100).toFixed(0)}%`}
              </div>
              <p className="mt-2 text-[13.5px] text-stone-600">
                Adapted visitors convert {siteVerdict.liftRel > 0 ? "more" : "less"} than the
                held-back control group.
              </p>
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

              {armsBlock(siteVerdict)}

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

              {armsBlock(selArms)}

              {/* varianterna som hör till valet — ägarens knappar bor här */}
              <div className="mt-6">
                <div className="mb-2.5 flex items-baseline gap-2">
                  <div className="font-heading text-sm font-semibold">Variants</div>
                  <div className="text-[11.5px] text-stone-400">in {enLabel(sel.label)}</div>
                </div>
                {selScoped.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-200 px-[18px] py-5 text-[13px] text-stone-400">
                    None yet — Angel proposes one when the group has earned it.
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
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-[12px] text-stone-800">
                                {v.segmentKey} <span className="text-[#c4beb6]">·</span>{" "}
                                <span className="text-stone-400">{v.path}</span>
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
                                  </>
                                ) : v.status === "verified" ? (
                                  "verified — waiting for your go-ahead"
                                ) : (
                                  "measuring — too early to read"
                                )}
                              </div>
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
                                paused — source changed
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

      {journeysOpen && (
        <JourneysOverlay
          site={site}
          heat={heat}
          journeys={selJourneys}
          rageClicks={rageClicks}
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
