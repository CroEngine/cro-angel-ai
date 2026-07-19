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
  onRawHeight,
}: {
  src: string;
  overlay: React.ReactNode;
  maxHeight?: number | string;
  /** Spegelns viewportbredd — MÅSTE matcha layouten klicken mättes i
   *  (390 = mobil, 1280 = desktop); x är % av besökarens viewportbredd. */
  frameW?: number;
  /** Rå (o-klampad) rapporterad dokumenthöjd — skal-detekteringen i person-
   *  läget läser den: en live-speglad SPA rapporterar ~0 (blankt skal). */
  onRawHeight?: (h: number) => void;
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

  const gotHeightRef = useRef(false);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      // Bara VÅR egen iframe får rapportera — annars kan en annan spegel
      // (eller vilken inbäddad sida som helst) styra höjden/skal-skylten.
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data as { type?: string; h?: number } | null;
      if (d && d.type === "angel-mirror-height" && typeof d.h === "number") {
        // Klampad: en fientlig speglad sida kan bara flytta punkter i ägarens
        // egen vy av just den sidan — men vi tar inga orimliga värden.
        gotHeightRef.current = true;
        setDocH(Math.min(20000, Math.max(600, Math.round(d.h))));
        onRawHeight?.(Math.round(d.h));
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [onRawHeight]);
  useEffect(() => {
    // Tyst spegel = blank spegel (ägarfynd 2026-07-19: vitt hål UTAN skylt i
    // personläget). En spegel som misslyckas helt injicerar aldrig höjd-
    // rapportören och skickar inget message — rapportera då 0 så skal-
    // detekteringen ovanpå kan visa sin ärliga skylt i stället för vitt.
    // Kommer en riktig höjd senare vinner den (skylten släcks av sig själv).
    gotHeightRef.current = false;
    const t = setTimeout(() => {
      if (!gotHeightRef.current) onRawHeight?.(0);
    }, 2500);
    return () => clearTimeout(t);
  }, [src, onRawHeight]);

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
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => {
    // Filterbyte definierar om kohorten — en öppen person kan peka fel.
    setPersonId(null);
    setStepIdx(0);
  }, [channelSel, outcomeFilter, deviceSel]);
  const personIdx = personId != null ? filtered.findIndex((s) => s.sessionId === personId) : -1;
  const person = personIdx >= 0 ? filtered[personIdx] : null;
  // Sessionen kan åldras ur eventfönstret vid bakgrundsrefetch — släpp valet
  // ärligt då, annars återöppnas spelaren SPONTANT på gammalt steg om
  // sessionen råkar komma tillbaka i en senare refetch.
  useEffect(() => {
    if (personId != null && !filtered.some((s) => s.sessionId === personId)) {
      setPersonId(null);
      setStepIdx(0);
    }
  }, [personId, filtered]);
  const personSteps = person?.steps ?? [];
  // Refetchen kan också KRYMPA samma sessions steps (fönstret glider) —
  // klampa alltid mot AKTUELLA listan så spelaren aldrig pekar utanför
  // ("Step 3 of 3" med tomt innehåll och till synes död Prev-knapp).
  const safeStepIdx = Math.max(0, Math.min(stepIdx, personSteps.length - 1));
  const personStep = personSteps[safeStepIdx] ?? null;
  const personDevice = person?.device === "mobile" ? "mobile" : "desktop";
  const personFrameW = personDevice === "mobile" ? 390 : 1280;
  const openPerson = (s: SessionSummary) => {
    setPersonId(s.sessionId);
    setStepIdx(0);
  };
  const movePerson = (delta: number) => {
    if (personIdx < 0 || filtered.length === 0) return;
    const next = (personIdx + delta + filtered.length) % filtered.length;
    openPerson(filtered[next]);
  };
  const personBackdrop = useQuery({
    queryKey: ["pagePreview", site, personStep?.path ?? ""],
    queryFn: () => createPagePreview({ data: { site, path: personStep!.path } }),
    enabled: personStep != null,
    staleTime: 5 * 60 * 1000,
  });
  // Skal-detektering (ägarfynd 2026-07-19: blank vit spegel i personläget):
  // en LIVE-speglad SPA-sida rapporterar ~0 i dokumenthöjd — då visas en
  // ärlig skylt i stället för ett tyst vitt hål. Frysta kopior berörs inte.
  const [personRawH, setPersonRawH] = useState<number | null>(null);
  // Layout-effekt, inte passiv: resetten måste hinna FÖRE paint så förra
  // stegets skal-skylt aldrig blinkar till över det nya stegets spegel.
  useLayoutEffect(() => setPersonRawH(null), [personStep?.path, personId]);
  const onPersonRawHeight = useCallback((h: number) => setPersonRawH(h), []);
  const personMirrorBlank =
    personBackdrop.data?.mirrorKind === "live" && personRawH !== null && personRawH < 300;

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

  // Personens klick som NUMRERADE punkter i klickordning — bara positions-
  // bärande klick kan ritas; resten listas som chips under spegeln.
  const personOverlay = personStep ? (
    <>
      {personStep.clicks.map((c, i) =>
        c.x != null && c.y != null ? (
          <div
            key={i}
            title={c.ref}
            className="absolute flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white"
            style={{
              top: `${c.y}%`,
              left: `${c.x}%`,
              transform: "translate(-50%,-50%)",
              background: "#2a78d6",
              boxShadow: "0 0 0 4px rgba(42,120,214,.25)",
            }}
          >
            {i + 1}
          </div>
        ) : null,
      )}
    </>
  ) : null;
  const unpositioned = personStep ? personStep.clicks.filter((c) => c.x == null) : [];

  const pill = (active: boolean) =>
    active ? { background: "#161513", color: "#fff" } : { color: "#57534e" };

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
            // ── PERSONLÄGET: steg-för-steg-spelaren ──────────────────────────
            // min-w-0 på BÅDA kolumnerna: gridbarn har min-width:auto, så de
            // långa mono-sökvägarna (inga mellanslag) sväller annars kolumnen
            // förbi popup-ramen och truncate får aldrig verka (ägarfynd
            // 2026-07-19: Next-knappen hamnade utanför bild).
            <div className="grid items-start gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="min-w-0">
                {personStep && personBackdrop.data?.ok && personBackdrop.data.mirrorPath ? (
                  <div className="relative">
                    <HeatMirror
                      key={`${person.sessionId}:${safeStepIdx}`}
                      src={personBackdrop.data.mirrorPath}
                      overlay={personOverlay}
                      maxHeight="calc(88vh - 230px)"
                      frameW={personFrameW}
                      onRawHeight={onPersonRawHeight}
                    />
                    {personMirrorBlank && (
                      // Ärlig skylt i stället för ett tyst vitt hål: sidan är
                      // JS-renderad och kan inte live-speglas — nattloopen
                      // fryser besökta sidor, så kopian kommer.
                      <div className="absolute inset-0 flex items-center justify-center bg-white/80 p-8 text-center">
                        <p className="max-w-sm text-[13px] leading-relaxed text-stone-500">
                          This page renders with JavaScript and can&apos;t be mirrored live. The
                          nightly loop freezes browsable copies of the site&apos;s most-visited
                          pages — steps on those pages get a real backdrop. The visitor&apos;s
                          pages and clicks are listed on the right.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-[420px] items-center justify-center rounded-[10px] border border-[#f0eee9] bg-white p-8 text-center text-[13px] text-stone-500">
                    {personStep
                      ? "Loading the page mirror…"
                      : "This session has no page steps to replay."}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: "#2a78d6" }}
                    >
                      1
                    </span>
                    clicks in order
                  </span>
                  {unpositioned.length > 0 && (
                    <span>
                      {unpositioned.length} click{unpositioned.length === 1 ? "" : "s"} without a
                      position (older snippet) — listed in the steps.
                    </span>
                  )}
                  <span className="ml-auto font-mono text-stone-400">
                    {person.channel ?? "unknown"} · {personDevice} ·{" "}
                    {person.converted ? "converted" : "did not convert"}
                  </span>
                </div>
              </div>

              {/* stegen + navigeringen */}
              <div className="flex min-w-0 flex-col gap-4">
                <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                  <div className="flex items-center justify-between">
                    <div className="font-heading text-sm font-semibold">
                      Step {safeStepIdx + 1} of {Math.max(personSteps.length, 1)}
                    </div>
                    <div className="flex gap-1 rounded-[9px] border border-stone-200 bg-[#faf9f7] p-[3px]">
                      <button
                        type="button"
                        disabled={safeStepIdx === 0}
                        onClick={() => setStepIdx(Math.max(0, safeStepIdx - 1))}
                        className="rounded-[7px] px-[10px] py-[4px] text-[12px] font-semibold text-stone-600 disabled:opacity-40"
                      >
                        ← Prev
                      </button>
                      <button
                        type="button"
                        disabled={safeStepIdx >= personSteps.length - 1}
                        onClick={() => setStepIdx(Math.min(personSteps.length - 1, safeStepIdx + 1))}
                        className="rounded-[7px] px-[10px] py-[4px] text-[12px] font-semibold disabled:opacity-40"
                        style={{ background: "#161513", color: "#fff" }}
                      >
                        Next step →
                      </button>
                    </div>
                  </div>
                  {personSteps.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setStepIdx(i)}
                      className="mt-2 block w-full rounded-[9px] border px-3 py-2 text-left"
                      style={{
                        borderColor: i === safeStepIdx ? "#161513" : "#f0eee9",
                        background: i === safeStepIdx ? "#faf9f7" : "#fff",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {/* Förkortad väg, hela vägen vid hover (title) —
                            slutet av slugen är oftast bara ett id, så
                            slut-trunkering behåller den läsbara delen. */}
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-stone-700"
                          title={s.path}
                        >
                          {i + 1}. {s.path}
                        </span>
                        <span className="flex-none text-[11px] text-stone-400">
                          {s.engagedMs > 0 ? `${Math.round(s.engagedMs / 1000)}s` : ""}
                        </span>
                      </div>
                      {s.clicks.length > 0 && (
                        <div
                          className="mt-1 truncate text-[11px] text-stone-500"
                          title={s.clicks.map((c) => c.ref).join(" · ")}
                        >
                          {s.clicks.map((c) => c.ref).join(" · ")}
                        </div>
                      )}
                    </button>
                  ))}
                  <div className="mt-3 text-[11.5px] leading-normal text-stone-400">
                    Page sequence, clicks, scroll depth and submitted site-search terms — Angel
                    never records screens, mouse movement or keystrokes.
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
                  Entry page → next step → after that, ranked by volume. Share of the level above; ✓
                  = sessions that converted at some point, ⏏ = journeys that ended there.
                </div>
                {flow.totalSessions === 0 ? (
                  <div className="border-t border-[#f4f2ef] py-3 text-[12px] text-stone-400">
                    No sessions match the filter in this window.
                  </div>
                ) : (
                  <div className="mt-2">
                    {flow.entries.map((entry, i) => (
                      <div key={i} className="border-t border-[#f4f2ef] py-2">
                        <FlowRow node={entry} base={flow.totalSessions} depth={0} />
                        {entry.children.map((c2, j) => (
                          <div key={j}>
                            <FlowRow node={c2} base={entry.sessions} depth={1} />
                            {c2.children.map((c3, k) => (
                              <FlowRow key={k} node={c3} base={c2.sessions} depth={2} />
                            ))}
                          </div>
                        ))}
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
                    {filtered.map((j) => (
                      <button
                        key={j.sessionId}
                        type="button"
                        onClick={() => openPerson(j)}
                        className="block w-full border-t border-[#f4f2ef] py-[11px] text-left hover:bg-[#faf9f7]"
                      >
                        <div
                          className="truncate font-mono text-[11.5px] text-stone-600"
                          title={(j.pageOrder.length ? j.pageOrder : [j.landingPath ?? "/"]).join(
                            " → ",
                          )}
                        >
                          {(j.pageOrder.length ? j.pageOrder : [j.landingPath ?? "/"]).join(" → ")}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[11px] text-stone-400">
                            {j.channel ?? "unknown"} · {j.device ?? "?"} ·{" "}
                            {Math.round(j.engagedMs / 1000)}s
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
                      </button>
                    ))}
                  </div>
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
                <div className="rounded-2xl border border-stone-200 bg-white px-5 py-[18px]">
                  <div className="font-heading text-sm font-semibold">Site search</div>
                  {searches.length === 0 && (
                    <div className="border-t border-[#f4f2ef] py-2.5 text-[12px] text-stone-400">
                      No site searches recorded yet — terms appear as visitors use the
                      site&apos;s search.
                    </div>
                  )}
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
                  <div className="mt-3 text-[11.5px] leading-normal text-stone-400">
                    Submitted search terms only — never keystrokes, never other form fields.
                  </div>
                </div>
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
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** En rad i vägträdet: indrag per nivå, volymstapel relativt nivån ovanför,
 *  procent + konverterade + avslut. "Övriga"-hinken (path null) får kursiv
 *  etikett och ingen vidare förgrening. */
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
        {node.path ?? "other pages"}
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
      <span className="flex-none text-right font-mono text-[11px] text-stone-500">
        {node.sessions} · {Math.round(share * 100)}%
      </span>
      <span className="w-[74px] flex-none text-right text-[11px]">
        {node.converted > 0 && <span style={{ color: "#047857" }}>✓ {node.converted}</span>}
        {node.converted > 0 && node.exited > 0 && <span className="text-stone-300"> · </span>}
        {node.exited > 0 && <span className="text-stone-400">⏏ {node.exited}</span>}
      </span>
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
