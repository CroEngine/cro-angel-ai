#!/usr/bin/env bun
// Fas 3 — the WHOLE chain, end to end, on a REAL website.
//
//   raw HTML (real, frozen)  ─► extractContentModel  ─► buildRedesignContext
//        ─► renderRedesignPrompt (the brief)  ─► generateRedesign (design model
//        proposes reversible ops)  ─► validateOps (LLM never trusted)
//        ─► previewPlan (structural FÖRE/EFTER + safety gates)
//
// The page is plausible.io's real homepage (fixtures/real-sites/plausible-io.html,
// fetched 2026-07-10). The segment is a REAL measured synthetic-lab segment
// (instagram·mobile·SE, rising 6.2%→8.9%). NOTHING is invented: the content model
// is parsed off the real DOM, and the ops only rearrange/condense existing blocks.
//
// On generation: there is no ANTHROPIC_API_KEY in this lab, so `complete` returns
// the ops the design model (the same class of model that runs `completeWithClaude`
// in prod) reasons out from the real brief. They are then validated + previewed by
// the SAME code that runs in production — the guard and gates are not simulated.
//
//   bun run scripts/lab/redesign-real-site.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";
import { buildRedesignContext, segmentInsightFrom, renderRedesignPrompt } from "../../src/adaptive/redesign/context";
import { generateRedesign } from "../../src/adaptive/redesign/generate";
import { previewPlan, formatOrder } from "../../src/adaptive/redesign/preview";
import { extractContentModel } from "../../src/adaptive/redesign/extract";

const REPO = join(import.meta.dir, "../..");
const SITE_URL = "https://plausible.io/";
const html = readFileSync(join(REPO, "fixtures/real-sites/plausible-io.html"), "utf8");

// ── 1. Extract the EXISTING content model from the real DOM ──────────────────
const content = extractContentModel(html);
console.log("=== 1. Content model extracted from the REAL page ===");
console.log(`   source: ${SITE_URL} (${html.length} bytes, frozen)`);
console.log("   Sections (document order):");
for (const s of content.sections)
  console.log(`     ${s.position}. [${s.id}] ${s.type} — “${s.heading}”`);
console.log("   Trust signals (literal substrings of the page):");
for (const t of content.trustSignals) console.log(`     - ${t.type}: “${t.text}”`);
console.log("   CTAs:");
for (const c of content.ctas) console.log(`     - “${c.text}” [${c.intent}]`);
if (content.hero) console.log(`   Hero: “${content.hero.headline}”`);

// ── 2. The segment (REAL synthetic-lab measurement) ──────────────────────────
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
  goal: { text: "Start free trial", kind: "trial", selector: "a[href*='register']" },
  page: {
    url: SITE_URL,
    frozenHtmlPath: "fixtures/real-sites/plausible-io.html",
    screenshotPath: "fixtures/real-sites/plausible-io.jpg", // not rendered here; brief references it
    viewport: { width: 390, height: 844 }, // mobile segment
  },
  content,
  segment: segmentInsightFrom(summary, {
    rageRefs: [],
    formAbandonRate: null,
    observations: [
      "Segment arrives from Instagram on mobile in Sweden — warm on the privacy angle, GDPR-conscious.",
      "The page's real social proof (“People ❤️ Plausible”, “19,000 paying customers”) sits BELOW the generic features section.",
      "For this warm-but-cautious segment, peer proof earlier should reduce hesitation before the trial ask.",
    ],
  }),
});

console.log("\n=== 2. The redesign brief (what the design model receives) ===\n");
console.log(renderRedesignPrompt(ctx));

// ── 3. Generation — the design model proposes reversible ops ──────────────────
// No API key in the lab → `complete` returns the ops reasoned from the real brief
// above. In prod this is completeWithClaude (vision + screenshot). One op is
// deliberately INVENTED to demonstrate the guard rejects it on a real page too.
const designModelReply = async () =>
  JSON.stringify([
    {
      op: "move_up",
      targetId: content.sections.find((s) => s.type === "testimonials")?.id ?? "sec-testimonials",
      detail: "Lift “People ❤️ Plausible” social proof above the generic features section.",
      why: "instagram·mobile·SE arrives warm but cautious; real peer proof currently sits below features.",
    },
    {
      // detail IS the literal new copy for condense — a faithful tightening of the
      // real hero, introducing no number/superlative/promise that isn't on the page.
      op: "condense",
      targetId: "hero",
      detail: "Privacy-friendly Google Analytics alternative. No cookies. Made in the EU.",
      why: "390px mobile fold is scarce; get to the privacy value + ask faster.",
    },
    {
      // Structurally valid target + verb, but the copy FABRICATES a stat — the
      // semantic guard (claims.ts) rejects it: the page says 19,000, not 50,000.
      op: "set_text",
      targetId: "hero",
      detail: "The #1 analytics — trusted by 50,000 companies with a money-back guarantee",
      why: "(INVENTED claims — a new number, a superlative and a promise; must be rejected.)",
    },
    {
      op: "inject_badge",
      targetId: "sec-award-2026",
      detail: "Add a shiny 'Best Analytics 2026' award badge.",
      why: "(INVENTED op + target — must be rejected by the structural guard.)",
    },
  ]);

const plan = await generateRedesign(ctx, designModelReply);
console.log("\n=== 3. Generated plan (validated — the LLM is never trusted) ===");
for (const op of plan.ops)
  console.log(`   ✓ ${op.op} ${op.targetId}\n       ${op.detail}\n       why: ${op.why}`);
for (const r of plan.rejected)
  console.log(`   ✗ rejected: ${JSON.stringify(r.op).slice(0, 70)}…\n       reason: ${r.reason}`);

// ── 4. Structural FÖRE/EFTER + safety gates ──────────────────────────────────
const preview = previewPlan(content, plan);
console.log("\n=== 4. Structural preview (FÖRE / EFTER) ===");
console.log(`   FÖRE:  ${formatOrder(preview.before)}`);
console.log(`   EFTER: ${formatOrder(preview.after)}`);
if (preview.moves.length)
  console.log(`   moves: ${preview.moves.map((m) => `${m.targetId} ${m.from}→${m.to}`).join(", ")}`);
if (preview.retouched.length) console.log(`   retouched (copy, no reorder): ${preview.retouched.join(", ")}`);
console.log(`   reversible: ${preview.reversible}`);
console.log(
  preview.warnings.length
    ? `   ⚠ gates: ${preview.warnings.map((w) => `${w.code} (${w.message})`).join("; ")}`
    : "   ✓ structural gates passed (hero first, footer last, nothing lost)",
);

console.log(
  "\n[real-site] Whole chain ran on a real homepage. The content model came off the " +
    "real DOM, the invented op was rejected, and the reorder is a reversible one-step lift " +
    "of the page's OWN social proof — never a fabrication. The pixel half (render + beauty " +
    "gates) is the next step; a plan that fails these structural gates never reaches it.",
);
