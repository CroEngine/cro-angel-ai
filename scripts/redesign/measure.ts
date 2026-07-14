// Delad tvåfas-mätning — EN implementation för alla harness (auto-generate,
// breadth-test, lab/redesign-render). Snippeten (public/adaptive.js) bär
// medvetet en egen kopia av samma semantik (den är fristående JS på kundens
// sida); CI-smoken bevisar ekvivalensen mellan snippet och denna mätning på
// fixturer. Här bor också den delade grind-loopen (runGatedAttempts): samma
// kollisions-retry — ETT extra lyft per UNIKT mål — i alla harness, så
// mätningen och serve_ops alltid räknar samma antal lyft.

import { evaluateRenderGates, type RenderMeasurements } from "../../src/adaptive/redesign/render-gates";

import type { Page } from "playwright-core";

/** En mät-op i PLANORDNING — samma form som snippetens serve-ops. */
export interface MeasureOp {
  op: "move_up" | "set_text";
  tag?: string;
  find: string;
  set?: string;
}

/** Tvåfas-mätningen — SAMMA kontrakt som snippetens applyVariant v3
 *  (granskningsfynd 2026-07-14): (1) upplös varje ops mål (och sektion) mot
 *  ORÖRD, main-scopad DOM; (2) applicera i planordning. keepApplied=true
 *  lämnar sidan applicerad (för EFTER-skärmdumpen) i stället för att en
 *  tredje algoritm återappliceras. */
export async function measurePlan(
  page: Page,
  ops: MeasureOp[],
  ctaTexts: string[],
  keepApplied = false,
  // Ägarens conversion_selector (rått-override-sajter har text=null) — hit-testas
  // precis som texterna så vakuum-varningen inte återkommer för dem.
  ctaSelectors: string[] = [],
) {
  return page.evaluate(
    ({ ops, ctaTexts, ctaSelectors, keepApplied }) => {
      const mainEl = document.querySelector("main") || document.body;
      const de = document.documentElement;
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();

      // ── v3-upplösning (identisk med snippeten) ──────────────────────────
      // Census: h2 i main, aldrig header/nav/footer/aside. Förberäknade
      // förfaderskartor gör allt linjärt (granskningens O(H²)-fynd).
      const census = Array.from(mainEl.querySelectorAll("h2")).filter(
        (h) => !h.closest("header,nav,footer,aside"),
      );
      const censusCount = new Map<Element, number>();
      for (const h of census) {
        let walk: Element | null = h;
        while (walk && walk !== document.documentElement) {
          censusCount.set(walk, (censusCount.get(walk) ?? 0) + 1);
          walk = walk.parentElement;
        }
      }
      function sectionOf(headEl: Element): Element | null {
        let n: Element | null = headEl.parentElement;
        while (n && n !== document.body && n !== mainEl.parentElement) {
          if ((censusCount.get(n) ?? 0) === 1) {
            const p: Element | null = n.parentElement;
            if (p) {
              for (const sib of Array.from(p.children)) {
                if (sib !== n && censusCount.has(sib)) return n;
              }
            }
          }
          n = n.parentElement;
        }
        return null;
      }
      function findByLocator(tag: string | undefined, find: string): Element | null {
        const needle = norm(find).slice(0, 24).toLowerCase();
        if (!needle) return null;
        for (const el of Array.from(mainEl.querySelectorAll(tag || "h1,h2,h3"))) {
          if (norm(el.textContent || "").toLowerCase().includes(needle)) return el;
        }
        return null;
      }

      // ── rapporterings-modellen: sektioner + block ───────────────────────
      const tracked: { label: string; el: Element }[] = [];
      for (const h of census) {
        const sec = sectionOf(h);
        if (sec && !tracked.some((t) => t.el === sec))
          tracked.push({ label: norm(h.textContent || "").slice(0, 40), el: sec });
      }
      const docSort = (a: Element, b: Element) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      // Identitetssekvens för logik (dubblettrubriker gör etiketter opålitliga),
      // etiketter för läsbar rapport — unika via #n-suffix vid krock.
      const displayLabels = tracked.map((t, i) => {
        const dupes = tracked.filter((x) => x.label === t.label);
        return dupes.length > 1 ? `${t.label} #${dupes.indexOf(t) + 1}` : t.label;
      });
      const identityOrder = () =>
        tracked
          .map((t, i) => ({ i, el: t.el }))
          .sort((a, b) => docSort(a.el, b.el))
          .map((x) => x.i);
      const labelsOf = (idx: number[]) => idx.map((i) => displayLabels[i]);

      // Block-mängd för överlapp/hjälte: barn till main + sektionsföräldrar,
      // nesting-fri (ett block som INNEHÅLLER ett annat block utesluts — annars
      // jämförs wrappern mot sin egen sektion). Granskningens fynd: överlapp
      // ska ses ÖVER föräldragränser (lyft sektion mot hjälte i annan låda).
      const parents = [...new Set(tracked.map((t) => t.el.parentElement).filter(Boolean))] as Element[];
      const rawBlocks = [
        ...new Set([...Array.from(mainEl.children), ...parents.flatMap((p) => Array.from(p.children))]),
      ].filter((b) => b.getBoundingClientRect().height > 30);
      const blocks = rawBlocks.filter((b) => !rawBlocks.some((o) => o !== b && b.contains(o)));
      const blockPairsOverlap = () => {
        const sorted = blocks.slice().sort(docSort);
        const m = new Map<Element, number>();
        for (let i = 0; i < sorted.length - 1; i++) {
          const a = sorted[i].getBoundingClientRect();
          const b = sorted[i + 1].getBoundingClientRect();
          m.set(sorted[i], Math.round(a.bottom - b.top));
        }
        return m;
      };
      // Hjälten = blocket som bär sidans h1 (finns alltid en h1 på sidorna vi
      // designar för; annars första blocket).
      const h1 = mainEl.querySelector("h1");
      const heroBlock = (h1 && blocks.find((b) => b === h1 || b.contains(h1))) ?? blocks.slice().sort(docSort)[0] ?? null;

      function hitTest(el: Element): boolean {
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        return !!top && (el.contains(top) || top.contains(el));
      }
      function ctaClickable(text: string): boolean | null {
        const matches = Array.from(document.querySelectorAll("a,button")).filter((n) =>
          norm(n.textContent || "").includes(text),
        );
        if (!matches.length) return null;
        const el = matches.find((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        return el ? hitTest(el) : false;
      }
      function ctaClickableSel(sel: string): boolean | null {
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          return null; // ogiltig selektor ≠ trasig sida — bara inget att kontrollera
        }
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        return hitTest(el);
      }
      // Text- och selektor-prober i EN lista; paras före/efter via index så
      // dubblett-nycklar aldrig kan korspara.
      const ctaProbes: { key: string; bySel: boolean }[] = [
        ...ctaTexts.map((t) => ({ key: t, bySel: false })),
        ...ctaSelectors.map((s) => ({ key: s, bySel: true })),
      ];
      const probeCta = (p: { key: string; bySel: boolean }) =>
        p.bySel ? ctaClickableSel(p.key) : ctaClickable(p.key);

      // ── FÖRE-mätningar ─────────────────────────────────────────────────
      const ctaBefore = ctaProbes.map((p) => probeCta(p));
      const beforeIdx = identityOrder();
      const hOverflowBeforePx = Math.max(0, de.scrollWidth - de.clientWidth);
      const overlapBefore = blockPairsOverlap();
      const vOverlapBeforePx = Math.max(0, ...overlapBefore.values());
      // Byte-exakt reset: ALLA noder (även textnoder) per berörd förälder.
      const resetParents = [...new Set([mainEl, ...parents])];
      const parentSnapshots = resetParents.map((p) => ({ p, nodes: Array.from(p.childNodes) }));

      // ── FAS 1: upplös allt mot orörd DOM ───────────────────────────────
      type Resolved =
        | { op: "move_up"; sec: Element }
        | { op: "set_text"; el: Element; set: string };
      const resolved: Resolved[] = [];
      let resolvedAll = true;
      for (const o of ops) {
        const el = findByLocator(o.tag, o.find);
        if (!el) { resolvedAll = false; break; }
        if (o.op === "move_up") {
          const sec = sectionOf(el);
          if (!sec) { resolvedAll = false; break; }
          resolved.push({ op: "move_up", sec });
        } else {
          if (!o.set) { resolvedAll = false; break; }
          resolved.push({ op: "set_text", el, set: o.set });
        }
      }

      // ── FAS 2: applicera i planordning ─────────────────────────────────
      let appliedMoves = 0;
      let appliedTexts = 0;
      const movedEls: Element[] = [];
      const textSnapshots: { el: Element; html: string }[] = [];
      if (resolvedAll) {
        for (const r of resolved) {
          if (r.op === "move_up") {
            const prev = r.sec.previousElementSibling;
            if (prev && r.sec.parentElement === prev.parentElement) {
              r.sec.parentElement!.insertBefore(r.sec, prev);
              if (!movedEls.includes(r.sec)) movedEls.push(r.sec);
              appliedMoves++;
            }
          } else {
            textSnapshots.push({ el: r.el, html: r.el.innerHTML });
            if (norm(r.el.textContent || "") !== norm(r.set)) r.el.textContent = r.set;
            appliedTexts++;
          }
        }
      }

      // ── EFTER-mätningar ────────────────────────────────────────────────
      const afterIdx = identityOrder();
      const hOverflowAfterPx = Math.max(0, de.scrollWidth - de.clientWidth);
      const overlapAfter = blockPairsOverlap();
      const vOverlapAfterPx = Math.max(0, ...overlapAfter.values());
      // Introducerat överlapp PER PAR (granskningens fynd: ett globalt
      // före-max får inte maskera ett nytt överlapp någon annanstans).
      let overlapIntroducedPx = 0;
      for (const [el, after] of overlapAfter) {
        const before = overlapBefore.get(el) ?? 0;
        overlapIntroducedPx = Math.max(overlapIntroducedPx, after - Math.max(0, before));
      }
      // Flyttad ovanför HJÄLTEN — i dokumentordning, fungerar även inne i
      // wrappers (geometri-ankaret kunde inte se in i lådor).
      let movedAboveMain = 0;
      if (heroBlock) {
        for (const el of movedEls) {
          if (el !== heroBlock && !(heroBlock.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            movedAboveMain++;
          }
        }
      }
      const ctaAfter = ctaProbes.map((p) => probeCta(p));
      let ctaChecked = 0;
      let ctaBroken = 0;
      for (let i = 0; i < ctaBefore.length; i++) {
        if (ctaBefore[i] === true) {
          ctaChecked++;
          if (ctaAfter[i] !== true) ctaBroken++;
        }
      }

      // ── reset (om inte EFTER-läget ska behållas för skärmdump) ─────────
      let reversedOrderMatches = true;
      if (!keepApplied) {
        for (const snap of parentSnapshots) for (const n of snap.nodes) snap.p.appendChild(n);
        for (const s of textSnapshots) s.el.innerHTML = s.html;
        for (const el of movedEls) el.removeAttribute("data-angel-moved");
        reversedOrderMatches = JSON.stringify(identityOrder()) === JSON.stringify(beforeIdx);
      }

      return {
        resolvedAll,
        beforeOrder: labelsOf(beforeIdx),
        afterOrder: labelsOf(afterIdx),
        orderChanged: JSON.stringify(afterIdx) !== JSON.stringify(beforeIdx),
        hOverflowBeforePx,
        hOverflowAfterPx,
        vOverlapBeforePx,
        vOverlapAfterPx,
        overlapIntroducedPx: Math.max(0, overlapIntroducedPx),
        movedCount: movedEls.length,
        movedAboveMain,
        mainAnchorFound: heroBlock !== null,
        ctaChecked,
        ctaBroken,
        requestedMoves: ops.filter((o) => o.op === "move_up").length,
        appliedMoves,
        requestedTexts: ops.filter((o) => o.op === "set_text").length,
        appliedTexts,
        reversedOrderMatches,
      };
    },
    { ops, ctaTexts, ctaSelectors, keepApplied },
  );
}

/** measurePlan-råvärden → render-gates-form (inkl. namnbytet
 *  overlapIntroducedPx → verticalOverlapIntroducedPx). En mappning, tre
 *  harness — fältlistan kan inte glida isär per skript. */
export function toRenderMeasurements(
  raw: Awaited<ReturnType<typeof measurePlan>>,
): RenderMeasurements {
  return {
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
    reversedOrderMatches: raw.reversedOrderMatches,
    verticalOverlapIntroducedPx: raw.overlapIntroducedPx,
  };
}

export interface GatedAttempt {
  attempt: number;
  measurements: RenderMeasurements;
  gate: ReturnType<typeof evaluateRenderGates>;
}

/** Den delade grind-loopen: mät → grinda → vid vertikal kollision EN retry
 *  med ett extra lyft per UNIKT flyttmål (prototyp-opens tag följer med).
 *  Fail-closed: oupplösbart mål ⇒ unresolvable, inga försök rapporteras som
 *  grindade. attemptOps är exakt de ops som det SISTA försöket körde — samma
 *  lista ska användas för keepApplied-återappliceringen (efter-skärmdumpen)
 *  och för serve_ops-räkningen. */
export async function runGatedAttempts(
  page: Page,
  ops: MeasureOp[],
  ctaTexts: string[],
  opts: { ctaSelectors?: string[]; onAttempt?: (a: GatedAttempt) => void } = {},
): Promise<{ attempts: GatedAttempt[]; attemptOps: MeasureOp[]; unresolvable: boolean; extraLiftApplied: boolean }> {
  const uniqueMoveFinds = [...new Set(ops.filter((o) => o.op === "move_up").map((o) => o.find))];
  const extraLiftOps: MeasureOp[] = uniqueMoveFinds.map((find) => {
    const proto = ops.find((o) => o.op === "move_up" && o.find === find)!;
    return { op: "move_up", tag: proto.tag, find };
  });
  const attempts: GatedAttempt[] = [];
  let attemptOps = ops;
  let extraLiftApplied = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await measurePlan(page, attemptOps, ctaTexts, false, opts.ctaSelectors ?? []);
    if (!raw.resolvedAll) {
      return { attempts, attemptOps, unresolvable: true, extraLiftApplied };
    }
    const measurements = toRenderMeasurements(raw);
    const gate = evaluateRenderGates(measurements);
    const entry = { attempt, measurements, gate };
    attempts.push(entry);
    opts.onAttempt?.(entry);
    const collision = gate.verdict === "fail" && gate.reasons.some((r) => /vertical overlap/.test(r));
    if (collision && attempt === 1 && extraLiftOps.length > 0) {
      attemptOps = [...ops, ...extraLiftOps];
      extraLiftApplied = true;
      continue;
    }
    break;
  }
  return { attempts, attemptOps, unresolvable: false, extraLiftApplied };
}
