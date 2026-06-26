import { describe, test, expect } from "vitest";

import { projectCro } from "../croProjection";
import { scoreCro, type ScoredElement } from "../croScore";
import { EXTRACTOR_VERSION } from "../extractor-version";

function el(p: Partial<ScoredElement>): ScoredElement {
  return {
    text: "x", category: "other", intent: "unknown", section: "content",
    aboveFold: false, visible: true, score: 10, ...p,
  };
}
// Build a golden the way the snapshot pipeline does: collect + pageAudit + croScore.
// pageAudit is loosely typed — projectCro reads sectionOrder, which croScore's
// narrower input type doesn't declare.
function golden(p: { elements?: ScoredElement[]; pageAudit?: Record<string, unknown> }) {
  const collect = { elements: p.elements ?? [] };
  const pageAudit = p.pageAudit ?? {};
  return { collect, pageAudit, croScore: scoreCro({ collect, pageAudit }) };
}

describe("croProjection — shape & determinism", () => {
  test("pure: identical golden → identical projection; stamped", () => {
    const g = golden({ elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo", score: 90 })] });
    expect(JSON.stringify(projectCro(g))).toEqual(JSON.stringify(projectCro(g)));
    expect(projectCro(g).extractorVersion).toBe(EXTRACTOR_VERSION);
  });

  test("carries pageType/confidence/score from croScore", () => {
    const g = golden({
      elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo", score: 90 })],
      pageAudit: { hero: { headline: "Ship features without breaking prod" }, headings: { h1Count: 1 } },
    });
    const p = projectCro(g);
    expect(p.pageType).toBe(g.croScore.pageType);
    expect(p.pageTypeConfidence).toBe(g.croScore.pageTypeConfidence);
    expect(p.score.overall).toBe(g.croScore.overall);
    expect(p.valueProp.headline).toBe("Ship features without breaking prod");
  });
});

describe("croProjection — leanness (the point)", () => {
  test("drops hidden inventory + chrome noise; keeps the conversion path", () => {
    const els: ScoredElement[] = [
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo", score: 80 }),
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo", score: 80, section: "nav" }), // dup nav+hero
      el({ category: "cta_secondary", intent: "conversion", aboveFold: true, text: "Start free", score: 60 }),
      // noise that should NOT surface as a CTA:
      ...Array.from({ length: 100 }, () => el({ category: "nav_item", intent: "unknown", visible: false, text: "" })),
      el({ category: "other", intent: "unknown", text: "®" }),
    ];
    const p = projectCro(golden({ elements: els }));
    // 105 raw elements → 2 distinct conversion CTAs in the path
    expect(p.conversionPath.length).toBe(2);
    expect(p.primaryCta?.text).toBe("Get a demo");
    expect(p.conversionPath.map((c) => c.text)).toEqual(["Get a demo", "Start free"]);
    expect(p.competingAboveFold).toBe(2);
  });

  test("primaryCta is the strongest distinct conversion action", () => {
    const p = projectCro(golden({ elements: [
      el({ category: "cta_secondary", intent: "conversion", aboveFold: true, text: "Weak", score: 30 }),
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Strong", score: 95 }),
    ] }));
    expect(p.primaryCta?.text).toBe("Strong");
    expect(p.primaryCta?.salience).toBe(95);
  });
});

describe("croProjection — hierarchy & friction", () => {
  test("primaryCtaWinsSalience reflects whether the CTA is the most prominent", () => {
    const wins = projectCro(golden({ elements: [
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Buy", score: 95 }),
      el({ category: "link", intent: "information", aboveFold: true, text: "Learn", score: 80 }),
    ] }));
    expect(wins.hierarchy.primaryCtaWinsSalience).toBe(true);

    const buried = projectCro(golden({ elements: [
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Buy", score: 20 }),
      el({ category: "link", intent: "information", aboveFold: true, text: "Learn", score: 100 }),
    ] }));
    expect(buried.hierarchy.primaryCtaWinsSalience).toBe(false);
  });

  test("null hierarchy when there's no above-fold conversion CTA", () => {
    const p = projectCro(golden({ elements: [el({ category: "nav_item", intent: "navigation", aboveFold: true })] }));
    expect(p.primaryCta).toBeNull();
    expect(p.hierarchy.primaryCtaWinsSalience).toBeNull();
  });

  test("friction counts above-fold nav + interactive distraction", () => {
    const p = projectCro(golden({ elements: [
      ...Array.from({ length: 9 }, () => el({ category: "nav_item", aboveFold: true })),
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Go" }),
    ] }));
    expect(p.friction.aboveFoldNavItems).toBe(9);
    expect(p.friction.aboveFoldInteractive).toBe(1);
  });
});

describe("croProjection — findings & priorities (the LLM's 'why')", () => {
  test("dimensions carry the evidence-backed findings + weight, not just scores", () => {
    const p = projectCro(golden({ elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo", score: 90 })] }));
    const cta = p.score.dimensions.find((d) => d.id === "cta-focus")!;
    expect(cta).toHaveProperty("weight");
    expect(cta).toHaveProperty("label");
    expect(cta.findings.length).toBeGreaterThan(0);
    expect(cta.findings[0]).toHaveProperty("severity");
    expect(cta.findings[0]).toHaveProperty("message");
  });

  test("priorities surface only warn/critical, critical-first", () => {
    // weak page: no conversion CTA (critical) + no headline (critical) + ...
    const p = projectCro(golden({ elements: [el({ category: "nav_item", intent: "navigation", aboveFold: true })], pageAudit: { hero: { headline: "" } } }));
    expect(p.priorities.length).toBeGreaterThan(0);
    expect(p.priorities.every((x) => x.severity === "warn" || x.severity === "critical")).toBe(true);
    const rank = { critical: 2, warn: 1, good: 0 } as const;
    for (let i = 1; i < p.priorities.length; i++) {
      expect(rank[p.priorities[i - 1].severity]).toBeGreaterThanOrEqual(rank[p.priorities[i].severity]);
    }
    expect(p.priorities[0]).toHaveProperty("dimension");
    expect(p.priorities[0]).toHaveProperty("weight");
  });

  test("a strong page yields few priorities", () => {
    const p = projectCro(golden({
      elements: [
        el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo", score: 95 }),
        ...Array.from({ length: 4 }, () => el({ category: "nav_item", aboveFold: true })),
      ],
      pageAudit: {
        hero: { headline: "The CRM that grows with you" }, headings: { h1Count: 1 },
        trustSummary: { total: 4, aboveFold: 2, byType: { testimonial: 2, customer_logos: 2 } },
        images: { total: 8, missingAlt: 0 }, head: { title: "Acme" },
      },
    }));
    expect(p.priorities.length).toBeLessThanOrEqual(2);
  });
});

describe("croProjection — trust & flow", () => {
  test("trust types are surfaced sorted; flow is the section order", () => {
    const p = projectCro(golden({ pageAudit: {
      trustSummary: { total: 4, aboveFold: 1, byType: { testimonial: 1, customer_logos: 2, social_proof_count: 1 } },
      sectionOrder: ["header", "hero", "cards", "footer"],
    } }));
    expect(p.trust).toEqual({ total: 4, aboveFold: 1, types: ["customer_logos", "social_proof_count", "testimonial"] });
    expect(p.flow).toEqual(["header", "hero", "cards", "footer"]);
  });
});
