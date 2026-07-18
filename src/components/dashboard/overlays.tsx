// Overview-panelens popup-overlays — Compare (FÖRE/EFTER i sandbox-speglar)
// och Journeys & signals (klick-heatmap på spegel-backdrop) med den delade
// HeatMirror-backdroppen (utbrutna ur overview-panel.tsx i sajt-genomgången
// 2026-07-18; ren flytt, ingen semantikändring).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import { createPagePreview, createVariantPreview } from "@/lib/dashboard/sandbox.functions";
import { fmt, STATUS_PILL } from "./variant-stats";

import type { ClickHeat, RageSignal, SessionSummary } from "@/lib/dashboard/aggregate";
import type { VariantView } from "@/lib/dashboard/dashboard.functions";

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
export function CompareOverlay({
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
export function JourneysOverlay({
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
