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
import {
  generateCandidates,
  candidateToOp,
  type BehaviorInput,
} from "../../src/adaptive/redesign/candidates";
import type { MoveSeed, ReuseSeed } from "../../src/adaptive/redesign/reuse";
import {
  applyProbe,
  buildSelectionPrompt,
  resolveSelection,
  floorSelection,
  type ProbeAnnotation,
} from "../../src/adaptive/redesign/select";
import { defuseMarkers } from "../../src/adaptive/redesign/defuse";
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
  /** Steg 10: rollupens per-sektion-engagemang (null-grindad uppströms —
   *  utelämnad ⇒ byte-identisk katalog, typ-priorn ensam precis som idag). */
  behavior?: BehaviorInput;
  /** Ägarens konfigurerade konverteringsmål (angel_sites-raden). Med målet
   *  vaktar probens grind SAMMA element som verify: måltexten i hit-listan,
   *  mål-selectorn i selektor-vakten (granskningsfynd 2026-08-08: utan dem
   *  kunde proben grind-godkänna ett drag som verify sedan fäller — eller
   *  tvärtom). Utelämnad (preview utan sajtkonfig) ⇒ bara extraherade
   *  konverterings-CTA:er, som förut. */
  goal?: { text?: string | null; selector?: string | null };
  /** Blockbiblioteket steg 2: vinnarnas bevisade block, redan sållade av
   *  nattloopens frö-vakter (viabilitet, dubbelvisning, mättnad). Utelämnad
   *  ⇒ byte-identisk katalog — precis som behavior. */
  reuse?: ReuseSeed[];
  /** Transferformen steg 4: flytt-vinnarnas typklass-frön, redan sållade av
   *  nattloopens flytt-vakter (viabilitet mot målsidans katalog, mättnad,
   *  fallna-sidor-bannet). Annoterar målsidans egna move-kandidater —
   *  utelämnad ⇒ byte-identisk katalog. */
  moveReuse?: MoveSeed[];
}): Promise<CandidatePlan | null> {
  const { content, frozenPath, workDir } = args;
  const candidates = generateCandidates(content, args.behavior, args.reuse, args.moveReuse);
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
    // Återbruk: källsidan med — proben mäter då donor-stylad LÄNK, exakt det
    // verify/serve renderar (paritetsfyndet 2026-08-11).
    ...(c.sourcePath ? { sourcePath: c.sourcePath } : {}),
  }));
  const inPath = join(workDir, "candidates-in.json");
  const outPath = join(workDir, "candidates-probed.json");
  // Grind-i-proben mäter med SAMMA CTA-vakter som verify (spegel av
  // auto-generates härledning): konverterings-CTA:erna ur innehållsmodellen
  // ∪ ägarens måltext, plus mål-selectorn när den finns.
  const ctaTexts = [
    ...new Set([
      ...content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text),
      ...(args.goal?.text ? [args.goal.text] : []),
    ]),
  ];
  const ctaSelectors = args.goal?.selector ? [args.goal.selector] : [];
  writeFileSync(inPath, JSON.stringify([{ id: "__meta__", ctaTexts, ctaSelectors }, ...probeIn]));
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
    console.warn(
      `[katalog] probens utfil oläsbar (${String(e).slice(0, 120)}) — fria designern tar över`,
    );
    return null;
  }
  const menu = applyProbe(candidates, probe);
  if (menu.length === 0) return null;

  const prompt = buildSelectionPrompt({
    heroHeadline: heroHeading || null,
    segmentLabel: args.segmentLabel,
    observations: args.observations,
    menu,
    engagementBySection: args.behavior?.sectionWeight,
    sectionVisitsBySection: args.behavior?.sectionVisits,
  });
  // HELT GRIND-OREN MENY ⇒ hoppa LLM-väljaren (granskningsfynd 2026-08-16,
  // restaurang-cellen: "0/1 grind-rena · 1/1 applicerbara" — proben hade
  // redan kört HELA grindkedjan inkl. kollisions-retryn via runGatedAttempts,
  // så varje mätt-oren kandidat faller i verify per konstruktion; samma
  // funktion, samma frysta fil). Att köpa en övertalnings-rankning mellan
  // dömda kandidater är meningslöst — golvet räcker, och verify förblir
  // domaren (bältet och hängslen: skulle probe/verify någonsin divergera är
  // det verify som gäller). Cellen får sin ärliga gate_fail med orsak i
  // rapporten; att den ÅTERKOMMER nästa natt är känt och olöst (cellminne
  // över nätter finns inte än).
  const allGateDirty = menu.every((c) => c.gateClean === false);
  if (allGateDirty) {
    console.log(
      `[katalog] hela menyn grind-oren (${menu.length} kandidat(er), probens fulla mätning) — hoppar väljaren, golvet väljer; verify avgör`,
    );
  }
  const raw = allGateDirty ? null : await anthropicSelect(prompt);
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
      .map((c) =>
        toOps(c, `Reserve candidate from the catalog: ${defuseMarkers(c.basis).slice(0, 160)}`),
      ),
    source: selection.source,
    menuSize: menu.length,
    probed: {
      candidates: probe.length,
      applicable: probe.filter((p) => p.applicable).length,
      gateClean: probe.filter((p) => p.gateClean === true).length,
    },
  };
}
