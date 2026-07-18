#!/usr/bin/env bun
// Fas 4 — auto-genereringsloopen (ägarens "kör" 2026-07-13).
//
// "Segment över volymgrinden utan variant → kedjan körs → verifierad variant
// väntar på ägarens godkännande i dashboarden." Två lägen:
//
//   detect  — rollup-löv + befintliga variantnycklar in → findEarnedSegments
//             (ren, testad) väljer segmenten som FÖRTJÄNAT en design, och för
//             varje byggs den riktiga designbriefen (buildRedesignContext →
//             renderRedesignPrompt) ur den frysta sidan. Ut: earned.json.
//
//   verify  — designerns plan per segment in → HELA verifieringskedjan:
//             validateOps (verb i vokabulären, mål som finns, claims-vakten på
//             all omtextning) → pixelgrindarna i riktig Chromium (overflow,
//             kollision, hjälten först, CTA-hit-test, reversibilitet) med det
//             etablerade retry-steget vid kollision → serve_ops-upplösning
//             (rubrik-lokatorer + exakta texter — det decide-vägen serverar)
//             → FÖRE/EFTER-skärmdumpar → insert-SQL med status='verified'.
//             INGET serveras: verified → serving är alltid ägarens knapp.
//
// Designern är injicerad (samma kontrakt som generateRedesign): i labbet är det
// design-panelen; i produktion Anthropic-adaptern. Kedjan litar ALDRIG på
// designern — allt valideras och grindas här.
//
//   bun run scripts/redesign/auto-generate.ts --mode=detect \
//     --leaves=page-leaves.json --variants=variants.json --pages=pages.json \
//     --site=<slug> --base-url=https://... --site-config=site.json \
//     --out=out [--cap=5]
//   bun run scripts/redesign/auto-generate.ts --mode=verify \
//     --plans=plans.json --pages=pages.json --site=<slug> --base-url=... \
//     --site-config=site.json --out=out
//
//   leaves      = angel_page_segment_rollup-rader (path + 4 dimensioner + räknare)
//   variants    = [{path, segmentKey}] för sajtens icke-pensionerade varianter
//   pages       = {"/": "fixtures/.../home.html", "/pricing": "..."} — frysta kopior
//   plans       = [{path, key, total, observations, ops}] från designpanelen
//   site-config = ägarens mål ur angel_sites: {conversion_text, conversion_kind,
//                 conversion_selector} — briefens mål-rad + CTA-hit-testets
//                 skyddsobjekt. --goal-text/--goal-kind overridar (labbet).
//
// Sidkällan är en KARTA path → självbärande fryst HTML (--pages=<json>).
// Producenten kvittar: freeze-steget (riktiga kundsidor, scripts/redesign/
// freeze-page.ts) eller labbets handbyggda fixtur — kedjan är densamma.
// Celler vars sida saknar fryst kopia hålls ärligt i en "needs_freeze"-kö
// i stället för att gissas fram.

import { chromium, type Page } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { findEarnedCells, type PageSegmentLeaf } from "../../src/adaptive/redesign/earned";
import { isSegmentPrefix, returningToken, segToken, segmentKeyOf } from "../../src/lib/segment-key";
import {
  extractContentModel,
  extractCtaCandidates,
  extractPriceSnippets,
} from "../../src/adaptive/redesign/extract";
import { addLlmCtas } from "../../src/adaptive/redesign/cta-llm.server";
import {
  buildRedesignContext,
  renderRedesignPrompt,
  segmentInsightFrom,
} from "../../src/adaptive/redesign/context";
import { generateRedesign, type RedesignOp } from "../../src/adaptive/redesign/generate";
import {
  evaluateRenderGates,
  type RenderMeasurements,
} from "../../src/adaptive/redesign/render-gates";
import { captureLcpElement, measurePlan, runGatedAttempts, type MeasureOp } from "./measure";
import type { ServeOp } from "../../src/adaptive/redesign/serve";
import type { RedesignContentModel } from "../../src/adaptive/redesign/context";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";
import { RETURNING_TOKEN, segmentDims } from "../../src/lib/segment-key";

// Env-var eller undefined — playwright-core hittar sin egen installation på
// Actions-runnern (samma mönster som serving-smoke; pilotfynd 2026-07-17).
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

const mode = arg("mode");
const outDir = arg("out") ?? "auto-generate-out";
mkdirSync(outDir, { recursive: true });

// ── sajtens inputs ────────────────────────────────────────────────────────────
const site = arg("site") ?? "synthetic-lab";
const baseUrl = (arg("base-url") ?? "https://plausible.io").replace(/\/$/, "");
// Målet är ägarens KONFIGURERADE mål — aldrig en påhittad default. Källa i
// prioritetsordning: explicit CLI-flagga (labbet) → --site-config=<json> med
// raden ur angel_sites (conversion_text/conversion_kind/conversion_selector,
// samma kolumnnamn som DB:n så filen kan produceras av en enda select) → null.
// Utan mål får briefen ingen mål-rad och hit-testet skyddar bara extraherade
// CTA:er — vakuum-varningen i render-gates säger till när det inte räcker.
const siteCfg = arg("site-config")
  ? (JSON.parse(readFileSync(arg("site-config")!, "utf8")) as {
      conversion_text?: string | null;
      conversion_kind?: string | null;
      conversion_selector?: string | null;
    })
  : null;
const GOAL = {
  text: arg("goal-text") ?? siteCfg?.conversion_text ?? null,
  kind: arg("goal-kind") ?? siteCfg?.conversion_kind ?? null,
  selector: siteCfg?.conversion_selector ?? null,
};
/** path → sökväg till självbärande fryst HTML. */
const pages = JSON.parse(readFileSync(arg("pages")!, "utf8")) as Record<string, string>;

const pageCache = new Map<string, { html: string; content: RedesignContentModel }>();
async function pageFor(
  path: string,
): Promise<{ html: string; content: RedesignContentModel } | null> {
  if (pageCache.has(path)) return pageCache.get(path)!;
  const frozen = pages[path];
  if (!frozen) return null;
  const html = readFileSync(frozen, "utf8");
  const entry = { html, content: extractContentModel(html) };
  // Språk-universella lagret: kandidater som den deterministiska vokabulären
  // (EN+SV + ~30 storspråk) inte kände igen LLM-etiketteras (vilket språk som
  // helst). Utan ANTHROPIC_API_KEY står golvet ensamt — och det SYNS via
  // ctaChecked/vakuum-varningen i stället för att gissas bort.
  const llmAdded = await addLlmCtas(entry.content, extractCtaCandidates(html));
  if (llmAdded > 0) console.log(`  språklagret: +${llmAdded} LLM-klassade CTA:er på ${path}`);
  pageCache.set(path, entry);
  return entry;
}
function pageRef(path: string) {
  return {
    url: `${baseUrl}${path}`,
    frozenHtmlPath: pages[path] ?? "",
    screenshotPath: "",
    viewport: { width: 390, height: 844 },
  };
}

/** SegmentSummary ur detektorns fynd — underlaget för briefen. */
function summaryFor(key: string, total: { visits: number; conversions: number }): SegmentSummary {
  const dims = segmentDims(key);
  return {
    key,
    label: dims.join(" · "),
    depth: dims.length,
    channel: dims[0] ?? null,
    device: dims[1] ?? null,
    country: dims[2] ?? null,
    returning: dims.length >= 4 ? dims[3] === RETURNING_TOKEN : null,
    visits: total.visits,
    conversions: total.conversions,
    conversionRate: total.visits > 0 ? total.conversions / total.visits : 0,
    formStarts: 0,
    formAbandons: 0,
    adequate: true,
    recent: null,
  };
}

async function contextFor(
  path: string,
  key: string,
  total: { visits: number; conversions: number },
  observations: string[],
  sourcePaths: string[] = [],
) {
  const page = await pageFor(path);
  if (!page) return null;
  // Korssid-lyftets citerbara material (task #117): källsidornas ordagranna
  // prisutsagor. Bara frysta källsidor med faktiska utsagor erbjuds — och
  // buildRedesignContext lägger till insert_snippet i vokabulären endast då.
  const sourcePages = [];
  for (const sp of sourcePaths) {
    const srcPage = await pageFor(sp);
    if (!srcPage) continue;
    const snippets = extractPriceSnippets(srcPage.html);
    if (snippets.length > 0) sourcePages.push({ path: sp, snippets });
  }
  return buildRedesignContext({
    site,
    goal: GOAL,
    page: pageRef(path),
    content: page.content,
    segment: segmentInsightFrom(summaryFor(key, total), { observations }),
    sourcePages,
  });
}

// ═════════════════════════════════ detect ═══════════════════════════════════
if (mode === "detect") {
  // Löven kommer från angel_page_segment_rollup (per sida); befintliga
  // varianter som (path, segmentKey)-par.
  const leaves = JSON.parse(readFileSync(arg("leaves")!, "utf8")) as PageSegmentLeaf[];
  const existing = JSON.parse(readFileSync(arg("variants")!, "utf8")) as {
    path: string;
    segmentKey: string;
  }[];
  const cap = Number(arg("cap") ?? 5);

  const cells = findEarnedCells(leaves, existing, cap);
  const siteVisits = leaves.reduce((s, l) => s + l.visits, 0);
  const siteConv = leaves.reduce((s, l) => s + l.conversions, 0);
  const siteRate = siteVisits > 0 ? siteConv / siteVisits : 0;

  // Sidflödet (korssid-lyftets signal, task #117 slice 1): "X % av segmentet
  // som landar på P går vidare till Q". Volymgrindad (min 30 nådda + minst
  // dubbla sajtandelen + minst 25 %) — under det skrivs INGEN observation;
  // tomt flows-underlag (t.ex. ensidiga sessioner) är ett ärligt noll-utfall.
  interface FlowRow {
    landing_path: string;
    dest_path: string;
    channel: string;
    device: string;
    country: string;
    is_returning: boolean;
    sessions: number;
    reached: number;
  }
  const flowsPath = arg("flows");
  const flows: FlowRow[] =
    flowsPath && existsSync(flowsPath) ? JSON.parse(readFileSync(flowsPath, "utf8")) : [];
  const FLOW_MIN_REACHED = 30;
  const FLOW_MIN_SHARE = 0.25;
  const flowKeyOf = (r: FlowRow) =>
    segmentKeyOf([
      segToken(r.channel),
      segToken(r.device),
      segToken(r.country),
      returningToken(r.is_returning),
    ]);
  /** Bästa dest-flödet för (sida, segmentnyckel) — eller null under grinden.
   *  Returnerar även destinationen: den blir insert_snippet-opens källsida. */
  function flowObservation(path: string, cellKey: string): { text: string; dest: string } | null {
    const landed = flows.filter((r) => r.landing_path === path);
    if (landed.length === 0) return null;
    // Nämnare räknas EN gång per dim-kombo (sessions upprepas per dest-rad).
    const denom = (rows: FlowRow[]) => {
      const seen = new Map<string, number>();
      for (const r of rows) seen.set(flowKeyOf(r), r.sessions);
      return [...seen.values()].reduce((a, b) => a + b, 0);
    };
    const segRows = landed.filter((r) => isSegmentPrefix(cellKey, flowKeyOf(r)));
    const segSessions = denom(segRows);
    if (segSessions === 0) return null;
    const siteSessions = denom(landed);
    const byDest = new Map<string, { seg: number; site: number }>();
    for (const r of landed) {
      const cur = byDest.get(r.dest_path) ?? { seg: 0, site: 0 };
      cur.site += r.reached;
      if (isSegmentPrefix(cellKey, flowKeyOf(r))) cur.seg += r.reached;
      byDest.set(r.dest_path, cur);
    }
    let best: { dest: string; segShare: number; siteShare: number; seg: number } | null = null;
    for (const [dest, v] of byDest) {
      const segShare = v.seg / segSessions;
      const siteShare = siteSessions > 0 ? v.site / siteSessions : 0;
      if (v.seg < FLOW_MIN_REACHED || segShare < FLOW_MIN_SHARE || segShare < 2 * siteShare) {
        continue;
      }
      if (!best || segShare > best.segShare) best = { dest, segShare, siteShare, seg: v.seg };
    }
    if (!best) return null;
    return {
      text:
        `Sidflödet: ${(best.segShare * 100).toFixed(0)} % av segmentets besökare som landar här ` +
        `går vidare till ${best.dest} (sajtsnitt ${(best.siteShare * 100).toFixed(0)} %, ` +
        `${best.seg} sessioner) — deras fråga verkar besvaras där; prioritera innehåll som ` +
        `svarar på det redan på den här sidan.`,
      dest: best.dest,
    };
  }

  const briefed: unknown[] = [];
  const needsFreeze: unknown[] = [];
  for (const c of cells) {
    const rate = c.total.visits > 0 ? c.total.conversions / c.total.visits : 0;
    // Ärliga, datadrivna observationer — inga påhitt, bara räknade fakta.
    const observations = [
      `Sidan: ${c.path}. Idag når INGEN variant dessa besökare där: ${c.uncoveredLeaves.join(", ")} (${c.incremental.visits} besök, ${c.incremental.conversions} konverteringar i underlaget).`,
      `Cellens konvertering ${(rate * 100).toFixed(1)} % mot sajtsnittet ${(siteRate * 100).toFixed(1)} %.`,
    ];
    const flowObs = flowObservation(c.path, c.key);
    if (flowObs) observations.push(flowObs.text);
    // Källsidor för korssid-lyftet — MED ägarens dubbelvisningsvakt
    // (2026-07-18): visar landningssidan redan egna prisutsagor erbjuds
    // ingen källsida — designern jobbar då med sidans befintliga innehåll
    // (lyft/omformulera), aldrig en dublett av priset.
    let sourcePaths: string[] = [];
    if (flowObs && flowObs.dest !== c.path) {
      const landing = await pageFor(c.path);
      if (landing && extractPriceSnippets(landing.html).length === 0) {
        sourcePaths = [flowObs.dest];
      }
    }
    const ctx = await contextFor(c.path, c.key, c.total, observations, sourcePaths);
    if (!ctx) {
      // Ingen fryst kopia av sidan — ärlig kö i stället för gissad design.
      needsFreeze.push({ ...c, observations });
      continue;
    }
    // sourcePaths i earned.json = de källsidor kontexten FAKTISKT fick (fryst
    // + med utsagor) — nattloopens steg 4 och verify-läget bygger om exakt
    // samma kontext från dem.
    const usedSourcePaths = (ctx.sourcePages ?? []).map((p) => p.path);
    briefed.push({
      ...c,
      observations,
      sourcePaths: usedSourcePaths,
      brief: renderRedesignPrompt(ctx),
    });
  }

  writeFileSync(join(outDir, "earned.json"), JSON.stringify({ briefed, needsFreeze }, null, 2));
  console.log(
    `earned cells: ${cells.length} (briefed ${briefed.length}, needs freeze ${needsFreeze.length})`,
  );
  for (const c of cells) {
    console.log(
      `  ${c.path} × ${c.key} — total ${c.total.visits}/${c.total.conversions}, inkrement ${c.incremental.visits}/${c.incremental.conversions}${pages[c.path] ? "" : "  [SAKNAR FRYST SIDA]"}`,
    );
  }
  process.exit(0);
}

// ═════════════════════════════════ verify ═══════════════════════════════════
if (mode !== "verify") {
  console.error("usage: --mode=detect|verify (se filhuvudet)");
  process.exit(1);
}

interface PlanIn {
  /** Sidan cellen gäller — måste finnas i --pages-kartan. */
  path: string;
  key: string;
  total: { visits: number; conversions: number };
  observations: string[];
  /** Källsidor för insert_snippet (korssid-lyftet) — samma lista som detect
   *  byggde kontexten med, så valideringen ser samma whitelist. */
  sourcePaths?: string[];
  ops: RedesignOp[];
}
const plans = JSON.parse(readFileSync(arg("plans")!, "utf8")) as PlanIn[];

/** Sektions-id → DOM-lokator för serve_ops, per sidas innehållsmodell.
 *  Hjälte-sektionen bor i h1, allt annat i h2 — samma struktur extract.ts
 *  läste ur sidan. */
function locatorFor(content: RedesignContentModel, targetId: string): ServeOp["locator"] | null {
  const sec = content.sections.find((s) => s.id === targetId);
  if (!sec?.heading) return null;
  return { tag: sec.type === "hero" ? "h1" : "h2", text: sec.heading };
}

/** Hjältens h1-lokator — insert_snippet-opens ankare. "hero" är ett syntetiskt
 *  targetId (ingen sektionsrad), så locatorFor kan inte slå upp det. */
function heroLocatorFor(content: RedesignContentModel): ServeOp["locator"] | null {
  const heroSec = content.sections.find((s) => s.type === "hero");
  const text = heroSec?.heading || content.hero?.headline;
  return text ? { tag: "h1", text } : null;
}

function toServeOps(content: RedesignContentModel, ops: RedesignOp[]): ServeOp[] | null {
  const out: ServeOp[] = [];
  for (const o of ops) {
    if (o.op === "insert_snippet") {
      const locator = heroLocatorFor(content);
      if (!locator) return null;
      out.push({ op: "insert_snippet", locator, value: o.detail, why: o.why });
      continue;
    }
    const locator = locatorFor(content, o.targetId);
    if (!locator) return null;
    if (o.op === "move_up") out.push({ op: "move_up", locator, why: o.why });
    else if (o.op === "set_text")
      out.push({ op: "set_text", locator, value: o.detail, why: o.why });
    else return null; // condense/reveal serveras inte i v1 — fail closed
  }
  return out;
}

/** Applicera en HEL plan (flyttar + omtextningar) i sidan och mät grindarnas
 *  underlag. Samma mätning som slice 3b, plus set_text före mätningen så att
 *  text som ändrar layouten (radbrytningar → overflow/CTA under folden) syns. */
const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const results: unknown[] = [];
const sqlParts: string[] = [];

try {
  for (const plan of plans) {
    const pg = await pageFor(plan.path);
    if (!pg) {
      results.push({ path: plan.path, key: plan.key, verdict: "needs_freeze" });
      console.log(`  ${plan.path} × ${plan.key}: SAKNAR fryst sida — köad`);
      continue;
    }
    const { html, content } = pg;
    // Hit-test-listan = extraherade konverterings-CTA:er ∪ ägarens måltext —
    // måltexten är exakt strängen snippetens conversion_text-fallback matchar
    // på i drift, så grinden vaktar samma element som räknar konverteringar.
    // Finns texten inte på sidan blir proben null (inte broken) — ofarlig.
    const ctaTexts = [
      ...new Set([
        ...content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text),
        ...(GOAL.text ? [GOAL.text] : []),
      ]),
    ];
    const ctaSelectors = GOAL.selector ? [GOAL.selector] : [];
    const slug = `${plan.path.replace(/\//g, "-").replace(/^-|-$/g, "") || "home"}--${plan.key
      .replace(/·/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .toLowerCase()}`.replace(/^--/, "");
    const ctx = (await contextFor(
      plan.path,
      plan.key,
      plan.total,
      plan.observations,
      plan.sourcePaths ?? [],
    ))!;
    // Den RIKTIGA valideringen: verb i vokabulären, targetId måste finnas,
    // claims-vakten på varje omtextning. Kedjan litar aldrig på designern.
    const validated = await generateRedesign(ctx, async () => JSON.stringify(plan.ops));
    if (validated.ops.length !== plan.ops.length) {
      results.push({
        path: plan.path,
        key: plan.key,
        verdict: "rejected_by_validation",
        dropped: plan.ops.length - validated.ops.length,
        notes: validated.notes,
      });
      console.log(
        `  ${plan.path} × ${plan.key}: AVVISAD i valideringen (${plan.ops.length - validated.ops.length} op(s) föll)`,
      );
      continue;
    }

    // Serve-formade mät-ops i PLANORDNING — exakt det snippeten kommer att
    // applicera för riktiga besökare (granskningsfynd: en enda semantik).
    const measureOps: MeasureOp[] = [];
    for (const o of validated.ops) {
      const loc =
        o.op === "insert_snippet" ? heroLocatorFor(content) : locatorFor(content, o.targetId);
      if (!loc) {
        measureOps.length = 0;
        break;
      }
      measureOps.push(
        o.op === "move_up"
          ? { op: "move_up", tag: loc.tag, find: loc.text }
          : o.op === "insert_snippet"
            ? { op: "insert_snippet", tag: loc.tag, find: loc.text, set: o.detail }
            : { op: "set_text", tag: loc.tag, find: loc.text, set: o.detail },
      );
    }
    if (measureOps.length !== validated.ops.length) {
      results.push({ path: plan.path, key: plan.key, verdict: "no_serve_ops" });
      console.log(`  ${plan.path} × ${plan.key}: lokator saknas för op — hålls tillbaka`);
      continue;
    }

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", (r) => r.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(400);
    // LCP-elementet måste fångas FÖRE fullPage-skärmdumpen — dumpen scrollar
    // sidan och förorenar LCP-entries med element under folden (task #105).
    const lcp = await captureLcpElement(page);
    console.log(
      `  ${plan.path} × ${plan.key}: LCP-element ${lcp.found ? `<${lcp.tag}> "${lcp.text ?? ""}"` : "EJ observerat — servbarhets-kollen blir vakuös"}`,
    );
    await page.screenshot({
      path: join(outDir, `${slug}-before.jpg`),
      type: "jpeg",
      quality: 60,
      fullPage: true,
    });

    // Grindarna + retry-steget — DELADE (runGatedAttempts i measure.ts):
    // kollision → ETT extra lyft per UNIK måltavla, och mätningen/serve_ops
    // räknar per konstruktion samma antal lyft i alla harness.
    const { attempts, attemptOps, unresolvable, extraLiftApplied } = await runGatedAttempts(
      page,
      measureOps,
      ctaTexts,
      { ctaSelectors },
    );
    if (unresolvable) {
      results.push({
        path: plan.path,
        key: plan.key,
        verdict: "not_applicable",
        reason: "op-mål/sektion kunde inte upplösas på sidan (v3 fail closed)",
      });
      console.log(
        `  ${plan.path} × ${plan.key}: EJ APPLICERBAR — upplösningen vägrade (fail closed)`,
      );
      await context.close();
      continue;
    }
    const last = attempts[attempts.length - 1];

    // EFTER-skärmdump: SAMMA mätfunktion med keepApplied — ingen tredje
    // appliceringsalgoritm (granskningsfynd: skärmdumpen ägaren godkänner på
    // måste komma från exakt den applicering som grindades).
    await measurePlan(page, attemptOps, [], true);
    await page.screenshot({
      path: join(outDir, `${slug}-after.jpg`),
      type: "jpeg",
      quality: 60,
      fullPage: true,
    });
    await context.close();

    if (last.gate.verdict !== "pass") {
      results.push({ path: plan.path, key: plan.key, verdict: "gate_fail", attempts });
      console.log(
        `  ${plan.path} × ${plan.key}: GRIND-FAIL efter ${attempts.length} försök — hålls tillbaka`,
      );
      continue;
    }

    // Grindat OK → bygg det serverbara + evidensen.
    // Retry-lyftet blir en extra move_up-op per mål så plan/serve_ops/sanning matchar.
    const finalOps: RedesignOp[] = !extraLiftApplied
      ? validated.ops
      : [
          ...validated.ops,
          // ETT extra lyft per UNIK måltavla — exakt vad retry-mätningen
          // körde (attemptOps), så serve_ops == det grindade antalet lyft.
          ...[
            ...new Map(
              validated.ops.filter((o) => o.op === "move_up").map((o) => [o.targetId, o]),
            ).values(),
          ].map((o, i, arr) => ({
            ...o,
            detail: `extra lyft ${i + 1}/${arr.length} — kollisionsgrindens retry fann ren placering ett steg högre`,
            why: `försök 1 introducerade +${attempts[0].gate.verticalOverlapIntroducedPx}px överlapp; försök 2 +${last.gate.verticalOverlapIntroducedPx}px`,
          })),
        ];
    const serveOps = toServeOps(content, finalOps);
    if (!serveOps) {
      results.push({ path: plan.path, key: plan.key, verdict: "no_serve_ops" });
      continue;
    }

    const evidence = {
      source: "auto-generate-loop",
      brief: { path: plan.path, key: plan.key, total: plan.total, observations: plan.observations },
      gates: {
        hOverflowIntroducedPx: last.gate.hOverflowIntroducedPx,
        verticalOverlapIntroducedPx: last.gate.verticalOverlapIntroducedPx,
        movedAboveMain: last.measurements.movedAboveMain,
        // BÅDA talen — ctaBroken utan ctaChecked dolde vakuösa hit-test för
        // ägarknappen (0 kontrollerade såg ut som "0 trasiga, allt väl").
        ctaChecked: last.measurements.ctaChecked,
        ctaBroken: last.measurements.ctaBroken,
        reversible: last.measurements.reversedOrderMatches,
        // Servbarhets-kollen (task #105) — hit kommer bara pass (0 träffar),
        // men lcpFound dokumenterar att kollen faktiskt kördes mot ett element.
        lcpFound: last.measurements.lcpFound ?? null,
        opsTouchingLcp: last.measurements.opsTouchingLcp ?? null,
        // Insättnings-grindarna (task #117) — null när planen saknar inserts.
        lcpShiftPx: last.measurements.lcpShiftPx ?? null,
        insertedVisible: last.measurements.insertedVisible ?? null,
        insertedRemoved: last.measurements.insertedRemoved ?? null,
        attempts: attempts.length,
      },
      // Självläkningens krok (ägarbeslut 2026-07-18): varje insatt citat
      // deklarerar sin källsida + exakta text, så drift-svepet kan hålla/
      // uppdatera varianten när källan ändras. Tom lista för planer utan
      // inserts — fältet är kontraktet, inte innehållet.
      dependencies: finalOps
        .filter((o) => o.op === "insert_snippet" && o.sourcePath)
        .map((o) => ({ path: o.sourcePath!, textSnapshot: o.detail })),
      comparison: {
        headline: measureOps.find((o) => o.op === "set_text" && o.tag === "h1")?.set ?? null,
        orderBefore: last.measurements.beforeOrder,
        orderAfter: last.measurements.afterOrder,
        movedLabel: measureOps.find((o) => o.op === "move_up")?.find.slice(0, 40) ?? null,
        screenshots: {
          before: `/evidence/${site}/${slug}/before.jpg`,
          after: `/evidence/${site}/${slug}/after.jpg`,
          attempt1: null,
        },
      },
    };
    const esc = (s: string) => s.replace(/'/g, "''");
    sqlParts.push(
      `insert into angel_variants (site, path, segment_key, status, ops, serve_ops, evidence)\n` +
        `values ('${site}', '${esc(plan.path)}', '${esc(plan.key)}', 'verified', '${esc(JSON.stringify(finalOps))}'::jsonb, '${esc(JSON.stringify(serveOps))}'::jsonb, '${esc(JSON.stringify(evidence))}'::jsonb);`,
    );
    // ops med i resultatet så en orkestrerare (nattloopen) kan göra direkta
    // inserts via service-klienten i stället för att köra SQL-filen.
    results.push({
      path: plan.path,
      key: plan.key,
      verdict: "verified",
      attempts,
      ops: finalOps,
      serveOps,
      evidence,
      slug,
    });
    console.log(
      `  ${plan.path} × ${plan.key}: VERIFIED (${attempts.length} försök) — väntar på ägarens knapp`,
    );
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "verify-report.json"), JSON.stringify(results, null, 2));
if (sqlParts.length)
  writeFileSync(join(outDir, "insert-variants.sql"), sqlParts.join("\n\n") + "\n");
console.log(
  `\nreport: ${outDir}/verify-report.json${sqlParts.length ? ` · sql: ${outDir}/insert-variants.sql` : ""}`,
);
