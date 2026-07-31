// Kandidat-proben v2 (grind-i-proben, ägarbeslut 2026-07-27): kör HELA
// grindmätningen per kandidat — verify:s EGEN maskin (runGatedAttempts →
// evaluateRenderGates), applicera → mät → återställ, i en enda browser-
// session. Principen: EN KANDIDAT SOM REDAN ÄR KÄND SOM UNDERKÄND SKA
// ALDRIG KUNNA VÄLJAS. Menyn LLM-väljaren ser innehåller bara drag som
// bevisat passerar grindarna, med mätvärdena bifogade — verify i slutet
// blir bekräftelse + bevisproduktion, aldrig ett lotteri.
//
// Insert-kandidater probas PER PLACERING (default = efter hjältens topp-
// block; after_h1 = direkt under rubriken) — utfallet per placering följer
// med ut så väljaren/golvet kan binda den grind-rena placeringen.
//
//   bun run scripts/redesign/probe-candidates.ts \
//     --frozen=<path> --in=<candidates.json> --out=<probed.json>
//
// In-format per kandidat: {id, kind, tag, find, detail?} + toppnivå
// {ctaTexts?: string[]} i en meta-post (id "__meta__"). Fail closed per
// kandidat: oprovbar ⇒ bortfiltrerad, aldrig "kanske".

import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

import { captureLcpElement, runGatedAttempts, type MeasureOp } from "./measure";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FROZEN = arg("frozen");
const IN = arg("in");
const OUT = arg("out");
if (!FROZEN || !IN || !OUT) {
  console.error("usage: --frozen=<html> --in=<candidates.json> --out=<probed.json>");
  process.exit(2);
}
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;

interface ProbeIn {
  id: string;
  kind: "move_up" | "insert_snippet";
  tag: string;
  find: string;
  detail?: string;
  ctaTexts?: string[];
}
export interface GateMetrics {
  lcpShiftPx: number | null;
  overlapPx: number | null;
  hOverflowPx: number | null;
  ctaChecked: number | null;
  ctaBroken: number | null;
  extraLift: boolean;
}
interface ProbeOut {
  id: string;
  /** Upplösbar + applicerbar (v1-nivån) — reservmenyn när inget är grind-rent. */
  applicable: boolean;
  /** Passerade FULLA grindmätningen i proben (v2-nivån) — förstahandsmenyn.
   *  Superset-regeln (mätfynd 2026-07-27: v2 ensam föll till 55% mot v1:s
   *  61% när tömda menyer skickade svåra sidor till fria designern): båda
   *  nivåerna behålls, väljaren föredrar grind-rena, applicerbara är reserv. */
  gateClean: boolean;
  /** insert: grind-rena placeringar i preferensordning. */
  placements?: string[];
  /** Grindmätvärdena för det BÄSTA passet — väljar-menyn + golvets tiebreak. */
  gate?: GateMetrics;
  reason?: string;
}

const raw = JSON.parse(readFileSync(IN, "utf8")) as ProbeIn[];
const meta = raw.find((c) => c.id === "__meta__");
const cands = raw.filter((c) => c.id !== "__meta__");
const ctaTexts = meta?.ctaTexts ?? [];
const html = readFileSync(FROZEN, "utf8");

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route("**/*", (r) => r.abort());
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
await page.waitForTimeout(400);
// LCP-markören sätts EN gång (samma regel som verify: före all mätning);
// den överlever måtten eftersom varje mätpass återställer DOM:en byte-rent.
await captureLcpElement(page);

const results: ProbeOut[] = [];

/** Färsk sidladdning + ny LCP-markör. Används efter en mätkrasch: ett kast
 *  mitt i appliceringen lämnar DOM:en muterad, och eftersom EN sida delas av
 *  alla kandidater vore varje mått därefter tyst korrupt (granskningsfynd
 *  2026-07-28). Omladdning är den enda garanterat rena återstarten. */
async function reloadPage(): Promise<void> {
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(400);
  await captureLcpElement(page);
}

/** Kör grindmaskinen för en op-lista; null vid pass ⇒ mätvärden, annars
 *  första grind-orsaken. measurePlan (inuti) återställer alltid DOM:en. */
async function gateRun(
  ops: MeasureOp[],
): Promise<{ pass: boolean; gate: GateMetrics; reason: string | null }> {
  const { attempts, unresolvable, extraLiftApplied } = await runGatedAttempts(
    page,
    ops,
    ctaTexts,
    {},
  );
  if (unresolvable || attempts.length === 0) {
    return {
      pass: false,
      gate: {
        lcpShiftPx: null,
        overlapPx: null,
        hOverflowPx: null,
        ctaChecked: null,
        ctaBroken: null,
        extraLift: false,
      },
      reason: "lokatorn/sektionen kunde inte upplösas",
    };
  }
  const last = attempts[attempts.length - 1];
  const m = last.measurements;
  return {
    pass: last.gate.verdict === "pass",
    gate: {
      lcpShiftPx: m.lcpShiftPx ?? null,
      overlapPx: last.gate.verticalOverlapIntroducedPx ?? null,
      hOverflowPx: last.gate.hOverflowIntroducedPx ?? null,
      ctaChecked: m.ctaChecked ?? null,
      ctaBroken: m.ctaBroken ?? null,
      extraLift: extraLiftApplied,
    },
    reason: last.gate.verdict === "pass" ? null : (last.gate.reasons[0] ?? "grind föll"),
  };
}

/** gateRun med krasch-skydd (granskningsfynd 2026-07-28): förut fällde EN
 *  kraschande kandidat hela proben — menyn som övriga kandidater förtjänat
 *  försvann och kedjan föll till fria designern. Nu: kandidaten blir
 *  oprovbar (fail closed), sidan laddas om ren, loopen fortsätter. Kastar
 *  omladdningen också (död browser) dör proben — det är rätt sista utväg. */
async function safeGateRun(
  ops: MeasureOp[],
): Promise<{ pass: boolean; gate: GateMetrics; reason: string | null } | null> {
  try {
    return await gateRun(ops);
  } catch (e) {
    console.warn(`[probe] mätkrasch (${String(e).slice(0, 160)}) — laddar om sidan, fortsätter`);
    await reloadPage();
    return null;
  }
}

for (const c of cands) {
  if (c.kind === "move_up") {
    const r = await safeGateRun([{ op: "move_up", tag: c.tag, find: c.find }]);
    if (!r) {
      results.push({
        id: c.id,
        applicable: false,
        gateClean: false,
        reason: "mätmaskinen kraschade på kandidaten",
      });
      continue;
    }
    const resolvable = r.reason !== "lokatorn/sektionen kunde inte upplösas";
    results.push(
      r.pass
        ? { id: c.id, applicable: true, gateClean: true, gate: r.gate }
        : { id: c.id, applicable: resolvable, gateClean: false, reason: r.reason ?? undefined },
    );
  } else {
    // Insert: proba varje placering — grind-ren placering ⇒ med i menyn.
    const placements: string[] = [];
    let bestGate: GateMetrics | undefined;
    let lastReason: string | null = null;
    let crashed = false;
    for (const placement of [undefined, "after_h1"] as const) {
      const r = await safeGateRun([
        {
          op: "insert_snippet",
          tag: c.tag,
          find: c.find,
          set: c.detail ?? "",
          ...(placement ? { placement } : {}),
        },
      ]);
      if (!r) {
        crashed = true;
        lastReason = "mätmaskinen kraschade på kandidaten";
        continue;
      }
      if (r.pass) {
        placements.push(placement ?? "default");
        if (!bestGate) bestGate = r.gate; // preferensordningen: default först
      } else {
        lastReason = r.reason;
      }
    }
    // Krasch utan någon grind-ren placering ⇒ fail closed (vi VET ingenting
    // om kandidaten) — "resolvable" får inte härledas ur en kraschorsak.
    const resolvable =
      !crashed && lastReason !== "lokatorn/sektionen kunde inte upplösas";
    results.push(
      placements.length > 0
        ? { id: c.id, applicable: true, gateClean: true, placements, gate: bestGate }
        : {
            id: c.id,
            applicable: resolvable,
            gateClean: false,
            reason: lastReason ?? "alla placeringar föll i grinden",
          },
    );
  }
}

await browser.close();
writeFileSync(OUT, JSON.stringify(results, null, 2));
const clean = results.filter((r) => r.gateClean).length;
const appl = results.filter((r) => r.applicable).length;
console.log(`[probe] ${clean}/${results.length} grind-rena · ${appl}/${results.length} applicerbara`);
