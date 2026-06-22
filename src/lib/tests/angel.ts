// The Angel — advisory CRO narrative over the lean projection.
//
// ┌─ DETERMINISM BOUNDARY ─────────────────────────────────────────────────┐
// │ The Angel is the ONE non-deterministic layer in this codebase, and it   │
// │ lives strictly OUTSIDE the golden. It consumes `golden.croProjection`   │
// │ (deterministic) and produces plain-language recommendations via an LLM. │
// │                                                                          │
// │ It is NEVER written into golden.json and NEVER called from the snapshot │
// │ pipeline, so "same MHTML + same extractor → byte-identical golden" is   │
// │ untouched. The deterministic substrate (collect → croScore →            │
// │ croProjection) is the regression-locked ground truth; the Angel only    │
// │ translates that ground truth into prioritized advice for a human.       │
// └──────────────────────────────────────────────────────────────────────┘
//
// This file is PURE: schema + prompt construction, no SDK, no IO, no network.
// `buildAngelUserPrompt` is deterministic (same projection → same string), so
// the prompt itself is unit-testable. The live Claude call lives in
// angel.server.ts. Nothing in the golden pipeline imports this module.

import { z } from "zod";

import type { CroProjection } from "./croProjection";

// Model + request shape live here so the pure layer is the single source of
// truth for what the Angel asks of Claude. Opus 4.8 with adaptive thinking —
// a CRO read benefits from real reasoning over the signals.
export const ANGEL_MODEL = "claude-opus-4-8" as const;
export const ANGEL_MAX_TOKENS = 16000 as const;
export const ANGEL_EFFORT = "high" as const;

// --- Output schema (Zod — validates the response) ----------------------------
// Kept constraint-light (descriptions, not min/max) so structured-output strict
// mode accepts it cleanly. Every field is required; `evidence` may be empty.
// The matching wire JSON Schema is hand-written below (Zod-3 / SDK-version safe).

export const AngelRecommendationSchema = z
  .object({
    title: z
      .string()
      .describe(
        "Short imperative headline for the fix, e.g. 'Make the primary CTA the most prominent element above the fold'.",
      ),
    priority: z
      .enum(["critical", "high", "medium", "low"])
      .describe(
        "Urgency, derived from the underlying finding severity and how much its dimension weighs.",
      ),
    dimension: z
      .string()
      .describe(
        "Which CRO dimension this addresses — use one of the projection's dimension labels (e.g. 'CTA focus', 'Visual hierarchy', 'Value proposition', 'Trust', 'Friction', 'Quality').",
      ),
    problem: z
      .string()
      .describe(
        "What is wrong and WHY it suppresses conversion — the mechanism, in plain language a marketer understands.",
      ),
    recommendation: z
      .string()
      .describe("The concrete change to make. Specific and actionable, not generic advice."),
    expectedImpact: z
      .string()
      .describe(
        "Plain-language expected effect on conversion if the fix ships (direction + rough magnitude, hedged honestly).",
      ),
    evidence: z
      .array(z.string())
      .describe(
        "The specific signals from the projection this rests on (e.g. 'competingAboveFold=3', 'primaryCtaWinsSalience=false', the headline text). Never cite a signal not present in the input.",
      ),
  })
  .describe("One prioritized, evidence-grounded CRO recommendation.");

export const AngelReportSchema = z
  .object({
    headline: z.string().describe("One-line overall verdict on the page's conversion readiness."),
    summary: z
      .string()
      .describe(
        "2–4 sentence executive summary: what the page does well and the single biggest opportunity.",
      ),
    recommendations: z
      .array(AngelRecommendationSchema)
      .describe(
        "Prioritized recommendations, most impactful first. Lead with the projection's ranked priorities; do not pad with filler.",
      ),
  })
  .describe("The Angel's advisory CRO report for one page.");

export type AngelRecommendation = z.infer<typeof AngelRecommendationSchema>;
export type AngelReport = z.infer<typeof AngelReportSchema>;

// --- Structured-output JSON Schema (the wire format) -------------------------
// The Anthropic SDK's zodOutputFormat helper targets Zod 4; this project is on
// Zod 3 (it backs the app's forms), so we hand-write the strict JSON Schema the
// structured-output API wants — `additionalProperties:false`, every property
// required. The Zod schemas above remain the single validator for the RESPONSE;
// a drift-guard test asserts these two representations never diverge.
export const RECOMMENDATION_PROPS = [
  "title",
  "priority",
  "dimension",
  "problem",
  "recommendation",
  "expectedImpact",
  "evidence",
] as const;
export const REPORT_PROPS = ["headline", "summary", "recommendations"] as const;

const RECOMMENDATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...RECOMMENDATION_PROPS],
  properties: {
    title: { type: "string", description: "Short imperative headline for the fix." },
    priority: {
      type: "string",
      enum: ["critical", "high", "medium", "low"],
      description: "Urgency from finding severity × dimension weight.",
    },
    dimension: {
      type: "string",
      description: "Which CRO dimension this addresses (use a projection dimension label).",
    },
    problem: {
      type: "string",
      description: "What's wrong and WHY it suppresses conversion — the mechanism.",
    },
    recommendation: { type: "string", description: "The concrete, specific change to make." },
    expectedImpact: {
      type: "string",
      description: "Honest expected effect on conversion (direction + rough magnitude).",
    },
    evidence: {
      type: "array",
      items: { type: "string" },
      description: "Specific signals from the projection; never cite one not present.",
    },
  },
} as const;

export const ANGEL_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...REPORT_PROPS],
  properties: {
    headline: { type: "string", description: "One-line overall verdict on conversion readiness." },
    summary: { type: "string", description: "2–4 sentence executive summary." },
    recommendations: {
      type: "array",
      description:
        "Prioritized recommendations, most impactful first; lead with the ranked priorities.",
      items: RECOMMENDATION_JSON_SCHEMA,
    },
  },
} as const;

/** The structured-output format passed as `output_config.format`. */
export function buildAngelOutputFormat(): { type: "json_schema"; schema: Record<string, unknown> } {
  return {
    type: "json_schema",
    schema: ANGEL_OUTPUT_JSON_SCHEMA as unknown as Record<string, unknown>,
  };
}

// --- System prompt -----------------------------------------------------------
// Frames the Angel as a senior CRO consultant and hard-constrains it to the
// provided signals — the determinism guarantee upstream is only worth keeping
// if the Angel doesn't hallucinate page content the freeze never saw.
export const ANGEL_SYSTEM_PROMPT = [
  "You are the Angel — a senior conversion-rate-optimization (CRO) consultant.",
  "",
  "You receive a DETERMINISTIC, pre-computed analysis of a single web page: a",
  "page-type classification, the value proposition, the conversion path, trust",
  "and friction signals, the visual hierarchy, the section flow, and a rubric",
  "score broken into weighted dimensions — each dimension carrying evidence-",
  "backed findings. A ranked `priorities` list already orders the warn/critical",
  "findings by impact (severity × dimension weight).",
  "",
  "Your job is to turn that analysis into prioritized, plain-language",
  "recommendations a marketer can act on this week. For each: name the problem",
  "and the MECHANISM by which it costs conversions, give a specific fix, and an",
  "honest expected impact.",
  "",
  "Hard rules:",
  "- Ground every claim in the signals provided. NEVER invent page content,",
  "  copy, or elements that are not in the input. If a signal isn't present,",
  "  you don't know it.",
  "- Lead with the ranked `priorities`. They are the deterministic spine of your",
  "  report — translate them, don't reorder them on a whim.",
  "- Do NOT re-score the page or argue with the numbers; the score is fixed",
  "  ground truth. Your value is the 'why' and the 'how to fix it'.",
  "- Calibrate to page type: many shop CTAs are normal on ecommerce; a content/",
  "  media page has no single hard CTA. Don't penalize a page for being its type.",
  "- Be specific and concise. No filler recommendations to pad the list. A",
  "  strong page may warrant only one or two.",
].join("\n");

// --- User prompt (deterministic) ---------------------------------------------
// Serializes the projection into a stable brief + the raw JSON. Pure: same
// projection in → byte-identical string out (no Date/random/key reordering).

function fmtCta(c: CroProjection["primaryCta"]): string {
  if (!c) return "(none detected above the fold)";
  return `"${c.text}" — intent=${c.intent}, section=${c.section}, aboveFold=${c.aboveFold}, salience=${c.salience}`;
}

export function buildAngelUserPrompt(projection: CroProjection): string {
  const p = projection;
  const lines: string[] = [];

  lines.push("# Page analysis (deterministic — extractor " + p.extractorVersion + ")");
  lines.push("");
  lines.push(`Page type: ${p.pageType} (confidence ${p.pageTypeConfidence})`);
  lines.push(`Overall score: ${p.score.overall}/100 — grade ${p.score.grade}`);
  lines.push("");
  lines.push("## Value proposition");
  lines.push(
    p.valueProp.headline ? `Headline: "${p.valueProp.headline}"` : "Headline: (none detected)",
  );
  lines.push("");
  lines.push("## Conversion");
  lines.push(`Primary CTA: ${fmtCta(p.primaryCta)}`);
  lines.push(`Distinct conversion CTAs above the fold (competing focus): ${p.competingAboveFold}`);
  lines.push(
    `Does the primary CTA win visual salience above the fold? ${
      p.hierarchy.primaryCtaWinsSalience === null ? "n/a" : p.hierarchy.primaryCtaWinsSalience
    }`,
  );
  lines.push("");
  lines.push("## Trust & friction");
  lines.push(
    `Trust signals: total=${p.trust.total}, aboveFold=${p.trust.aboveFold}, types=[${p.trust.types.join(", ")}]`,
  );
  lines.push(
    `Above-fold distraction: navItems=${p.friction.aboveFoldNavItems}, interactive=${p.friction.aboveFoldInteractive}`,
  );
  lines.push("");
  lines.push("## Section flow (persuasive narrative order)");
  lines.push(p.flow.length ? p.flow.join(" → ") : "(no sections detected)");
  lines.push("");
  lines.push("## Ranked priorities (deterministic — your report's spine)");
  if (p.priorities.length === 0) {
    lines.push("(none — the rubric flagged no warn/critical findings)");
  } else {
    p.priorities.forEach((pr, i) => {
      lines.push(
        `${i + 1}. [${pr.severity}] (${pr.dimension}, weight ${pr.weight}) ${pr.message}` +
          (pr.evidence && pr.evidence.length ? ` — evidence: ${pr.evidence.join("; ")}` : ""),
      );
    });
  }
  lines.push("");
  lines.push("## Full structured projection (authoritative source — cite only what's here)");
  lines.push("```json");
  lines.push(JSON.stringify(p, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(
    "Produce the CRO report. Lead with the ranked priorities, translate each into a concrete fix with its mechanism and honest expected impact, and stay strictly within the signals above.",
  );

  return lines.join("\n");
}
