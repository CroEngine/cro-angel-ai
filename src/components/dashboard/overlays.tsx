// Overview-panelens popup-overlays — Compare (FÖRE/EFTER i sandbox-speglar)
// och Journeys & signals (klick-heatmap på spegel-backdrop) med den delade
// HeatMirror-backdroppen (utbrutna ur overview-panel.tsx i sajt-genomgången
// 2026-07-18; ren flytt, ingen semantikändring).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { journeyFlow } from "@/lib/dashboard/aggregate";
import { createPagePreview, createVariantPreview } from "@/lib/dashboard/sandbox.functions";
import { fmt, STATUS_PILL } from "./variant-stats";

import type {
  ClickHeat,
  FlowNode,
  RageSignal,
  SearchTerm,
  SessionSummary,
} from "@/lib/dashboard/aggregate";
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
  const frameRef = useRef<HTMLIFrameElement>(null);
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
      // Bara VÅR egen iframe får rapportera — annars kan en annan spegel
      // (eller vilken inbäddad sida som helst) styra höjden.
      if (e.source !== frameRef.current?.contentWindow) return;
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
          ref={frameRef}
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
            // ska scrolla/hovra lagret ovanpå. (Interaktiv spegel prövades
            // 2026-07-19 och backades samma dag: ägaren klickar inte runt på
            // sin egen sajt i en vy vars jobb är att återge besökarens.)
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

/** Journeys v2 (ägarorder 2026-07-18, efter Hotjar/Clarity-research): samma
 *  popup-idiom som Compare, nu i tre lägen med en gemensam filterrad
 *  (kanal · enhet · utfall) som definierar kohorten:
 *
 *  - FLOW (default): det rankade vägträdet (Clarity-formen, ägarens val) —
 *    entrésidor → nästa steg → utfall med procent och konverterade per väg.
 *    Tål tunn data: tio sessioner ger ett litet men korrekt träd.
 *  - HEATMAP: klick-/rage-kartan över sandbox-spegeln (oförändrad mekanik).
 *  - PERSON: klicka en session i listan → steg-för-steg-spelare på spegel-
 *    backdrops med personens klick som numrerade punkter, Prev/Next steg och
 *    Prev/Next person genom hela den filtrerade kohorten (Hotjar-mönstret).
 *
 *  MEDVETET ingen videoinspelning/musspårning — integritetsbeslutet från
 *  pivoten står: sidsekvens + klick räcker för att förstå resan. Spegeln
 *  skriver aldrig events; Esc stänger; body-scrollen låses. */
export function JourneysOverlay({
  site,
  heatPages,
  journeys,
  rageClicks,
  searches,
  contextLabel,
  lockedDevice,
  onClose,
}: {
  site: string;
  heatPages: ClickHeat[];
  journeys: SessionSummary[];
  rageClicks: RageSignal[];
  /** Sajtsökningar per term (ägarbeslut 2026-07-19) — sajtvid rollup. */
  searches: SearchTerm[];
  contextLabel: string;
  /** Satt när segmentvalet redan pinnar enheten (google·desktop → "desktop"):
   *  vyn låses dit och enhetsväxlarna döljs — att kunna växla till en annan
   *  enhet än den man borrat in i vore motsägelsefullt (ägarfynd 2026-07-17). */
  lockedDevice?: "mobile" | "desktop" | null;
  onClose: () => void;
}) {
  const [view, setView] = useState<"flow" | "heatmap">("flow");
  const [heatMode, setHeatMode] = useState<"clicks" | "rage" | "both">("clicks");
  // Sidväljaren (ägarfynd 2026-07-19: kartan "drog mot restauranger" — den
  // var låst till sajtens mest klickade sida). Default = klick-toppen.
  const [heatPathChoice, setHeatPathChoice] = useState<string | null>(null);
  const emptyReach = { views: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
  const heat = (heatPathChoice && heatPages.find((h) => h.path === heatPathChoice)) ||
    heatPages[0] || {
      path: "/",
      mobile: { clicks: [], rage: [], sampled: 0, reach: emptyReach },
      desktop: { clicks: [], rage: [], sampled: 0, reach: emptyReach },
      unattributed: 0,
    };
  // Ett sidval som åldrats ur topp-8 släpps ärligt — annars filtrerar det
  // tyst mot klick-toppen och SNÄPPER TILLBAKA av sig själv om sidan
  // återkommer i en senare refetch.
  useEffect(() => {
    if (heatPathChoice && !heatPages.some((h) => h.path === heatPathChoice)) {
      setHeatPathChoice(null);
    }
  }, [heatPages, heatPathChoice]);

  // ── kohort-filtren (Hotjar-mönstret: ETT filter, tre zoomnivåer) ─────────
  // Källor + enheter är FÄLLBARA menyer med kryss (ägarfynd 2026-07-19: en
  // chip-rad med en ensam källa ser ut som att det ÄR den enda källan) —
  // alternativen byggs ur datan, så linkedin dyker upp den dag linkedin-
  // sessioner finns. Tom mängd = alla. "unknown" listas när källösa
  // sessioner finns, annars vore de o-filtrerbara.
  const [channelSel, setChannelSel] = useState<ReadonlySet<string>>(new Set());
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "converted" | "left">("all");
  const [deviceSel, setDeviceSel] = useState<ReadonlySet<"mobile" | "desktop">>(
    () => new Set(lockedDevice ? [lockedDevice] : []),
  );
  // Samma enhetsattribution som heatmapen: tablet räknas till desktop.
  const deviceOf = (j: SessionSummary): "mobile" | "desktop" =>
    j.device === "mobile" ? "mobile" : "desktop";
  const channelOptions = useMemo(() => {
    const n = new Map<string, number>();
    for (const j of journeys) {
      const key = j.channel ?? "unknown";
      n.set(key, (n.get(key) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]);
  }, [journeys]);
  const deviceOptions = useMemo(() => {
    const n = new Map<"mobile" | "desktop", number>();
    for (const j of journeys) {
      const d = deviceOf(j);
      n.set(d, (n.get(d) ?? 0) + 1);
    }
    return (["mobile", "desktop"] as const)
      .filter((d) => (n.get(d) ?? 0) > 0)
      .map((d) => [d, n.get(d)!] as const);
  }, [journeys]);
  // Självläkning: ett valt alternativ som åldrats ur datafönstret får inte
  // fortsätta filtrera osynligt — menyn summerar valet som "All" (snittet
  // mot options) medan RÅA mängden nollställer listan, och krysset finns
  // inte längre att bocka ur. Pinnad enhet (lockedDevice) är ett medvetet
  // val och beskärs aldrig.
  useEffect(() => {
    const avail = new Set(channelOptions.map(([k]) => k));
    if ([...channelSel].some((k) => !avail.has(k))) {
      setChannelSel(new Set([...channelSel].filter((k) => avail.has(k))));
    }
  }, [channelOptions, channelSel]);
  useEffect(() => {
    if (lockedDevice) return;
    const avail = new Set(deviceOptions.map(([k]) => k));
    if ([...deviceSel].some((k) => !avail.has(k))) {
      setDeviceSel(new Set([...deviceSel].filter((k) => avail.has(k))));
    }
  }, [deviceOptions, deviceSel, lockedDevice]);
  const toggleIn = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };
  const filtered = useMemo(
    () =>
      journeys.filter((j) => {
        if (channelSel.size > 0 && !channelSel.has(j.channel ?? "unknown")) return false;
        if (outcomeFilter === "converted" && !j.converted) return false;
        if (outcomeFilter === "left" && j.converted) return false;
        if (deviceSel.size > 0 && !deviceSel.has(deviceOf(j))) return false;
        return true;
      }),
    [journeys, channelSel, outcomeFilter, deviceSel],
  );
  const flow = useMemo(() => journeyFlow(filtered), [filtered]);

  // ── personläget: valet lagras som SESSIONS-ID, aldrig radindex ───────────
  // (ägarfynd 2026-07-19: dashboarddatan hämtas om i bakgrunden och nya
  // sessioner läggs ÖVERST — ett sparat index gled då till en annan besökare
  // än raden man klickade; /blogg-raden öppnade restaurangsessionen.)
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => {
    // Filterbyte definierar om kohorten — en öppen person kan peka fel.
    setPersonId(null);
  }, [channelSel, outcomeFilter, deviceSel]);
  const personIdx = personId != null ? filtered.findIndex((s) => s.sessionId === personId) : -1;
  const person = personIdx >= 0 ? filtered[personIdx] : null;
  // Sessionen kan åldras ur eventfönstret vid bakgrundsrefetch — släpp valet
  // ärligt då, annars återöppnas vyn SPONTANT om sessionen råkar komma
  // tillbaka i en senare refetch.
  useEffect(() => {
    if (personId != null && !filtered.some((s) => s.sessionId === personId)) {
      setPersonId(null);
    }
  }, [personId, filtered]);
  const personSteps = person?.steps ?? [];
  const personDevice = person?.device === "mobile" ? "mobile" : "desktop";
  const openPerson = (s: SessionSummary) => setPersonId(s.sessionId);
  const movePerson = (delta: number) => {
    if (personIdx < 0 || filtered.length === 0) return;
    const next = (personIdx + delta + filtered.length) % filtered.length;
    openPerson(filtered[next]);
  };
  // Sidbilden togs BORT (ägarbeslut 2026-07-20): 42 % av stegen saknade fryst
  // kopia och fick ett vitt JS-skal — "bild ibland" inom samma session ser
  // trasigt ut. Berättelsen bär sig själv; ev. återinförande kräver först
  // ~100 % frysning av besökta sidor (parkerat som senare-jobb).

  // ── heatmap-läget (oförändrad mekanik från v1) ───────────────────────────
  const [deviceChoice, setDeviceChoice] = useState<"mobile" | "desktop" | null>(null);
  const device =
    lockedDevice ??
    deviceChoice ??
    (heat.desktop.sampled > heat.mobile.sampled ? "desktop" : "mobile");
  const heatView = device === "mobile" ? heat.mobile : heat.desktop;
  const frameW = device === "mobile" ? 390 : 1280;
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
  const maxN = Math.max(1, ...heatView.clicks.map((c) => c.n));
  // Klicktäthet är MAGNITUD → sekventiell EN-tons ramp (blå, ljus→mörk) —
  // inte grön→amber→röd (regnbågs- och CVD-fällan, och rött är reserverat
  // för rage-markörerna/status). Varje punkt är en skarp 14px-kärna med vit
  // ring (syns mot vilket sidinnehåll som helst) + en mjuk gloria via
  // gradient — de gamla blur-suddarna var oläsliga (ägarfynd 2026-07-17).
  const RAMP = ["#86b6ef", "#2a78d6", "#0d366b"] as const;
  const rampAt = (rel: number) => (rel > 0.66 ? RAMP[2] : rel > 0.33 ? RAMP[1] : RAMP[0]);

  const otherSampled = device === "mobile" ? heat.desktop.sampled : heat.mobile.sampled;
  // Attention map (ägarbeslut 2026-07-19): scrolldjups-räckvidden som subtila
  // linjer över kartan — "X % scrollade förbi här". Ritas först när sidan har
  // ett ärligt underlag (≥3 attribuerade sidvisningar). Djupet är % av
  // scrollsträckan; linjen läggs på samma % av dokumenthöjden (approximation,
  // etiketten säger vad den betyder).
  const reach = heatView.reach;
  const attentionLines =
    reach.views >= 3
      ? ([
          [25, reach.p25],
          [50, reach.p50],
          [75, reach.p75],
        ] as const)
          .filter(([, n]) => n > 0)
          .map(([depth, n]) => (
            <div
              key={depth}
              className="pointer-events-none absolute inset-x-0"
              style={{ top: `${depth}%` }}
            >
              <div className="border-t border-dashed border-[#0d366b]/35" />
              <span
                className="absolute right-2 rounded-full px-2 py-[1px] text-[10px] font-semibold text-white"
                style={{ top: -9, background: "rgba(13,54,107,.78)" }}
              >
                {Math.min(100, Math.round((n / reach.views) * 100))}% scrolled past here
              </span>
            </div>
          ))
      : [];
  const heatOverlay =
    heatView.sampled === 0 ? (
      <div className="absolute inset-0 flex items-center justify-center bg-white/70 p-8 text-center">
        <p className="max-w-sm text-[13px] text-stone-500">
          {otherSampled > 0 && !lockedDevice
            ? `No positioned clicks from ${device} visitors on this page yet — switch to ${device === "mobile" ? "Desktop" : "Mobile"} above.`
            : "Click positions start collecting from your visitors' next page loads — the map draws itself as real data arrives. Nothing here is simulated."}
        </p>
      </div>
    ) : (
      <>
        {attentionLines}
        {showClicks &&
          heatView.clicks.map((c, i) => {
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
          heatView.rage.map((r, i) => (
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

  // ── Berättelse-tidslinjen (ägarbeslut 2026-07-19: "presentera datan i
  // stället — skippa playback"): personens resa berättas i ord — kom från,
  // gick hit, scrollade, klickade, sökte, tittade på video, utfall. Play-
  // reprisen och punktöverlägget togs bort medvetet: en berättelse kan
  // aldrig "se fel ut" oavsett hur sajten är byggd; den lilla sidbilden
  // till höger ger igenkänning utan att låtsas vara en inspelning.

  const pill = (active: boolean) =>
    active ? { background: "#161513", color: "#fff" } : { color: "#57534e" };
  const fmtDur = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
  };
  // Stegradens klicklista: upprepningar i följd slås ihop ("BUTTON ×4 ·
  // Stäng ×2") — avbrusning 2026-07-19; hela listan finns i title-tooltipen.
  const collapsedRefs = (clicks: { ref: string }[]) => {
    const runs: { ref: string; n: number }[] = [];
    for (const c of clicks) {
      const last = runs[runs.length - 1];
      if (last && last.ref === c.ref) last.n++;
      else runs.push({ ref: c.ref, n: 1 });
    }
    return runs.map((r) => (r.n > 1 ? `${r.ref} ×${r.n}` : r.ref)).join(" · ");
  };
  const outcomeBadge = (j: SessionSummary) => (
    <span
      className="flex-none text-[11.5px] font-semibold"
      style={{ color: j.converted ? "#047857" : j.formAbandoned ? "#d97706" : "#78716c" }}
    >
      {j.converted ? "converted" : j.formAbandoned ? "abandoned form" : "browsed"}
    </span>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 md:p-8"
      onClick={onClose}
    >
      <div
        className="flex h-[min(88vh,900px)] w-full max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* topprad: identitet till vänster, lägesväxlarna till höger */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-5 py-3">
          <button
            type="button"
            onClick={() => (person ? setPersonId(null) : onClose())}
            className="flex items-center gap-1.5 text-[13px] text-stone-600 hover:text-stone-900"
          >
            ← {person ? "All journeys" : "Back"}
          </button>
          <span className="font-heading text-[14px] font-semibold">Journeys &amp; signals</span>
          <span className="truncate font-mono text-[12px] text-stone-400">
            {contextLabel}
            {view === "heatmap" && !person && (
              <>
                {" "}
                <span className="text-[#c4beb6]">·</span> {heat.path}
              </>
            )}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {person ? (
              // Hotjar-mönstret: bläddra vidare till nästa person i kohorten
              // utan att gå tillbaka till listan.
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-stone-400">
                  Visitor {personIdx + 1} of {filtered.length}
                </span>
                <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
                  <button
                    type="button"
                    onClick={() => movePerson(-1)}
                    className="rounded-[7px] px-[11px] py-[5px] text-[12px] font-semibold text-stone-600"
                  >
                    ← Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => movePerson(1)}
                    className="rounded-[7px] px-[11px] py-[5px] text-[12px] font-semibold"
                    style={{ background: "#161513", color: "#fff" }}
                  >
                    Next visitor →
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
                  {(
                    [
                      ["flow", "Flow"],
                      ["heatmap", "Heatmap"],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setView(v)}
                      className="rounded-[7px] px-[11px] py-[5px] text-[12px] font-semibold"
                      style={pill(view === v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {view === "heatmap" && heatPages.length > 1 && (
                  // Sidväljaren: kartan visar EN sida i taget — välj vilken av
                  // de mest klickade (rankade, med antal), i stället för att
                  // alltid låsas till sajtens klick-topp.
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex max-w-[280px] items-center gap-1.5 rounded-[9px] border border-stone-200 bg-[#faf9f7] px-[11px] py-[5px] text-[12px] font-semibold text-stone-700"
                      >
                        <span className="text-stone-400">Page:</span>
                        <span className="truncate font-mono text-[11.5px]">{heat.path}</span>
                        <svg
                          width="9"
                          height="6"
                          viewBox="0 0 9 6"
                          className="flex-none text-stone-400"
                        >
                          <path
                            d="M1 1l3.5 3.5L8 1"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                          />
                        </svg>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-w-[360px]">
                      {heatPages.map((h) => (
                        <DropdownMenuItem
                          key={h.path}
                          onSelect={() => setHeatPathChoice(h.path)}
                          className="text-[12px]"
                          style={h.path === heat.path ? { background: "#f4f2ef" } : undefined}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
                            {h.path}
                          </span>
                          <span className="ml-3 flex-none font-mono text-[11px] text-stone-400">
                            {h.mobile.sampled + h.desktop.sampled}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {view === "heatmap" && !lockedDevice && (
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
                        style={pill(device === d)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {view === "heatmap" && (
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
                        style={pill(heatMode === m)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* kohort-filterraden (flödet + listan; personläget ärver kohorten) */}
        {!person && view === "flow" && (
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-5 py-2.5">
            <span className="font-mono text-[10px] tracking-wider text-stone-400">[ filter ]</span>
            {/* Fällbara kryssmenyer (ägarfynd 2026-07-19): alternativen är
                exakt de som FINNS i datan, med antal — en ensam chip-rad
                antydde att den enda synliga källan var den enda möjliga. */}
            <FilterMenu
              label="Sources"
              options={channelOptions.map(([c, n]) => ({ key: c, label: c, count: n }))}
              selected={channelSel}
              onToggle={(c) => setChannelSel((s) => toggleIn(s, c))}
              onClear={() => setChannelSel(new Set())}
            />
            {!lockedDevice && (
              <FilterMenu
                label="Devices"
                options={deviceOptions.map(([d, n]) => ({
                  key: d,
                  label: d === "mobile" ? "Mobile" : "Desktop",
                  count: n,
                }))}
                selected={deviceSel}
                onToggle={(d) => setDeviceSel((s) => toggleIn(s, d as "mobile" | "desktop"))}
                onClear={() => setDeviceSel(new Set())}
              />
            )}
            <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
              {(
                [
                  ["all", "All outcomes"],
                  ["converted", "Converted"],
                  ["left", "Did not convert"],
                ] as const
              ).map(([o, label]) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcomeFilter(o)}
                  className="rounded-[7px] px-[9px] py-[4px] text-[11.5px] font-semibold"
                  style={pill(outcomeFilter === o)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[11px] text-stone-400">
              {filtered.length} of {journeys.length} sessions in the window
            </span>
          </div>
        )}

        {/* scenen */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {person ? (
            // ── PERSONLÄGET: berättelsen, hela scenen ────────────────────────
            // Enkolumn med läsbredd (max-w + centrerad) — sidbilden är
            // borttagen (ägarbeslut 2026-07-20), så tidslinjen ÄR vyn.
            // min-w-0 så långa mono-sökvägar aldrig sväller förbi ramen.
            <div className="mx-auto w-full max-w-[640px]">
              <div className="min-w-0 rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-heading text-sm font-semibold">This visit, step by step</div>
                  {person.engagedMs > 0 && (
                    <span className="flex-none text-[11px] text-stone-400">
                      {fmtDur(person.engagedMs)} active
                    </span>
                  )}
                </div>
                <div className="relative mt-3">
                  {/* tidslinjens lodräta tråd — knyter ihop entré → steg → utfall */}
                  <div className="absolute bottom-4 left-[8px] top-1 w-px bg-[#eae7e2]" />
                  <div className="relative flex items-start gap-3 pb-3">
                    <span className="mt-[2px] h-[17px] w-[17px] flex-none rounded-full border-2 border-white bg-stone-400 shadow-[0_0_0_1px_#e7e5e4]" />
                    <div className="min-w-0 text-[12.5px] leading-snug text-stone-700">
                      Came from{" "}
                      <span className="font-semibold">{person.channel ?? "an unknown source"}</span>{" "}
                      on {personDevice}
                      {person.isReturning ? " — returning visitor" : " — first visit"}
                    </div>
                  </div>
                  {personSteps.map((s, i) => (
                    <div key={i} className="relative flex items-start gap-3 pb-2">
                      <span className="mt-[10px] flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border-2 border-white bg-[#2a78d6] text-[9px] font-bold leading-none text-white shadow-[0_0_0_1px_#dbeafe]">
                        {i + 1}
                      </span>
                      {/* Rent läskort — inget stegval längre (valet fanns bara
                          för sidbilden). Förkortad väg, hela vid hover. */}
                      <div className="min-w-0 flex-1 rounded-[9px] border border-[#f0eee9] bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-stone-700"
                            title={s.path}
                          >
                            {s.path}
                          </span>
                          {s.engagedMs > 0 && (
                            <span className="flex-none text-[11px] text-stone-400">
                              {fmtDur(s.engagedMs)}
                            </span>
                          )}
                        </div>
                        {s.scrollPct != null && (
                          <div className="mt-1 text-[11.5px] text-stone-500">
                            Scrolled{" "}
                            {s.scrollPct === 100 ? "to the bottom" : `${s.scrollPct}% of the page`}
                          </div>
                        )}
                        {s.clicks.length > 0 && (
                          <div
                            className="mt-1 truncate text-[11.5px] text-stone-500"
                            title={s.clicks.map((c) => c.ref).join(" · ")}
                          >
                            Clicked {collapsedRefs(s.clicks)}
                          </div>
                        )}
                        {(s.searches ?? []).map((q, k) => (
                          <div
                            key={k}
                            className="mt-1 truncate text-[11.5px] text-stone-600"
                            title={q.term}
                          >
                            Searched for &ldquo;{q.term}&rdquo;
                          </div>
                        ))}
                        {(s.videos ?? []).map((v, k) => (
                          <div
                            key={k}
                            className="mt-1 truncate text-[11.5px] text-stone-600"
                            title={v.ref}
                          >
                            Watched a video for {fmtDur(v.watchedMs)}
                          </div>
                        ))}
                        {(s.rageRefs ?? []).length > 0 && (
                          <div
                            className="mt-1 truncate text-[11.5px] font-semibold text-amber-600"
                            title={(s.rageRefs ?? []).join(" · ")}
                          >
                            Frustrated clicking on {(s.rageRefs ?? []).join(" · ")}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="relative flex items-start gap-3 pt-1">
                    <span
                      className="mt-[1px] h-[17px] w-[17px] flex-none rounded-full border-2 border-white shadow-[0_0_0_1px_#e7e5e4]"
                      style={{
                        background: person.converted
                          ? "#047857"
                          : person.formAbandoned
                            ? "#d97706"
                            : "#a8a29e",
                      }}
                    />
                    <div
                      className="min-w-0 text-[12.5px] font-semibold leading-snug"
                      style={{
                        color: person.converted
                          ? "#047857"
                          : person.formAbandoned
                            ? "#d97706"
                            : "#57534e",
                      }}
                    >
                      {person.converted
                        ? "Converted on this visit"
                        : person.formAbandoned
                          ? "Left with an unfinished form"
                          : "Left without converting"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : view === "flow" ? (
            // ── FLÖDET: rankat vägträd + sessionslistan ──────────────────────
            <div className="grid items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
              <div className="min-w-0 rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                <div className="font-heading text-sm font-semibold">Where visitors go</div>
                <div className="mt-1 text-[11.5px] text-stone-400">
                  The most common paths, step by step. Bar width = share of the step above.
                </div>
                {flow.totalSessions === 0 ? (
                  <div className="border-t border-[#f4f2ef] py-3 text-[12px] text-stone-400">
                    No sessions match the filter in this window.
                  </div>
                ) : (
                  // Avbrusning 2026-07-19 ("svårt att förstå vad man tittar
                  // på"): grenar med EN besökare viks ihop till en summarad —
                  // trädet visar bara vägar som mer än en person tagit.
                  <div className="mt-2">
                    {flow.entries.map((entry, i) => (
                      <div key={i} className="border-t border-[#f4f2ef] py-2">
                        <FlowRow node={entry} base={flow.totalSessions} depth={0} />
                        {strongNodes(entry.children).map((c2, j) => (
                          <div key={j}>
                            <FlowRow node={c2} base={entry.sessions} depth={1} />
                            {strongNodes(c2.children).map((c3, k) => (
                              <FlowRow key={k} node={c3} base={c2.sessions} depth={2} />
                            ))}
                            {foldedCount(c2.children) > 0 && (
                              <FoldedLine n={foldedCount(c2.children)} depth={2} />
                            )}
                          </div>
                        ))}
                        {foldedCount(entry.children) > 0 && (
                          <FoldedLine n={foldedCount(entry.children)} depth={1} />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                  <div className="font-heading text-sm font-semibold">
                    Sessions{" "}
                    <span className="font-sans text-[11px] font-normal text-stone-400">
                      — click one to follow that visitor
                    </span>
                  </div>
                  {filtered.length === 0 && (
                    <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                      No recorded journeys for this group in the window.
                    </div>
                  )}
                  <div className="max-h-[420px] overflow-y-auto">
                    {/* Avbrusning 2026-07-19: flersidesresor visar entré →
                        exit + omfång (hela kedjan finns i spelaren och i
                        tooltipen); ensidiga besök får en tunn enradare så
                        de intressanta resorna sticker ut. */}
                    {filtered.map((j) => {
                      const pages = j.pageOrder.length ? j.pageOrder : [j.landingPath ?? "/"];
                      const multi = pages.length > 1;
                      return multi ? (
                        <button
                          key={j.sessionId}
                          type="button"
                          onClick={() => openPerson(j)}
                          className="block w-full border-t border-[#f4f2ef] py-[11px] text-left hover:bg-[#faf9f7]"
                        >
                          <div
                            className="truncate font-mono text-[11.5px] text-stone-600"
                            title={pages.join(" → ")}
                          >
                            {pages[0]} → {pages[pages.length - 1]}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[11px] text-stone-400">
                              {pages.length} pages · {j.channel ?? "unknown"} · {j.device ?? "?"} ·{" "}
                              {fmtDur(j.engagedMs)}
                            </span>
                            {outcomeBadge(j)}
                          </div>
                        </button>
                      ) : (
                        <button
                          key={j.sessionId}
                          type="button"
                          onClick={() => openPerson(j)}
                          className="flex w-full items-center gap-2 border-t border-[#f4f2ef] py-[7px] text-left hover:bg-[#faf9f7]"
                        >
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-stone-500"
                            title={pages[0]}
                          >
                            {pages[0]}
                          </span>
                          <span className="flex-none text-[11px] text-stone-400">
                            {fmtDur(j.engagedMs)}
                            {j.steps[0]?.scrollPct != null &&
                              ` · scrolled ${j.steps[0].scrollPct}%`}
                          </span>
                          {outcomeBadge(j)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Avbrusning 2026-07-19: tomma diagnostikkort tystnar helt —
                    lugnande första gången, brus var gång därefter. */}
                {rageClicks.length > 0 && (
                <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                  <div className="font-heading text-sm font-semibold">Frustration signals</div>
                  {rageClicks.map((g) => (
                    <div
                      key={g.ref}
                      className="flex items-center justify-between border-t border-[#f4f2ef] py-[11px]"
                    >
                      <span
                        className="min-w-0 truncate font-mono text-[11.5px] text-stone-600"
                        title={g.ref}
                      >
                        {g.ref}
                      </span>
                      <span className="ml-3 flex-none text-[12px] font-semibold text-amber-600">
                        {g.bursts} rage bursts
                      </span>
                    </div>
                  ))}
                  <div className="mt-3 text-[11.5px] leading-normal text-stone-400">
                    Site-wide diagnostics — Angel never changes anything automatically from these.
                  </div>
                </div>
                )}
                {searches.length > 0 && (
                <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                  <div className="font-heading text-sm font-semibold">Site search</div>
                  {searches.map((s) => (
                    <div
                      key={s.term}
                      className="flex items-center justify-between border-t border-[#f4f2ef] py-[9px]"
                    >
                      <span
                        className="min-w-0 truncate text-[12.5px] text-stone-700"
                        title={s.term}
                      >
                        {s.term}
                      </span>
                      <span className="ml-3 flex-none font-mono text-[11.5px] text-stone-400">
                        ×{s.count}
                      </span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            </div>
          ) : (
            // ── HEATMAPEN (oförändrad mekanik, nu i full bredd) ──────────────
            <div>
              {backdrop.data?.ok && backdrop.data.mirrorPath ? (
                <HeatMirror
                  key={device}
                  src={backdrop.data.mirrorPath}
                  overlay={heatOverlay}
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
                  {heatOverlay}
                </div>
              )}
              <div className="mt-3 flex items-center gap-4 text-[11px] text-stone-500">
                {heatView.sampled > 0 && (
                  <span className="text-stone-400">{fmt(heatView.sampled)} sampled clicks</span>
                )}
                {attentionLines.length > 0 && (
                  <span className="text-stone-400">
                    scroll reach from {fmt(reach.views)} page views
                    {reach.views > reach.p25 &&
                      ` · ${Math.min(100, Math.round(((reach.views - reach.p25) / reach.views) * 100))}% never scrolled past 25%`}
                  </span>
                )}
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
          )}
          {/* Integritetsraden EN gång för hela popupen (avbrusning 2026-07-19
              — stod tidigare i både listvyn och spelaren). */}
          <div className="mt-4 pb-1 text-center text-[10.5px] text-stone-300">
            Page sequence, clicks, scroll depth, video watch time and submitted site-search
            terms — Angel never records screens, mouse movement or keystrokes.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Grenar som mer än EN besökare tagit — resten viks ihop till en summarad
 *  (avbrusning 2026-07-19: ett träd av "1 · 100%"-rader säger ingenting). */
function strongNodes(nodes: FlowNode[]): FlowNode[] {
  return nodes.filter((n) => n.path === null || n.sessions >= 2);
}
function foldedCount(nodes: FlowNode[]): number {
  return nodes
    .filter((n) => n.path !== null && n.sessions < 2)
    .reduce((sum, n) => sum + n.sessions, 0);
}
function FoldedLine({ n, depth }: { n: number; depth: number }) {
  return (
    <div
      className="py-[3px] text-[11px] text-stone-400"
      style={{ paddingLeft: depth * 22 }}
    >
      + {n} visitor{n === 1 ? "" : "s"} continued to different pages (one each)
    </div>
  );
}

/** En rad i vägträdet: indrag per nivå, volymstapel relativt nivån ovanför,
 *  antal besökare i klartext ("22 ended here" i stället för glyfer —
 *  avbrusning 2026-07-19). "Övriga"-hinken (path null) får grå etikett och
 *  ingen vidare förgrening. */
function FlowRow({ node, base, depth }: { node: FlowNode; base: number; depth: number }) {
  const share = base > 0 ? node.sessions / base : 0;
  return (
    <div className="flex items-center gap-2 py-[5px]" style={{ paddingLeft: depth * 22 }}>
      {depth > 0 && <span className="flex-none font-mono text-[11px] text-[#c4beb6]">→</span>}
      <span
        className="min-w-0 flex-none truncate font-mono text-[11.5px]"
        style={{ maxWidth: "40%", color: node.path ? "#44403c" : "#a8a29e" }}
        title={node.path ?? undefined}
      >
        {node.path ?? (depth === 0 ? "other entry pages" : "other pages")}
      </span>
      <span className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-[#f4f2ef]">
        <span
          className="block h-full rounded-[4px]"
          style={{
            width: `${Math.max(2, Math.round(share * 100))}%`,
            background: depth === 0 ? "#0d366b" : depth === 1 ? "#2a78d6" : "#86b6ef",
          }}
        />
      </span>
      <span className="flex-none text-right text-[11px] text-stone-500">
        {node.sessions} visitor{node.sessions === 1 ? "" : "s"}
      </span>
      {(node.converted > 0 || node.exited > 0) && (
        <span className="flex-none text-right text-[11px] text-stone-400">
          {node.converted > 0 && (
            <span style={{ color: "#047857" }}>{node.converted} converted</span>
          )}
          {node.converted > 0 && node.exited > 0 && " · "}
          {node.exited > 0 && `${node.exited} ended here`}
        </span>
      )}
    </div>
  );
}

/** Fällbar kryssfilter-meny (ägarfynd 2026-07-19): triggern visar valet
 *  ("Sources: All" / "Sources: google +2"), innehållet listar exakt de
 *  alternativ som finns i datan med antal — tom markering betyder alla.
 *  Nya källor/enheter dyker upp av sig själva när sessioner med dem finns. */
function FilterMenu({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  options: { key: string; label: string; count: number }[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const chosen = options.filter((o) => selected.has(o.key));
  const summary =
    chosen.length === 0
      ? "All"
      : chosen.length === 1
        ? chosen[0].label
        : `${chosen[0].label} +${chosen.length - 1}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-[9px] border border-stone-200 bg-[#faf9f7] px-[11px] py-[5px] text-[11.5px] font-semibold text-stone-700"
        >
          <span className="text-stone-400">{label}:</span> {summary}
          <svg width="9" height="6" viewBox="0 0 9 6" className="text-stone-400">
            <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[190px]">
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.key}
            checked={selected.has(o.key)}
            // Håll menyn öppen så flera val kan kryssas i en öppning.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => onToggle(o.key)}
            className="text-[12.5px]"
          >
            <span className="flex-1">{o.label}</span>
            <span className="ml-3 font-mono text-[11px] text-stone-400">{o.count}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {selected.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-[12.5px] text-stone-500" onSelect={onClear}>
              Clear — show all
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
