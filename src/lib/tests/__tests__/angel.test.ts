import { describe, test, expect } from "vitest";

import { projectCro, type CroProjection } from "../croProjection";
import { scoreCro, type ScoredElement } from "../croScore";
import {
  ANGEL_MODEL,
  ANGEL_OUTPUT_JSON_SCHEMA,
  ANGEL_SYSTEM_PROMPT,
  AngelRecommendationSchema,
  AngelReportSchema,
  buildAngelOutputFormat,
  buildAngelUserPrompt,
  REPORT_PROPS,
  RECOMMENDATION_PROPS,
  type AngelReport,
} from "../angel";

function el(p: Partial<ScoredElement>): ScoredElement {
  return {
    text: "x",
    category: "other",
    intent: "unknown",
    section: "content",
    aboveFold: false,
    visible: true,
    score: 10,
    ...p,
  };
}
// Build a projection the way the pipeline does: collect + pageAudit → score → project.
function projection(p: {
  elements?: ScoredElement[];
  pageAudit?: Record<string, unknown>;
}): CroProjection {
  const collect = { elements: p.elements ?? [] };
  const pageAudit = p.pageAudit ?? {};
  const croScore = scoreCro({ collect, pageAudit });
  return projectCro({ collect, pageAudit, croScore });
}

const sampleProjection = () =>
  projection({
    elements: [
      el({
        category: "cta_primary",
        intent: "conversion",
        aboveFold: true,
        text: "Get a demo",
        score: 60,
      }),
      el({
        category: "cta_secondary",
        intent: "engagement",
        aboveFold: true,
        text: "Watch video",
        score: 90,
      }),
      ...Array.from({ length: 6 }, (_, i) =>
        el({
          category: "nav_item",
          intent: "navigation",
          aboveFold: true,
          text: `Nav ${i}`,
          score: 20,
        }),
      ),
    ],
    pageAudit: { hero: { headline: "The platform for modern teams" }, headings: { h1Count: 1 } },
  });

describe("angel — prompt building is pure & deterministic", () => {
  test("same projection → byte-identical prompt (no Date/random/key drift)", () => {
    const p = sampleProjection();
    expect(buildAngelUserPrompt(p)).toEqual(buildAngelUserPrompt(p));
  });

  test("prompt carries the decisive signals + the full projection JSON", () => {
    const p = sampleProjection();
    const prompt = buildAngelUserPrompt(p);
    expect(prompt).toContain(p.pageType);
    expect(prompt).toContain("The platform for modern teams"); // value prop
    expect(prompt).toContain("Get a demo"); // primary CTA
    expect(prompt).toContain(`${p.score.overall}/100`); // score
    // Grounding: the authoritative JSON must be embedded so the model cites only it.
    expect(prompt).toContain(JSON.stringify(p, null, 2));
  });

  test("ranked priorities appear in order as the report's spine", () => {
    const p = sampleProjection();
    const prompt = buildAngelUserPrompt(p);
    expect(p.priorities.length).toBeGreaterThan(0);
    // First priority's message must appear before the second's in the prompt.
    if (p.priorities.length >= 2) {
      expect(prompt.indexOf(p.priorities[0].message)).toBeLessThan(
        prompt.indexOf(p.priorities[1].message),
      );
    }
  });

  test("a page with no above-fold CTA is described honestly, not invented", () => {
    const p = projection({
      elements: [el({ category: "nav_item", intent: "navigation", aboveFold: true })],
    });
    const prompt = buildAngelUserPrompt(p);
    expect(prompt).toContain("(none detected above the fold)");
  });

  test("model + system prompt are stable contract values", () => {
    expect(ANGEL_MODEL).toBe("claude-opus-4-8");
    expect(ANGEL_SYSTEM_PROMPT).toContain("NEVER invent page content");
    expect(ANGEL_SYSTEM_PROMPT).toContain("Lead with the ranked");
  });
});

describe("angel — output schema", () => {
  const valid: AngelReport = {
    headline: "Strong value prop, but the CTA is losing the fold",
    summary:
      "The page communicates clearly but a louder secondary action outshouts the primary CTA.",
    recommendations: [
      {
        title: "Make the primary CTA the most prominent above-fold element",
        priority: "high",
        dimension: "Visual hierarchy",
        problem: "A secondary engagement link outweighs the primary CTA, splitting attention.",
        recommendation:
          "Demote the video link to a text link and give the demo CTA the dominant button styling.",
        expectedImpact:
          "Likely lifts primary-CTA click-through; magnitude depends on traffic intent.",
        evidence: [
          "primaryCtaWinsSalience=false",
          "competing salience: Watch video=90 vs Get a demo=60",
        ],
      },
    ],
  };

  test("accepts a well-formed report", () => {
    expect(AngelReportSchema.parse(valid)).toEqual(valid);
  });

  test("rejects an unknown priority enum value", () => {
    const bad = {
      ...valid,
      recommendations: [{ ...valid.recommendations[0], priority: "urgent" }],
    };
    expect(() => AngelReportSchema.parse(bad)).toThrow();
  });

  test("rejects a recommendation missing the 'why' (problem)", () => {
    const { problem: _omit, ...rest } = valid.recommendations[0];
    const bad = { ...valid, recommendations: [rest] };
    expect(() => AngelReportSchema.parse(bad)).toThrow();
  });

  test("evidence may be empty but must be present", () => {
    const ok = { ...valid, recommendations: [{ ...valid.recommendations[0], evidence: [] }] };
    expect(() => AngelReportSchema.parse(ok)).not.toThrow();
  });

  test("structured-output format is strict (additionalProperties:false, all required)", () => {
    const fmt = buildAngelOutputFormat();
    expect(fmt.type).toBe("json_schema");
    const schema = fmt.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([...REPORT_PROPS]);
    const rec = (schema.properties as Record<string, { items?: Record<string, unknown> }>)
      .recommendations.items!;
    expect(rec.additionalProperties).toBe(false);
    expect(rec.required).toEqual([...RECOMMENDATION_PROPS]);
  });

  // The wire JSON Schema and the Zod validator are two representations of the
  // same contract; this guard fails if they ever drift apart.
  test("JSON Schema keys match the Zod schema shape (no drift)", () => {
    expect([...REPORT_PROPS].sort()).toEqual(Object.keys(AngelReportSchema.shape).sort());
    expect([...RECOMMENDATION_PROPS].sort()).toEqual(
      Object.keys(AngelRecommendationSchema.shape).sort(),
    );
    // And the constant the API receives matches the declared prop lists.
    expect(ANGEL_OUTPUT_JSON_SCHEMA.required).toEqual([...REPORT_PROPS]);
  });
});
