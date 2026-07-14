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

import { chromium } from "playwright-core";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractContentModel } from "../../src/adaptive/redesign/extract";
import { buildRedesignContext, segmentInsightFrom } from "../../src/adaptive/redesign/context";
import { generateRedesign } from "../../src/adaptive/redesign/generate";
import { measurePlan, runGatedAttempts, type GatedAttempt, type MeasureOp } from "../redesign/measure";
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

// Extraherade konverterings-CTA:er ∪ ägarens måltext — samma union som
// auto-generate, så hit-testet alltid vaktar målets element.
const ctaTexts = [
  ...new Set([
    ...content.ctas.filter((c) => c.intent === "conversion").map((c) => c.text),
    ...(ctx.goal.text ? [ctx.goal.text] : []),
  ]),
];

console.log("=== slice 3b — pixel half on plausible.io (offline render) ===");
console.log(`  plan: move_up ${moveUpHeadings.length} section(s) — ${moveUpHeadings.join("; ")}`);
console.log(`  CTAs hit-tested: ${ctaTexts.join(", ") || "(none)"}`);

// ── in-browser apply + measure ───────────────────────────────────────────────
// SAMMA delade tvåfas-mätning som verifieringspipelinen (scripts/redesign/
// measure.ts) — den här filen bar tidigare en egen kopia med v2-klättringen
// (rubrik → förälder under <main>), en egen hit-test och en TREDJE
// appliceringsalgoritm för efter-skärmdumpen. Återanvändnings-genomgången
// 2026-07-14 ersatte alltihop med measurePlan.
const baseOps: MeasureOp[] = moveUpHeadings.map((h) => ({ op: "move_up", find: h }));

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

  // Generate → verify → RETRY — den DELADE grind-loopen (runGatedAttempts):
  // kollision → en retry med ETT extra lyft per UNIKT flyttmål, samma räkning
  // som verifieringspipelinen. En plan utan ren placering hålls tillbaka.
  const logAttempt = ({ attempt, measurements, gate }: GatedAttempt) => {
    console.log(`\n  ── attempt ${attempt} ${"─".repeat(50)}`);
    console.log("  FÖRE:  " + measurements.beforeOrder.join(" → "));
    console.log("  EFTER: " + measurements.afterOrder.join(" → "));
    console.log(`  moved: ${measurements.appliedMoves}/${measurements.requestedMoves} · movedAboveMain: ${measurements.movedAboveMain}`);
    console.log(`  hOverflow introduced: ${gate.hOverflowIntroducedPx}px · vertical overlap introduced: ${gate.verticalOverlapIntroducedPx}px`);
    console.log(`  CTAs clickable before/broken after: ${measurements.ctaChecked}/${measurements.ctaBroken} · reversible: ${measurements.reversedOrderMatches}`);
    console.log(`  VERDICT: ${gate.verdict.toUpperCase()}`);
    for (const r of gate.reasons) console.log(`    · ${r}`);
    if (!gate.reasons.length) console.log("    ✓ beauty gates passed (no overflow, hero kept, CTAs intact, reversible)");
  };
  const { attempts, attemptOps, unresolvable } = await runGatedAttempts(page, baseOps, ctaTexts, {
    onAttempt: logAttempt,
  });
  if (unresolvable) {
    console.log("\n  FINAL: NOT APPLICABLE — v3-upplösningen vägrade (ingen ren sektionsnivå); fail closed");
    writeFileSync(join(outDir, "report.json"), JSON.stringify({ attempts, unresolvable: true }, null, 2));
  } else {
    // EFTER-skärmdumpen: SAMMA mätfunktion med keepApplied — aldrig en egen
    // återappliceringsalgoritm (granskningsfynd 2026-07-14).
    await measurePlan(page, attemptOps, [], true);
    await page.screenshot({ path: join(outDir, "after.jpg"), type: "jpeg", quality: 60, fullPage: true });

    writeFileSync(join(outDir, "report.json"), JSON.stringify({ attempts }, null, 2));

    const last = attempts[attempts.length - 1];
    console.log(
      `\n  FINAL: ${last.gate.verdict.toUpperCase()} after ${attempts.length} attempt(s) — ` +
        (last.gate.verdict === "pass"
          ? "candidate for serving (behind the ramp)"
          : "held back; no visitor sees it"),
    );
    console.log(`  evidence: ${outDir}/before.jpg · after.jpg · report.json`);
  }
} finally {
  await browser.close();
}
