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
//     --site=<slug> --base-url=https://... --goal-text="..." --goal-kind=trial \
//     --out=out [--cap=5]
//   bun run scripts/redesign/auto-generate.ts --mode=verify \
//     --plans=plans.json --pages=pages.json --site=<slug> --base-url=... \
//     --goal-text="..." --out=out
//
//   leaves    = angel_page_segment_rollup-rader (path + 4 dimensioner + räknare)
//   variants  = [{path, segmentKey}] för sajtens icke-pensionerade varianter
//   pages     = {"/": "fixtures/.../home.html", "/pricing": "..."} — frysta kopior
//   plans     = [{path, key, total, observations, ops}] från designpanelen
//
// Sidkällan är en KARTA path → självbärande fryst HTML (--pages=<json>).
// Producenten kvittar: freeze-steget (riktiga kundsidor, scripts/redesign/
// freeze-page.ts) eller labbets handbyggda fixtur — kedjan är densamma.
// Celler vars sida saknar fryst kopia hålls ärligt i en "needs_freeze"-kö
// i stället för att gissas fram.

import { chromium, type Page } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { findEarnedCells, type PageSegmentLeaf } from "../../src/adaptive/redesign/earned";
import { extractContentModel } from "../../src/adaptive/redesign/extract";
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
import type { ServeOp } from "../../src/adaptive/redesign/serve";
import type { RedesignContentModel } from "../../src/adaptive/redesign/context";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";

const EXEC = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];

const mode = arg("mode");
const outDir = arg("out") ?? "auto-generate-out";
mkdirSync(outDir, { recursive: true });

// ── sajtens inputs ────────────────────────────────────────────────────────────
const site = arg("site") ?? "synthetic-lab";
const baseUrl = (arg("base-url") ?? "https://plausible.io").replace(/\/$/, "");
const GOAL = {
  text: arg("goal-text") ?? "Start free trial",
  kind: arg("goal-kind") ?? "trial",
  selector: null,
};
/** path → sökväg till självbärande fryst HTML. */
const pages = JSON.parse(readFileSync(arg("pages")!, "utf8")) as Record<string, string>;

const pageCache = new Map<string, { html: string; content: RedesignContentModel }>();
function pageFor(path: string): { html: string; content: RedesignContentModel } | null {
  if (pageCache.has(path)) return pageCache.get(path)!;
  const frozen = pages[path];
  if (!frozen) return null;
  const html = readFileSync(frozen, "utf8");
  const entry = { html, content: extractContentModel(html) };
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
  const dims = key.split("·");
  return {
    key,
    label: dims.join(" · "),
    depth: dims.length,
    channel: dims[0] ?? null,
    device: dims[1] ?? null,
    country: dims[2] ?? null,
    returning: dims.length >= 4 ? dims[3] === "återkommande" : null,
    visits: total.visits,
    conversions: total.conversions,
    conversionRate: total.visits > 0 ? total.conversions / total.visits : 0,
    formStarts: 0,
    formAbandons: 0,
    adequate: true,
    recent: null,
  };
}

function contextFor(
  path: string,
  key: string,
  total: { visits: number; conversions: number },
  observations: string[],
) {
  const page = pageFor(path);
  if (!page) return null;
  return buildRedesignContext({
    site,
    goal: GOAL,
    page: pageRef(path),
    content: page.content,
    segment: segmentInsightFrom(summaryFor(key, total), { observations }),
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

  const briefed: unknown[] = [];
  const needsFreeze: unknown[] = [];
  for (const c of cells) {
    const rate = c.total.visits > 0 ? c.total.conversions / c.total.visits : 0;
    // Ärliga, datadrivna observationer — inga påhitt, bara räknade fakta.
    const observations = [
      `Sidan: ${c.path}. Idag når INGEN variant dessa besökare där: ${c.uncoveredLeaves.join(", ")} (${c.incremental.visits} besök, ${c.incremental.conversions} konverteringar i underlaget).`,
      `Cellens konvertering ${(rate * 100).toFixed(1)} % mot sajtsnittet ${(siteRate * 100).toFixed(1)} %.`,
    ];
    const ctx = contextFor(c.path, c.key, c.total, observations);
    if (!ctx) {
      // Ingen fryst kopia av sidan — ärlig kö i stället för gissad design.
      needsFreeze.push({ ...c, observations });
      continue;
    }
    briefed.push({ ...c, observations, brief: renderRedesignPrompt(ctx) });
  }

  writeFileSync(
    join(outDir, "earned.json"),
    JSON.stringify({ briefed, needsFreeze }, null, 2),
  );
  console.log(`earned cells: ${cells.length} (briefed ${briefed.length}, needs freeze ${needsFreeze.length})`);
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

function toServeOps(content: RedesignContentModel, ops: RedesignOp[]): ServeOp[] | null {
  const out: ServeOp[] = [];
  for (const o of ops) {
    const locator = locatorFor(content, o.targetId);
    if (!locator) return null;
    if (o.op === "move_up") out.push({ op: "move_up", locator, why: o.why });
    else if (o.op === "set_text") out.push({ op: "set_text", locator, value: o.detail, why: o.why });
    else return null; // condense/reveal serveras inte i v1 — fail closed
  }
  return out;
}

/** Applicera en HEL plan (flyttar + omtextningar) i sidan och mät grindarnas
 *  underlag. Samma mätning som slice 3b, plus set_text före mätningen så att
 *  text som ändrar layouten (radbrytningar → overflow/CTA under folden) syns. */
async function measurePlan(page: Page, moveHeadings: string[], texts: { tag: string; find: string; set: string }[], ctaTexts: string[]) {
  return page.evaluate(
    ({ moveHeadings, texts, ctaTexts }) => {
      const mainEl = document.querySelector("main") || document.body;
      const anchor = document.querySelector("h1") || document.querySelector("main");
      const anchorTop = anchor ? anchor.getBoundingClientRect().top + window.scrollY : null;
      const de = document.documentElement;

      // v2 (wrapper-medveten, SAMMA som snippetens applyVariant): sektionen är
      // närmaste förfader vars syskon också innehåller sektionsrubriker.
      const heads = Array.from(mainEl.querySelectorAll("h1,h2"));
      function container(el: Element): Element {
        const siblingHasHeading = (node: Element): boolean => {
          const p = node.parentElement;
          if (!p) return false;
          for (const sib of Array.from(p.children)) {
            if (sib === node) continue;
            if (heads.some((h) => sib === h || sib.contains(h))) return true;
          }
          return false;
        };
        let node: Element = el;
        while (node.parentElement && node.parentElement !== document.body) {
          // Aldrig rubriken själv (platta artikelsidor) — samma spärr som snippeten.
          if (node !== el && siblingHasHeading(node)) return node;
          node = node.parentElement;
        }
        return node;
      }
      const tracked: { label: string; el: Element }[] = [];
      for (const h of heads) {
        const txt = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        const c = container(h);
        if (!tracked.some((t) => t.el === c)) tracked.push({ label: txt.slice(0, 40), el: c });
      }
      // Ordning i DOKUMENT-ordning (sektioner kan bo under olika föräldrar).
      const orderOf = () =>
        tracked
          .slice()
          .sort((a, b) =>
            a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
          )
          .map((t) => t.label);

      function ctaClickable(text: string): boolean | null {
        const matches = Array.from(document.querySelectorAll("a,button")).filter((n) =>
          (n.textContent || "").replace(/\s+/g, " ").trim().includes(text),
        );
        if (!matches.length) return null;
        const el = matches.find((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        return !!top && (el.contains(top) || top.contains(el));
      }
      // Överlapp mäts inom varje FÖRÄLDRAGRUPP som bär sektioner (v2: de kan
      // bo i en wrapper, inte direkt under main) — max över grupperna.
      const sectionParents = [...new Set(tracked.map((t) => t.el.parentElement).filter(Boolean))] as Element[];
      const overlapParents = sectionParents.length ? sectionParents : [mainEl];
      const maxAdjacentOverlap = () => {
        let mx = 0;
        for (const parent of overlapParents) {
          const kids = Array.from(parent.children).filter((c) => c.getBoundingClientRect().height > 30);
          for (let i = 0; i < kids.length - 1; i++) {
            const a = kids[i].getBoundingClientRect();
            const b = kids[i + 1].getBoundingClientRect();
            mx = Math.max(mx, Math.round(a.bottom - b.top));
          }
        }
        return mx;
      };

      const ctaBefore = ctaTexts.map((t) => ({ t, ok: ctaClickable(t) }));
      const beforeOrder = orderOf();
      const hOverflowBeforePx = Math.max(0, de.scrollWidth - de.clientWidth);
      const vOverlapBeforePx = maxAdjacentOverlap();
      // Exakt återställning: snapshot av barnlistan i varje sektionsförälder.
      const parentSnapshots = overlapParents.map((p) => ({ p, kids: Array.from(p.children) }));

      // 1) Omtextningar först (samma ordning som servering: ops i planföljd).
      const textSnapshots: { el: Element; html: string }[] = [];
      let textApplied = 0;
      for (const t of texts) {
        const needle = t.find.replace(/\s+/g, " ").trim().slice(0, 24).toLowerCase();
        const el = Array.from(document.querySelectorAll(t.tag)).find((e) =>
          (e.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().includes(needle),
        );
        if (!el) continue;
        textSnapshots.push({ el, html: el.innerHTML });
        el.textContent = t.set;
        textApplied++;
      }

      // 2) Flyttar — ett stegs lyft per post, i ordning.
      let applied = 0;
      const movedEls: Element[] = [];
      for (const heading of moveHeadings) {
        const t = tracked.find((x) => heading.replace(/\s+/g, " ").trim().startsWith(x.label));
        const target = t?.el ?? tracked.find((x) => heading.includes(x.label))?.el;
        if (!target) continue;
        const prev = target.previousElementSibling;
        if (prev && target.parentElement === prev.parentElement) {
          target.parentElement!.insertBefore(target, prev);
          if (!movedEls.includes(target)) movedEls.push(target);
          applied++;
        }
      }

      const afterOrder = orderOf();
      const hOverflowAfterPx = Math.max(0, de.scrollWidth - de.clientWidth);
      const vOverlapAfterPx = maxAdjacentOverlap();
      let movedAboveMain = 0;
      for (const el of movedEls) {
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (anchorTop !== null && top < anchorTop - 1) movedAboveMain++;
      }
      const ctaAfter = ctaTexts.map((t) => ({ t, ok: ctaClickable(t) }));
      let ctaChecked = 0;
      let ctaBroken = 0;
      for (const b of ctaBefore) {
        if (b.ok === true) {
          ctaChecked++;
          const a = ctaAfter.find((x) => x.t === b.t);
          if (a && a.ok !== true) ctaBroken++;
        }
      }

      // Exakt återställning (ordning + text) per sektionsförälder, sedan verifiera.
      for (const snap of parentSnapshots) for (const el of snap.kids) snap.p.appendChild(el);
      for (const s of textSnapshots) s.el.innerHTML = s.html;
      const resetOrder = orderOf();

      return {
        beforeOrder,
        afterOrder,
        resetOrder,
        hOverflowBeforePx,
        hOverflowAfterPx,
        vOverlapBeforePx,
        vOverlapAfterPx,
        movedCount: movedEls.length,
        movedAboveMain,
        mainAnchorFound: anchorTop !== null,
        ctaChecked,
        ctaBroken,
        requestedMoves: moveHeadings.length,
        appliedMoves: applied,
        requestedTexts: texts.length,
        appliedTexts: textApplied,
      };
    },
    { moveHeadings, texts, ctaTexts },
  );
}

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const results: unknown[] = [];
const sqlParts: string[] = [];

try {
  for (const plan of plans) {
    const pg = pageFor(plan.path);
    if (!pg) {
      results.push({ path: plan.path, key: plan.key, verdict: "needs_freeze" });
      console.log(`  ${plan.path} × ${plan.key}: SAKNAR fryst sida — köad`);
      continue;
    }
    const { html, content } = pg;
    const ctaTexts = content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text);
    const slug = `${plan.path.replace(/\//g, "-").replace(/^-|-$/g, "") || "home"}--${plan.key
      .replace(/·/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .toLowerCase()}`.replace(/^--/, "");
    const ctx = contextFor(plan.path, plan.key, plan.total, plan.observations)!;
    // Den RIKTIGA valideringen: verb i vokabulären, targetId måste finnas,
    // claims-vakten på varje omtextning. Kedjan litar aldrig på designern.
    const validated = await generateRedesign(ctx, async () => JSON.stringify(plan.ops));
    if (validated.ops.length !== plan.ops.length) {
      results.push({ path: plan.path, key: plan.key, verdict: "rejected_by_validation", dropped: plan.ops.length - validated.ops.length, notes: validated.notes });
      console.log(`  ${plan.path} × ${plan.key}: AVVISAD i valideringen (${plan.ops.length - validated.ops.length} op(s) föll)`);
      continue;
    }

    const moveHeadings0 = validated.ops
      .filter((o) => o.op === "move_up")
      .map((o) => content.sections.find((s) => s.id === o.targetId)?.heading)
      .filter((h): h is string => !!h);
    const texts = validated.ops
      .filter((o) => o.op === "set_text")
      .map((o) => {
        const loc = locatorFor(content, o.targetId)!;
        return { tag: loc.tag ?? "h2", find: loc.text, set: o.detail };
      });

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", (r) => r.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `${slug}-before.jpg`), type: "jpeg", quality: 60, fullPage: true });

    // Grindarna + det etablerade retry-steget: kollision → varje flyttmål lyfts
    // ett steg till (samma logiska ordning, annan fysisk placering). En retry.
    let moveHeadings = moveHeadings0;
    const attempts: { attempt: number; measurements: RenderMeasurements; gate: ReturnType<typeof evaluateRenderGates> }[] = [];
    let extraLift = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const raw = await measurePlan(page, moveHeadings, texts, ctaTexts);
      const measurements: RenderMeasurements = {
        beforeOrder: raw.beforeOrder,
        afterOrder: raw.afterOrder,
        hOverflowBeforePx: raw.hOverflowBeforePx,
        hOverflowAfterPx: raw.hOverflowAfterPx,
        movedCount: raw.movedCount,
        movedAboveMain: raw.movedAboveMain,
        mainAnchorFound: raw.mainAnchorFound,
        ctaChecked: raw.ctaChecked,
        ctaBroken: raw.ctaBroken,
        requestedMoves: raw.requestedMoves,
        appliedMoves: raw.appliedMoves,
        reversedOrderMatches: JSON.stringify(raw.resetOrder) === JSON.stringify(raw.beforeOrder),
        verticalOverlapIntroducedPx: Math.max(0, raw.vOverlapAfterPx - raw.vOverlapBeforePx),
      };
      const gate = evaluateRenderGates(measurements);
      attempts.push({ attempt, measurements, gate });
      const collision = gate.verdict === "fail" && gate.reasons.some((r) => /vertical overlap/.test(r));
      if (collision && attempt === 1 && moveHeadings.length > 0) {
        moveHeadings = [...moveHeadings, ...new Set(moveHeadings)];
        extraLift = 1;
        continue;
      }
      break;
    }
    const last = attempts[attempts.length - 1];

    // EFTER-skärmdump av slutliga försöket (applicerat, ej återställt).
    await measurePlan(page, moveHeadings, texts, []); // mät-appliceringen återställer — applicera om utan reset:
    await page.evaluate(
      ({ moveHeadings, texts }) => {
        const mainEl = document.querySelector("main") || document.body;
        const heads = Array.from(mainEl.querySelectorAll("h1,h2"));
        // Samma v2-upplösning som mätningen och snippeten.
        function container(el: Element): Element {
          const siblingHasHeading = (node: Element): boolean => {
            const p = node.parentElement;
            if (!p) return false;
            for (const sib of Array.from(p.children)) {
              if (sib === node) continue;
              if (heads.some((h) => sib === h || sib.contains(h))) return true;
            }
            return false;
          };
          let n: Element = el;
          while (n.parentElement && n.parentElement !== document.body) {
            if (n !== el && siblingHasHeading(n)) return n;
            n = n.parentElement;
          }
          return n;
        }
        for (const t of texts) {
          const needle = t.find.replace(/\s+/g, " ").trim().slice(0, 24).toLowerCase();
          const el = Array.from(document.querySelectorAll(t.tag)).find((e) =>
            (e.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().includes(needle),
          );
          if (el) el.textContent = t.set;
        }
        for (const heading of moveHeadings) {
          const h = heads.find((x) => heading.includes((x.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)));
          if (!h) continue;
          const target = container(h);
          const prev = target.previousElementSibling;
          if (prev && target.parentElement === prev.parentElement) target.parentElement!.insertBefore(target, prev);
        }
      },
      { moveHeadings, texts },
    );
    await page.screenshot({ path: join(outDir, `${slug}-after.jpg`), type: "jpeg", quality: 60, fullPage: true });
    await context.close();

    if (last.gate.verdict !== "pass") {
      results.push({ path: plan.path, key: plan.key, verdict: "gate_fail", attempts });
      console.log(`  ${plan.path} × ${plan.key}: GRIND-FAIL efter ${attempts.length} försök — hålls tillbaka`);
      continue;
    }

    // Grindat OK → bygg det serverbara + evidensen.
    // Retry-lyftet blir en extra move_up-op per mål så plan/serve_ops/sanning matchar.
    const finalOps: RedesignOp[] =
      extraLift === 0
        ? validated.ops
        : [
            ...validated.ops,
            ...validated.ops
              .filter((o) => o.op === "move_up")
              .map((o, i, arr) => ({
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
        ctaBroken: last.measurements.ctaBroken,
        reversible: last.measurements.reversedOrderMatches,
        attempts: attempts.length,
      },
      comparison: {
        headline: texts.find((t) => t.tag === "h1")?.set ?? null,
        orderBefore: last.measurements.beforeOrder,
        orderAfter: last.measurements.afterOrder,
        movedLabel: moveHeadings0[0]?.slice(0, 40) ?? null,
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
    results.push({ path: plan.path, key: plan.key, verdict: "verified", attempts, serveOps, evidence });
    console.log(`  ${plan.path} × ${plan.key}: VERIFIED (${attempts.length} försök) — väntar på ägarens knapp`);
  }
} finally {
  await browser.close();
}

writeFileSync(join(outDir, "verify-report.json"), JSON.stringify(results, null, 2));
if (sqlParts.length) writeFileSync(join(outDir, "insert-variants.sql"), sqlParts.join("\n\n") + "\n");
console.log(`\nreport: ${outDir}/verify-report.json${sqlParts.length ? ` · sql: ${outDir}/insert-variants.sql` : ""}`);
