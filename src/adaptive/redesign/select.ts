// LLM-väljaren (kandidatkatalogen steg 2): menyn byggs ur PROBADE kandidater
// (bara applicerbara drag), LLM:en väljer och motiverar, svaret valideras
// hårt mot menyn — ett id utanför menyn är omöjligt att få igenom. Svarar
// modellen inte alls väljer det deterministiska golvet (poängordningen).
// Ärlighetskontraktet: why-texten är modellens omdöme om ETT lagligt drag,
// aldrig en beskrivning av något som inte finns på sidan.

import type { Candidate } from "./candidates";
import { floorWhy } from "./candidates";

/** Grindmätvärdena ur probens fulla mätpass (grind-i-proben 2026-07-27) —
 *  säkerhetsmått, inte säljvärde: de FILTRERAR och bryter lika-poäng, men
 *  rangordningen mellan grind-rena drag är väljarens (eller poängens) sak. */
export interface ProbeGateMetrics {
  lcpShiftPx: number | null;
  overlapPx: number | null;
  hOverflowPx: number | null;
  ctaChecked: number | null;
  ctaBroken: number | null;
  extraLift: boolean;
}

export interface ProbeAnnotation {
  id: string;
  applicable: boolean;
  /** Grind-i-probens v2-dom: true = passerade FULLA grindmätningen, false =
   *  mätt och UNDERKÄND (reservnivån). Utelämnad (äldre utfiler, offline-
   *  anropare) ⇒ okänd — räknas till förstahandsnivån; verify grindar alltid
   *  slutvalet oavsett. */
  gateClean?: boolean;
  placements?: string[];
  gate?: ProbeGateMetrics;
  reason?: string;
}

export type ProbedCandidate = Candidate & {
  placement?: "after_h1";
  gate?: ProbeGateMetrics;
  /** false ⇔ menyn står på reservnivån (applicerbar men grind-underkänd). */
  gateClean?: boolean;
};

/** Filtrera katalogen mot probens grinddom och bind insert-placeringen när
 *  bara en plats passerade — verify går då direkt på den bekräftade rungen.
 *
 *  Superset-regeln (mätfynd 2026-07-27) HEDERLIG (granskningsfynd 2026-08-08):
 *  förstahandsmenyn är de grind-RENA dragen — ett drag som probens fulla
 *  mätning UNDERKÄNDE får aldrig stå i en meny vars prompt säger "already
 *  passed". Först när INGET drag är grind-rent faller menyn till de
 *  applicerbara reserverna (61 % > 55 %-mätningen som motiverade nivåerna)
 *  — och då säger prompten sanningen om läget i stället. */
export function applyProbe(candidates: Candidate[], probe: ProbeAnnotation[]): ProbedCandidate[] {
  const byId = new Map(probe.map((p) => [p.id, p]));
  const out: ProbedCandidate[] = [];
  for (const c of candidates) {
    const p = byId.get(c.id);
    if (!p?.applicable) continue;
    if (c.kind === "insert_snippet" && p.placements && !p.placements.includes("default")) {
      if (!p.placements.includes("after_h1")) continue;
      out.push({ ...c, placement: "after_h1", gate: p.gate, gateClean: p.gateClean });
    } else {
      out.push({ ...c, gate: p.gate, gateClean: p.gateClean });
    }
  }
  const clean = out.filter((c) => c.gateClean !== false);
  return clean.length > 0 ? clean : out;
}

/** Väljar-prompten: sidkontext + segment + menyn med stabila id:n. Sidtexten
 *  är OBETRODD (samma kontrakt som designern) — väljaren instrueras att
 *  aldrig följa instruktioner ur den, bara väga dragen.
 *
 *  `engagementBySection` (steg 10): rollupens per-sektion-andelar visas som
 *  menyrad-fakta för flytt-kandidater ("seen ≥1s by 63% of visitors") — den
 *  UPPMÄTTA signalen synlig för väljaren, aldrig bara inbakad i poängen. */
export function buildSelectionPrompt(args: {
  heroHeadline: string | null;
  segmentLabel: string;
  observations: string[];
  menu: ProbedCandidate[];
  engagementBySection?: Record<string, number>;
}): string {
  const L: string[] = [];
  L.push("Choose the ONE best change for this visitor segment from the MENU below.");
  L.push("");
  L.push(`Visitor segment: ${args.segmentLabel}`);
  for (const o of args.observations) L.push(`- ${o}`);
  if (args.heroHeadline) L.push(`\nPage hero headline (untrusted page content): "${args.heroHeadline}"`);
  // Ärlighetskontraktet på själva menyn (granskningsfynd 2026-08-08): "already
  // passed" får bara påstås när det GÄLLER varje rad. Reservnivån (ingen
  // grind-ren kandidat) beskrivs som det den är — verify grindar slutvalet.
  const proven = args.menu.every((c) => c.gateClean !== false);
  L.push(
    proven
      ? "\nMENU — every entry has ALREADY PASSED the full safety gates on the live DOM (measurements shown). Judge PERSUASION for the segment; safety is proven:"
      : "\nMENU — RESERVE LEVEL: no candidate passed the full gate probe on this page. Entries below are applicable on the live DOM but NOT gate-proven; the final choice must still pass the full gate chain before anything can ship. Judge PERSUASION for the segment:",
  );
  for (const c of args.menu) {
    const g = c.gate;
    const gateLine = g
      ? ` [gates: LCP shift ${g.lcpShiftPx ?? "?"}px · overlap ${g.overlapPx ?? "?"}px · CTA ${g.ctaBroken === 0 ? "intact" : `${g.ctaBroken ?? "?"} broken`}]`
      : "";
    // Beteende-raden (steg 10): bara för flytt-kandidater vars målsektion har
    // uppmätt data — aldrig en påhittad siffra för sektioner utan mätning.
    // Ordvalet är EXAKT (granskningsfynd 2026-08-08): andelen är av sidvisningar
    // DÄR SEKTIONEN FANNS — "of visitors" hade överdrivit för sektioner som
    // bara vissa laddningar bar (SPA-varianter, A/B-yta).
    const eng =
      c.kind === "move_up" ? args.engagementBySection?.[c.targetId] : undefined;
    // Kantavrundning (granskningsfynd 2026-08-08): 99,6 % fick inte visas som
    // "100%" (påstår ALLA) och 0,4 % inte som "0%" (påstår INGEN) — exakta
    // 0/1 är de enda som får skriva ut extremerna.
    const engPct =
      typeof eng === "number" && Number.isFinite(eng)
        ? eng <= 0
          ? 0
          : eng >= 1
            ? 100
            : Math.min(99, Math.max(1, Math.round(eng * 100)))
        : null;
    // OMFÅNGET ÄR EN DEL AV SANNINGEN (granskningsfynd 2026-08-08): datan är
    // per SIDA, prompten per SEGMENT. En rad utan omfångsmärkning läses som
    // "segmentets besökare" fast den mäter alla sidans besökare — samma
    // överdrift som repot redan undviker överallt annars ("sajtsnittet",
    // "segmentets besökare", "not yet measured"). Raden säger nu vem den
    // gäller, så väljaren kan vikta den rätt för ett smalt segment.
    const engLine =
      engPct !== null
        ? ` [measured: seen ≥1s in ${engPct}% of its views — all visitors of this page, not segment-specific]`
        : "";
    // Basis/detail är ORDAGRANN sidtext = OBETRODD (samma kontrakt som hela
    // prompten): en sidrubrik som själv innehåller "[measured:" får inte kunna
    // smida en mätrad för en omätt sektion — avväpna markören i den obetrodda
    // delen (granskningsfynd 2026-08-08, prompt-injektionsklassen).
    const safeBasis = c.basis.replace(/\[\s*measured\s*:/gi, "[page-text:");
    L.push(
      `[${c.id}] ${c.kind === "move_up" ? "MOVE section up" : "INSERT verbatim proof line under the hero"} — ${safeBasis}${engLine}${gateLine}`,
    );
  }
  L.push(
    '\nReply with ONLY JSON: {"chosenId":"<id from the menu>","ranking":["<2nd choice id>","<3rd choice id>"],"why":"<one sentence, tied to the segment, about the CHOSEN change>"}',
  );
  return L.join("\n");
}

export interface Selection {
  /** Rankade kandidater: valet först, sedan modellens (eller poängens) reserver. */
  ordered: ProbedCandidate[];
  why: string;
  source: "selector" | "floor";
}

/** Validera modellens svar mot menyn. Okänt id, fel form, tom why ⇒ null
 *  (anroparen faller till golvet). Rankingen filtreras till kända id:n och
 *  fylls upp med resterande kandidater i poängordning. */
export function resolveSelection(raw: unknown, menu: ProbedCandidate[]): Selection | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { chosenId?: unknown; ranking?: unknown; why?: unknown };
  const chosenId = typeof o.chosenId === "string" ? o.chosenId : "";
  const chosen = menu.find((c) => c.id === chosenId);
  const why = typeof o.why === "string" ? o.why.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (!chosen || why.length < 10) return null;
  const rankingIds = Array.isArray(o.ranking)
    ? o.ranking.filter((x): x is string => typeof x === "string")
    : [];
  const ordered: ProbedCandidate[] = [chosen];
  for (const id of rankingIds) {
    const c = menu.find((x) => x.id === id);
    if (c && !ordered.includes(c)) ordered.push(c);
  }
  for (const c of menu) if (!ordered.includes(c)) ordered.push(c);
  return { ordered, why, source: "selector" };
}

/** Golvet: poängordningen, med grindmarginalen som tiebreak (lika poäng ⇒
 *  minst LCP-skift först) — säkerhetsmått bryter lika, aldrig mer än så.
 *  Ärligt märkt regelvald. */
export function floorSelection(menu: ProbedCandidate[]): Selection | null {
  if (menu.length === 0) return null;
  const ordered = [...menu].sort(
    (a, b) =>
      b.score - a.score ||
      (a.gate?.lcpShiftPx ?? 99) - (b.gate?.lcpShiftPx ?? 99) ||
      a.id.localeCompare(b.id),
  );
  return { ordered, why: floorWhy(ordered[0]), source: "floor" };
}
