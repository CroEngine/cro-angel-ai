#!/usr/bin/env bun
// Fas 3 demo — assemble and PRINT the redesign brief the design LLM would get.
//
// Pairs a real frozen corpus page (code + screenshot, on disk) with a real
// synthetic-lab segment insight (the rising instagram·mobile·SE + its rage
// signal), runs the pure assembler, and prints the exact prompt. Nothing here
// invents page content — the content model is the page's EXISTING blocks, and
// the guardrails force "rearrange / retext / reveal only".
//
//   bun run scripts/lab/redesign-context-demo.ts

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SegmentSummary } from "../../src/lib/dashboard/aggregate";
import {
  buildRedesignContext,
  segmentInsightFrom,
  renderRedesignPrompt,
  type RedesignContentModel,
} from "../../src/adaptive/redesign/context";

const REPO = join(import.meta.dir, "../..");
const PAGE_DIR = "fixtures/breadth-corpus/stripe";
const meta = JSON.parse(readFileSync(join(REPO, PAGE_DIR, "meta.json"), "utf8"));

// The page's EXISTING content, in placement order (would come from the harvest
// audit for a real customer page). Here: a landing page whose social proof sits
// BELOW the fold — the classic "move it up" case.
const content: RedesignContentModel = {
  sections: [
    {
      id: "sec-hero",
      type: "hero",
      position: 1,
      heading: "Financial infrastructure for the internet",
      aboveFold: true,
      visualWeight: 85,
    },
    {
      id: "sec-logos",
      type: "logos",
      position: 2,
      heading: "",
      aboveFold: false,
      visualWeight: 30,
    },
    {
      id: "sec-features",
      type: "features",
      position: 3,
      heading: "A fully integrated suite",
      aboveFold: false,
      visualWeight: 55,
    },
    {
      id: "sec-pricing",
      type: "pricing",
      position: 4,
      heading: "Pricing",
      aboveFold: false,
      visualWeight: 60,
    },
    {
      id: "sec-testi",
      type: "testimonials",
      position: 5,
      heading: "Trusted by millions",
      aboveFold: false,
      visualWeight: 45,
    },
    {
      id: "sec-faq",
      type: "faq",
      position: 6,
      heading: "Questions",
      aboveFold: false,
      visualWeight: 25,
    },
    {
      id: "sec-footer",
      type: "footer",
      position: 7,
      heading: "",
      aboveFold: false,
      visualWeight: 20,
    },
  ],
  trustSignals: [
    {
      type: "social_proof_count",
      text: "Millions of companies of all sizes",
      aboveFold: false,
      section: "testimonials",
    },
    {
      type: "customer_logos",
      text: "Amazon, Google, Shopify, Zoom",
      aboveFold: false,
      section: "logos",
    },
  ],
  ctas: [
    { text: "Start now", intent: "conversion", aboveFold: true },
    { text: "Contact sales", intent: "contact", aboveFold: true },
  ],
  hero: {
    headline: "Financial infrastructure for the internet",
    subheadline: "Millions of businesses use Stripe",
  },
};

// A REAL synthetic-lab segment (measured: instagram·mobile·SE 6.2%→8.9%, rising,
// rage on the buy button). Represented as a SegmentSummary → the same shape the
// dashboard produces, so the assembler path is identical to production.
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
  site: "stripe",
  goal: { text: "Start now", kind: "subscribe", selector: "#start" },
  page: {
    url: meta.url,
    frozenHtmlPath: join(PAGE_DIR, "page.mhtml"),
    screenshotPath: join(PAGE_DIR, "screenshot.jpg"),
    viewport: meta.viewport,
  },
  content,
  segment: segmentInsightFrom(summary, {
    rageRefs: [{ ref: "button#kop", bursts: 37 }],
    formAbandonRate: 0.19,
    observations: [
      "Social proof (logos + “millions of companies”) sits BELOW the fold for this mobile segment.",
      "Instagram traffic arrives warm on social proof — it is currently the last thing they see.",
    ],
  }),
});

console.log(renderRedesignPrompt(ctx));
console.log(
  "\n---\n[demo] page code + screenshot referenced above are the real frozen artifacts on disk.",
);
