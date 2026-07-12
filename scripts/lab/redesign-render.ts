#!/usr/bin/env bun
// Fas 3 (slice 3b) — the PIXEL half of "blir det snyggt", on a real page.
//
// Slice 3a answered "does the new ORDER make sense?" without a browser. This
// renders the real page, APPLIES the validated plan to the live DOM (reordering
// the actual section blocks), and measures the beauty gates that a browser can
// see but pure code cannot: did apply introduce horizontal scroll? did a moved
// block cross above the page's main content? did a conversion CTA become
// unclickable? does it fully reverse? Then it screenshots FÖRE / EFTER and runs
// the pure gate (render-gates.ts) for the verdict.
//
// It renders plausible.io fully OFFLINE from the committed fixture (HTML + its two
// stylesheets, inlined) — no network, deterministic, reproducible. Real customer
// pages arrive self-contained from the freeze step (freeze.server.ts → MHTML);
// this lab inlines by hand because the fixture keeps the assets as separate files.
//
//   bun run scripts/lab/redesign-render.ts   [--out=redesign-render-out]

import { chromium, type Page } from "playwright-core";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { generateRedesign } from "../../src/adaptive/redesign/generate";
import { evaluateRenderGates, type RenderMeasurements } from "../../src/adaptive/redesign/render-gates";
import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";

const REPO = join(import.meta.dir, "../..");
const FIX = join(REPO, "fixtures/real-sites");
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const outDir = join(REPO, arg("out") ?? "redesign-render-out");

// ── build the self-contained page (inline the two real stylesheets) ──────────
function selfContainedHtml(): string {
  let html = readFileSync(join(FIX, "plausible-io.html"), "utf8");
  const style = readFileSync(join(FIX, "plausible-io.style.css"), "utf8");
  const tooltip = readFileSync(join(FIX, "plausible-io.tooltip.css"), "utf8");
  html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "");
  return html.replace(/<\/head>/i, `<style>${style}\n${tooltip}</style></head>`);
}

// ── the redesign plan (same chain as redesign-real-site.ts) ──────────────────
const html = selfContainedHtml();
const content = extractContentModel(html);
const summary: SegmentSummary = {
  key: "instagram·mobile·SE",
  label: "instagram · mobile · SE",
  depth: 3,
  channel: "instagram",
  device: "mobile",
  country: "SE",
  returning: null,
  visits: 1680,
  conversions: 104,
  conversionRate: 0.062,
  formStarts: 0,
  formAbandons: 0,
  adequate: true,
  recent: { visits: 900, conversions: 80, conversionRate: 0.089, adequate: false },
};
const ctx = buildRedesignContext({
  site: "plausible",
  goal: { text: "Start free trial", kind: "trial", selector: null },
  page: {
    url: "https://plausible.io/",
    frozenHtmlPath: "fixtures/real-sites/plausible-io.html",
    screenshotPath: "fixtures/real-sites/plausible-io.jpg",
    viewport: { width: 390, height: 844 },
  },
  content,
  segment: segmentInsightFrom(summary, {
    observations: [
      "The page's real social proof (“People ❤️ Plausible”) sits BELOW the generic features.",
    ],
  }),
});
const testimonialsId = content.sections.find((s) => s.type === "testimonials")?.id ?? "";
const designModelReply = async () =>
  JSON.stringify([
    {
      op: "move_up",
      targetId: testimonialsId,
      detail: "Lift social proof above the features section.",
      why: "instagram·mobile·SE arrives warm but cautious; peer proof currently sits below features.",
    },
  ]);
const plan = await generateRedesign(ctx, designModelReply);

// Map each move_up op's targetId → the section's heading text (the DOM locator).
const moveUpHeadings = plan.ops
  .filter((o) => o.op === "move_up")
  .map((o) => content.sections.find((s) => s.id === o.targetId)?.heading)
  .filter((h): h is string => !!h);

const ctaTexts = content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text);

console.log("=== slice 3b — pixel half on plausible.io (offline render) ===");
console.log(`  plan: move_up ${moveUpHeadings.length} section(s) — ${moveUpHeadings.join("; ")}`);
console.log(`  CTAs hit-tested: ${ctaTexts.join(", ") || "(none)"}`);

// ── in-browser apply + measure ───────────────────────────────────────────────
// Locate a section container: walk up from the heading until the parent is <main>
// (or body). On plausible the content sections are direct <main> children, so a
// move_up is a clean, reversible sibling swap. Anything not a clean sibling is
// reported as "not safely applicable" (never force-moved).
async function measureAndApply(page: Page) {
  return page.evaluate(
    ({ moveHeadings, ctaTexts }) => {
      const mainEl = document.querySelector("main") || document.body;
      const anchor = document.querySelector("h1") || document.querySelector("main");
      const anchorTop = anchor ? anchor.getBoundingClientRect().top + window.scrollY : null;

      function container(el: Element): Element {
        let node: Element = el;
        while (node.parentElement && node.parentElement !== mainEl && node.parentElement !== document.body) {
          node = node.parentElement;
        }
        return node;
      }
      const heads = Array.from(document.querySelectorAll("h1,h2"));
      const de = document.documentElement;

      // Track every content section container we can name, for order reporting.
      const tracked: { label: string; el: Element }[] = [];
      for (const h of heads) {
        const txt = (h.textContent || "").replace(/\s+/g, " ").trim();
        if (!txt) continue;
        const c = container(h);
        if (c.parentElement === mainEl && !tracked.some((t) => t.el === c)) {
          tracked.push({ label: txt.slice(0, 40), el: c });
        }
      }
      const orderOf = () =>
        Array.from(mainEl.children)
          .map((c) => tracked.find((t) => t.el === c)?.label)
          .filter((l): l is string => !!l);

      // CTA hit-test: pick the first VISIBLE instance of the CTA text, scroll it
      // into the viewport, and check the CTA (or a descendant) is the topmost
      // element at its centre. Below-the-fold CTAs are scrolled in first, else the
      // test would vacuously read "not clickable" for every off-screen button.
      function ctaClickable(text: string): boolean | null {
        const matches = Array.from(document.querySelectorAll("a,button")).filter((n) =>
          (n.textContent || "").replace(/\s+/g, " ").trim().includes(text),
        );
        if (!matches.length) return null;
        const el = matches.find((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (!el) return false; // all instances hidden (0×0)
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1);
        const top = document.elementFromPoint(cx, cy);
        return !!top && (el.contains(top) || top.contains(el));
      }
      const ctaBefore = ctaTexts.map((t) => ({ t, ok: ctaClickable(t) }));

      // Max vertical overlap between adjacent main sections (prev.bottom − next.top).
      // Sections legitimately overlap by design; we compare before vs after so only
      // the INTRODUCED overlap counts (a moved block landing under a floating CTA).
      const maxAdjacentOverlap = () => {
        const kids = Array.from(mainEl.children).filter(
          (c) => c.getBoundingClientRect().height > 30,
        );
        let mx = 0;
        for (let i = 0; i < kids.length - 1; i++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[i + 1].getBoundingClientRect();
          mx = Math.max(mx, Math.round(a.bottom - b.top));
        }
        return mx;
      };

      const beforeOrder = orderOf();
      const hOverflowBeforePx = Math.max(0, de.scrollWidth - de.clientWidth);
      const vOverlapBeforePx = maxAdjacentOverlap();

      // Snapshot original order of ALL main children for exact reset.
      const originalChildren = Array.from(mainEl.children);

      // Apply move_ups: swap the target container with its previous element sibling.
      let applied = 0;
      const movedEls: Element[] = [];
      for (const heading of moveHeadings) {
        const t = tracked.find((x) => x.label && heading.replace(/\s+/g, " ").trim().startsWith(x.label));
        const target = t?.el ?? tracked.find((x) => heading.includes(x.label))?.el;
        if (!target) continue;
        const prev = target.previousElementSibling;
        if (prev && target.parentElement === prev.parentElement) {
          target.parentElement!.insertBefore(target, prev);
          target.setAttribute("data-angel-moved", "1");
          movedEls.push(target);
          applied++;
        }
      }

      const afterOrder = orderOf();
      const hOverflowAfterPx = Math.max(0, de.scrollWidth - de.clientWidth);
      const vOverlapAfterPx = maxAdjacentOverlap();
      // Moved-above-main: any moved container whose top is now above the anchor.
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

      // Reset: restore the original child order exactly, drop markers.
      for (const el of originalChildren) mainEl.appendChild(el);
      for (const el of movedEls) el.removeAttribute("data-angel-moved");
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
      };
    },
    { moveHeadings: moveUpHeadings, ctaTexts },
  );
}

// ── drive the browser ─────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: EXEC });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", (r) => r.abort()); // fully offline
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page.waitForTimeout(400);

  await page.screenshot({ path: join(outDir, "before.jpg"), type: "jpeg", quality: 60, fullPage: true });
  const raw = await measureAndApply(page);
  // The screenshot must capture the APPLIED state; re-apply for the shot, then reset.
  await page.evaluate((moveHeadings) => {
    const mainEl = document.querySelector("main") || document.body;
    const heads = Array.from(document.querySelectorAll("h1,h2"));
    function container(el: Element): Element {
      let node: Element = el;
      while (node.parentElement && node.parentElement !== mainEl && node.parentElement !== document.body) node = node.parentElement;
      return node;
    }
    for (const heading of moveHeadings) {
      const h = heads.find((x) => heading.includes((x.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)));
      if (!h) continue;
      const target = container(h);
      const prev = target.previousElementSibling;
      if (prev && target.parentElement === prev.parentElement) target.parentElement!.insertBefore(target, prev);
    }
  }, moveUpHeadings);
  await page.screenshot({ path: join(outDir, "after.jpg"), type: "jpeg", quality: 60, fullPage: true });

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

  writeFileSync(join(outDir, "report.json"), JSON.stringify({ measurements, gate }, null, 2));

  console.log("\n  FÖRE:  " + measurements.beforeOrder.join(" → "));
  console.log("  EFTER: " + measurements.afterOrder.join(" → "));
  console.log(`  moved: ${measurements.appliedMoves}/${measurements.requestedMoves} · movedAboveMain: ${measurements.movedAboveMain}`);
  console.log(`  hOverflow introduced: ${gate.hOverflowIntroducedPx}px (before ${measurements.hOverflowBeforePx} → after ${measurements.hOverflowAfterPx})`);
  console.log(`  vertical overlap introduced: ${gate.verticalOverlapIntroducedPx}px (collision gate)`);
  console.log(`  CTAs clickable before/broken after: ${measurements.ctaChecked}/${measurements.ctaBroken}`);
  console.log(`  reversible (order restored): ${measurements.reversedOrderMatches}`);
  console.log(`\n  VERDICT: ${gate.verdict.toUpperCase()}`);
  for (const r of gate.reasons) console.log(`    · ${r}`);
  if (!gate.reasons.length) console.log("    ✓ beauty gates passed (no overflow, hero kept, CTAs intact, reversible)");
  console.log(`\n  evidence: ${outDir}/before.jpg · after.jpg · report.json`);
} finally {
  await browser.close();
}
