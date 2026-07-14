#!/usr/bin/env bun
// Bredd-test: håller frysning → extraktion → pixelgrindar på OLIKA riktiga
// sajter? Kör kedjans mekaniska del (inga LLM-designer) mot en lista frysta
// sidor — korpusens MHTML-frysningar (browser-vägen) och färska curl-frysningar
// (freeze-page.ts) — och rapporterar per sajt:
//
//   * laddar kopian i Chromium?
//   * hittar extraktionen sidans sektioner/CTA:er?
//   * klarar en mekanisk omflyttning (lyft en under-folden-sektion ×2) alla
//     pixelgrindar — inkl. kollisions-retryn — och är den byte-exakt reversibel?
//
// Detta testar MASKINERIET, inte designsmak: en sajt som faller här skulle
// falla för varje riktig design. Fel per sajt fångas och rapporteras — ett
// haveri stoppar inte resten.
//
//   bun run scripts/redesign/breadth-test.ts --targets=targets.json --out=out
//   targets.json: [{ "name": "hubspot", "type": "mhtml"|"html", "path": "..." }]

import { chromium, type Page } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import {
  evaluateRenderGates,
  type RenderMeasurements,
} from "../../src/adaptive/redesign/render-gates";

const EXEC =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const targets = JSON.parse(readFileSync(arg("targets")!, "utf8")) as {
  name: string;
  type: "mhtml" | "html";
  path: string;
}[];
const outDir = arg("out") ?? "breadth-test-out";
mkdirSync(outDir, { recursive: true });

/** Flytt-bara mätningen — samma logik som auto-generate/slice 3b. */
async function measureMoves(page: Page, moveHeadings: string[], ctaTexts: string[]) {
  return page.evaluate(
    ({ moveHeadings, ctaTexts }) => {
      const mainEl = document.querySelector("main") || document.body;
      const anchor = document.querySelector("h1") || document.querySelector("main");
      const anchorTop = anchor ? anchor.getBoundingClientRect().top + window.scrollY : null;
      const de = document.documentElement;
      // v2 (wrapper-medveten) — samma upplösning som snippet + auto-generate.
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
        let n: Element = el;
        while (n.parentElement && n.parentElement !== document.body) {
          // Aldrig rubriken själv (platta artikelsidor) — samma spärr som snippeten.
          if (n !== el && siblingHasHeading(n)) return n;
          n = n.parentElement;
        }
        return n;
      }
      const tracked: { label: string; el: Element }[] = [];
      for (const h of heads) {
        const txt = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        const c = container(h);
        if (!tracked.some((t) => t.el === c)) tracked.push({ label: txt.slice(0, 40), el: c });
      }
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
      const parentSnapshots = overlapParents.map((p) => ({ p, kids: Array.from(p.children) }));
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
      for (const snap of parentSnapshots) for (const el of snap.kids) snap.p.appendChild(el);
      const resetOrder = orderOf();
      return {
        beforeOrder, afterOrder, resetOrder,
        hOverflowBeforePx, hOverflowAfterPx, vOverlapBeforePx, vOverlapAfterPx,
        movedCount: movedEls.length, movedAboveMain, mainAnchorFound: anchorTop !== null,
        ctaChecked, ctaBroken, requestedMoves: moveHeadings.length, appliedMoves: applied,
      };
    },
    { moveHeadings, ctaTexts },
  );
}

const browser = await chromium.launch({ headless: true, executablePath: EXEC });
const report: Record<string, unknown>[] = [];

for (const t of targets) {
  const row: Record<string, unknown> = { name: t.name, type: t.type };
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    if (t.type === "mhtml") {
      // file:// är Chromiums enda MHTML-transport (samma väg som snapshot-harnesset).
      const tmp = join(mkdtempSync(join(tmpdir(), "breadth-")), "page.mhtml");
      copyFileSync(t.path, tmp);
      await page.goto(`file://${tmp}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      await page.setContent(readFileSync(t.path, "utf8"), { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForTimeout(600);

    // Extraktion mot den RENDERADE dom:en (mhtml kan skilja sig från rå html).
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const content = extractContentModel(html);
    row.sections = content.sections.map((s) => `${s.type}:${s.heading.slice(0, 30)}`);
    row.ctas = content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text.slice(0, 25));
    row.trust = content.trustSignals.length;

    if (content.sections.length < 2) {
      row.verdict = "too_few_sections";
      report.push(row);
      await context.close();
      continue;
    }
    // Mekanisk plan: lyft den mest bevis-artade under-folden-sektionen ×2,
    // annars sista sektionen — testar lokatorer + grindar, inte designsmak.
    const prefer = ["testimonials", "comparison", "pricing", "faq"];
    const candidates = content.sections.slice(2);
    const target =
      prefer.map((p) => candidates.find((s) => s.type === p)).find(Boolean) ??
      candidates[candidates.length - 1] ??
      content.sections[content.sections.length - 1];
    row.movePlan = `${target.type}: ${target.heading.slice(0, 40)} ×2`;
    const ctaTexts = content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text);

    let moveHeadings = [target.heading, target.heading];
    let last: { measurements: RenderMeasurements; gate: ReturnType<typeof evaluateRenderGates> } | null = null;
    let attempts = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt;
      const raw = await measureMoves(page, moveHeadings, ctaTexts);
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
      last = { measurements, gate };
      const collision = gate.verdict === "fail" && gate.reasons.some((r) => /vertical overlap/.test(r));
      if (collision && attempt === 1) {
        moveHeadings = [...moveHeadings, ...new Set(moveHeadings)];
        continue;
      }
      break;
    }
    row.verdict = last!.gate.verdict;
    row.attempts = attempts;
    row.gates = {
      overlapIntroducedPx: last!.gate.verticalOverlapIntroducedPx,
      hOverflowIntroducedPx: last!.gate.hOverflowIntroducedPx,
      movedAboveMain: last!.measurements.movedAboveMain,
      ctaChecked: last!.measurements.ctaChecked,
      ctaBroken: last!.measurements.ctaBroken,
      appliedMoves: `${last!.measurements.appliedMoves}/${last!.measurements.requestedMoves}`,
      reversible: last!.measurements.reversedOrderMatches,
    };
    row.reasons = last!.gate.reasons;
    await page.screenshot({ path: join(outDir, `${t.name}-before.jpg`), type: "jpeg", quality: 50 });
    await context.close();
  } catch (err) {
    row.verdict = "error";
    row.error = String(err).slice(0, 300);
  }
  report.push(row);
  console.log(
    `  ${t.name}: ${row.verdict}${row.movePlan ? ` · plan: ${row.movePlan}` : ""}${row.error ? ` · ${row.error}` : ""}`,
  );
}

await browser.close();
writeFileSync(join(outDir, "breadth-report.json"), JSON.stringify(report, null, 2));
console.log(`\nreport: ${outDir}/breadth-report.json`);
