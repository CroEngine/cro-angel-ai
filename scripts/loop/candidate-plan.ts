// Kandidatplan-byggaren (kandidatkatalogen steg 2) — DELAD av preview-
// arbetaren och fleet-runnern så tratt och mätning aldrig divergerar:
//
//   katalog (candidates.ts) → DOM-probe (probe-candidates.ts i Chromium) →
//   LLM-väljaren (menyval, hårt validerad) | deterministiska golvet →
//   plan.ops = valet + altOps = reserverna (verify itererar).
//
// Tom meny efter probe ⇒ null — anroparen faller till den gamla fritt-
// skapande designern (superset: katalogen först, kreativiteten som reserv).

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { RedesignContentModel } from "../../src/adaptive/redesign/context";
import type { RedesignOp } from "../../src/adaptive/redesign/generate";
import { generateCandidates, candidateToOp } from "../../src/adaptive/redesign/candidates";
import {
  applyProbe,
  buildSelectionPrompt,
  resolveSelection,
  floorSelection,
  type ProbeAnnotation,
} from "../../src/adaptive/redesign/select";
import { anthropicSelect } from "./selector";

export interface CandidatePlan {
  ops: RedesignOp[];
  /** Rankade reserver (verify provar i ordning innan bevis-lyftets nödfall). */
  altOps: RedesignOp[][];
  source: "selector" | "floor";
  menuSize: number;
  /** Probens råtal — flottaggregatets yield-mätning (fynd 2026-07-29:
   *  talen loggades per sajt men aggregerades aldrig; utan dem finns ingen
   *  "andel sajter med minst ett grind-rent drag"-siffra). */
  probed: { candidates: number; applicable: number; gateClean: number };
}

const MAX_ALTS = 2;

export async function buildCandidatePlan(args: {
  content: RedesignContentModel;
  frozenPath: string;
  workDir: string;
  segmentLabel: string;
  observations: string[];
}): Promise<CandidatePlan | null> {
  const { content, frozenPath, workDir } = args;
  const candidates = generateCandidates(content);
  if (candidates.length === 0) return null;

  // Probens in-format: kandidat + lokator (samma upplösning som toServeOps —
  // hjälten via h1-rubriken, sektioner via sin h2-rubrik).
  const heroHeading =
    content.sections.find((s) => s.type === "hero")?.heading || content.hero?.headline || "";
  const probeIn = candidates.map((c) => ({
    id: c.id,
    kind: c.kind,
    tag: c.kind === "move_up" ? "h2" : "h1",
    find:
      c.kind === "move_up"
        ? (content.sections.find((s) => s.id === c.targetId)?.heading ?? "")
        : heroHeading,
    detail: c.detail,
  }));
  const inPath = join(workDir, "candidates-in.json");
  const outPath = join(workDir, "candidates-probed.json");
  // Grind-i-proben mäter med SAMMA CTA-vakter som verify (spegel av
  // auto-generates härledning: konverterings-CTA:erna ur innehållsmodellen;
  // preview har inget mål-selector).
  const ctaTexts = [
    ...new Set(content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text)),
  ];
  writeFileSync(inPath, JSON.stringify([{ id: "__meta__", ctaTexts }, ...probeIn]));
  const probeRun = spawnSync(
    "bun",
    [
      "run",
      "scripts/redesign/probe-candidates.ts",
      `--frozen=${frozenPath}`,
      `--in=${inPath}`,
      `--out=${outPath}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"], timeout: 90_000 },
  );
  if (probeRun.status !== 0) {
    // Synlig orsak (granskningsfynd 2026-07-28): fallet till fria designern
    // var tyst — i fleet-läsningen gick det inte att skilja "proben kraschade"
    // från "menyn var tom", två helt olika fel att åtgärda.
    console.warn(
      `[katalog] proben föll (exit ${probeRun.status ?? "timeout/signal"}) — fria designern tar över`,
    );
    return null;
  }
  let probe: ProbeAnnotation[];
  try {
    probe = JSON.parse(readFileSync(outPath, "utf8")) as ProbeAnnotation[];
  } catch (e) {
    console.warn(`[katalog] probens utfil oläsbar (${String(e).slice(0, 120)}) — fria designern tar över`);
    return null;
  }
  const menu = applyProbe(candidates, probe);
  if (menu.length === 0) return null;

  const prompt = buildSelectionPrompt({
    heroHeadline: heroHeading || null,
    segmentLabel: args.segmentLabel,
    observations: args.observations,
    menu,
  });
  const raw = await anthropicSelect(prompt);
  const selection = (raw ? resolveSelection(raw, menu) : null) ?? floorSelection(menu);
  if (!selection) return null;

  const toOps = (c: (typeof selection.ordered)[number], why: string): RedesignOp[] => {
    const op = candidateToOp(c, why);
    return [c.placement && op.op === "insert_snippet" ? { ...op, placement: c.placement } : op];
  };
  const [chosen, ...rest] = selection.ordered;
  return {
    ops: toOps(chosen, selection.why),
    altOps: rest
      .slice(0, MAX_ALTS)
      .map((c) => toOps(c, `Reserve candidate from the catalog: ${c.basis.slice(0, 160)}`)),
    source: selection.source,
    menuSize: menu.length,
    probed: {
      candidates: probe.length,
      applicable: probe.filter((p) => p.applicable).length,
      gateClean: probe.filter((p) => (p as { gateClean?: boolean }).gateClean === true).length,
    },
  };
}
