// Overview-panelens popup-overlays — Compare (FÖRE/EFTER i sandbox-speglar)
// och Journeys & signals (flödet, personberättelsen, rage-listan, sajtsök).
//
// Heatmap-vyn PENSIONERAD (ägarbeslut 2026-07-26): den matade ingen maskinell
// länk i beslutskedjan (detektor/design/verify/serve läser aldrig heat-datat)
// men kostade nattliga frysningar av klick-topparna + spegel-backdrops — och
// lämnade tolkningsjobbet till ägaren, tvärtemot produktens tes (maskinen
// föreslår, sandboxen visar, ärlig A/B bevisar). Klick-DATAT samlas oförändrat
// (element_click bär rage/intent/ordning — resorna och rage-listan lever på
// det), så vyn kan återinföras utan datalucka om den saknas.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
import { createVariantPreview } from "@/lib/dashboard/sandbox.functions";
import { enLabel, fmt, STATUS_PILL } from "./variant-stats";

import type { FlowNode, RageSignal, SearchTerm, SessionSummary } from "@/lib/dashboard/aggregate";
import type { VariantView } from "@/lib/dashboard/dashboard.functions";

/** Mänskligt läsbara ändrings-chips för Compare-toppraden: "Moved 'X' #4 → #2"
 *  ur comparison-ordningen, "Rewrote a heading" för retext, "Added a line …"
 *  för insert_snippet (blockåterbruket). Max 3 + "+N". Exporterad för test. */
export function changeChips(v: Pick<VariantView, "ops" | "comparison">): {
  shown: string[];
  more: number;
} {
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
    } else if (o.op === "insert_snippet") {
      // Ordagrann sajttext som lyfts in under hjälten (blockåterbruket) —
      // den råa op-tokenen vore grekiska i en ägarvänd chip.
      out.push("Added a line from the site below the hero");
    } else {
      out.push(o.op);
    }
  }
  const dedup = out.filter((c, i) => out.indexOf(c) === i);
  return { shown: dedup.slice(0, 3), more: Math.max(0, dedup.length - 3) };
}

/** Persontidslinjens enhetsord — besökarens FAKTISKA enhet, samma sanning som
 *  sessionslistans råa etikett. Medvetet skild från kohortattributionen
 *  deviceOf (tablet → desktop): den bucketen är för FILTER, men berättelsen
 *  påstår fakta om besöket och en tablet ska inte berättas som "on desktop".
 *  Okänd enhet ⇒ null: raden utelämnar "on …" hellre än gissar. */
export function narratedDevice(device: string | null): "mobile" | "desktop" | "tablet" | null {
  return device === "mobile" || device === "desktop" || device === "tablet" ? device : null;
}

/** Backdropens "klick utanför stänger" på HELA gesten: en textmarkering som
 *  dras från panelen och släpps över dimman dispatchar click-eventet på deras
 *  gemensamma förälder — backdropen själv — så panelens stopPropagation
 *  hjälper inte och overlayn stängdes mitt i kopieringen. Kräv därför
 *  mousedown OCH mouseup direkt på dimman innan onClose. */
function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => {
      downOnBackdrop.current = e.target === e.currentTarget;
    },
    onMouseUp: (e: ReactMouseEvent<HTMLDivElement>) => {
      if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      downOnBackdrop.current = false;
    },
  };
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
    // Fönster-refokus efter staleTime myntade annars NYA token-URL:er → bägge
    // speglarna hårdladdades om och tappade scrolläget mitt i granskningen.
    // Blotta återfokuseringen är ingen anledning att ladda om spegeln.
    refetchOnWindowFocus: false,
  });
  const [mode, setMode] = useState<"variant" | "original">("variant");
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 1280, h: 800 });
  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    // "Esc stänger"-löftet ska överleva klick i spegeln: iframarna är opak
    // origin (sandbox="allow-scripts"), så ett klick där flyttar tangentbords-
    // fokus in i iframen och Esc når aldrig dashboardens fönster. Klicket
    // självt är osynligt härifrån, men fokusflytten syns som window-blur med
    // iframen som activeElement — släpp då fokus tillbaka till dashboard-
    // dokumentet. Spegeln är en ren läsvy (skriver aldrig events, tar ingen
    // inmatning), så den förlorar inget på att inte behålla fokus.
    //
    // BARA el.blur() (granskningsfynd 2026-08-14): iframe-blur returnerar
    // fokus till dokumentet, så Esc-lyssnaren nås. window.focus() FÖRR drog
    // dessutom tillbaka fönstret — men samma blur-event fyras när användaren
    // alt-tabbar bort med iframen fokuserad, och då yankade window.focus()
    // dem aggressivt tillbaka. Släpp bara iframen; yanka aldrig fönstret.
    const onBlur = () => {
      const el = document.activeElement;
      if (el instanceof HTMLIFrameElement && stageRef.current?.contains(el)) {
        el.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
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
      {...backdrop}
    >
      <div className="flex h-[min(88vh,900px)] w-full max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7]">
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
  journeys,
  rageClicks,
  searches,
  contextLabel,
  lockedDevice,
  onClose,
}: {
  site: string;
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
  const personDevice = person ? narratedDevice(person.device) : null;
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

  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // En öppen FilterMenu tar Esc först: Radix DismissableLayer stänger
      // menyn och preventDefault:ar samma keydown — då gäller Esc menyn,
      // inte overlayn (annars försvann hela vyn med ägarens filterval).
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

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
      {...backdrop}
    >
      <div className="flex h-[min(88vh,900px)] w-full max-w-[1160px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f7]">
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
          <span className="truncate font-mono text-[12px] text-stone-400">{contextLabel}</span>
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
            ) : null}
          </div>
        </div>

        {/* kohort-filterraden (flödet + listan; personläget ärver kohorten) */}
        {!person && (
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-5 py-2.5">
            <span className="font-mono text-[10px] tracking-wider text-stone-400">[ filter ]</span>
            {/* Fällbara kryssmenyer (ägarfynd 2026-07-19): alternativen är
                exakt de som FINNS i datan, med antal — en ensam chip-rad
                antydde att den enda synliga källan var den enda möjliga. */}
            <FilterMenu
              label="Sources"
              options={channelOptions.map(([c, n]) => ({ key: c, label: enLabel(c), count: n }))}
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
                      <span className="font-semibold">{person.channel ?? "an unknown source"}</span>
                      {personDevice != null && ` on ${personDevice}`}
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
          ) : (
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
          )}
          {/* Integritetsraden EN gång för hela popupen (avbrusning 2026-07-19
              — stod tidigare i både listvyn och spelaren). */}
          <div className="mt-4 pb-1 text-center text-[10.5px] text-stone-300">
            Page sequence, clicks, scroll depth, video watch time and submitted site-search terms —
            Angel never records screens, mouse movement or keystrokes.
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
    <div className="py-[3px] text-[11px] text-stone-400" style={{ paddingLeft: depth * 22 }}>
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
