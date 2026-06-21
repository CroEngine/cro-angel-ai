import { describe, test, expect } from "vitest";

import { scoreCro, type GoldenLike, type ScoredElement } from "../croScore";
import { EXTRACTOR_VERSION } from "../extractor-version";

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

function golden(p: {
  elements?: ScoredElement[];
  pageAudit?: GoldenLike["pageAudit"];
}): GoldenLike {
  return {
    collect: { elements: p.elements ?? [] },
    pageAudit: p.pageAudit ?? {},
  };
}

const dim = (s: ReturnType<typeof scoreCro>, id: string) =>
  s.dimensions.find((d) => d.id === id)!;

describe("croScore — determinism & shape", () => {
  test("pure: identical input → identical output", () => {
    const g = golden({
      elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true, score: 90 })],
      pageAudit: { hero: { headline: "Build better software faster" }, headings: { h1Count: 1 } },
    });
    expect(JSON.stringify(scoreCro(g))).toEqual(JSON.stringify(scoreCro(g)));
  });

  test("stamped with the current extractor version", () => {
    expect(scoreCro(golden({})).extractorVersion).toBe(EXTRACTOR_VERSION);
  });

  test("weights sum to 1.0 and overall is the weighted blend", () => {
    const s = scoreCro(golden({}));
    const wsum = s.dimensions.reduce((a, d) => a + d.weight, 0);
    expect(wsum).toBeCloseTo(1.0, 6);
    const blend = Math.round(
      s.dimensions.reduce((a, d) => a + d.score * d.weight, 0) / wsum,
    );
    expect(s.overall).toBe(blend);
  });

  test("empty golden does not throw and yields an F-ish low score", () => {
    const s = scoreCro(golden({}));
    expect(s.overall).toBeGreaterThanOrEqual(0);
    expect(s.overall).toBeLessThan(60);
    expect(["D", "F"]).toContain(s.grade);
  });
});

describe("croScore — CTA focus", () => {
  test("single above-fold conversion CTA scores 100", () => {
    const s = scoreCro(
      golden({ elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true })] }),
    );
    expect(dim(s, "cta-focus").score).toBe(100);
    expect(dim(s, "cta-focus").findings[0].severity).toBe("good");
  });

  test("no above-fold conversion CTA is critical", () => {
    const s = scoreCro(
      golden({ elements: [el({ category: "nav_item", intent: "navigation", aboveFold: true })] }),
    );
    expect(dim(s, "cta-focus").score).toBe(20);
    expect(dim(s, "cta-focus").findings[0].severity).toBe("critical");
  });

  test("two distinct CTAs = healthy primary+secondary pattern (90, good)", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Buy" }),
          el({ category: "cta_secondary", intent: "conversion", aboveFold: true, text: "Trial" }),
        ],
      }),
    );
    expect(dim(s, "cta-focus").score).toBe(90);
    expect(dim(s, "cta-focus").findings[0].severity).toBe("good");
  });

  test("the SAME CTA repeated in nav + hero is deduped, not 'choice overload'", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, section: "nav", text: "Get a demo" }),
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, section: "hero", text: "Get a demo" }),
          el({ category: "cta_secondary", intent: "conversion", aboveFold: true, section: "nav", text: "Get a demo" }),
        ],
      }),
    );
    // three instances of one logical CTA → counts as 1 → perfect focus
    expect(dim(s, "cta-focus").score).toBe(100);
  });

  test("3 distinct → 70 (warn); 4+ distinct → 45 (choice overload)", () => {
    const three = scoreCro(
      golden({
        elements: ["Buy", "Trial", "Quote"].map((t) =>
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: t }),
        ),
      }),
    );
    expect(dim(three, "cta-focus").score).toBe(70);
    const four = scoreCro(
      golden({
        elements: ["Buy", "Trial", "Quote", "Call"].map((t) =>
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: t }),
        ),
      }),
    );
    expect(dim(four, "cta-focus").score).toBe(45);
  });

  test("hidden CTAs are excluded from scoring (visible-only)", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, visible: false }),
        ],
      }),
    );
    // the only conversion CTA is hidden → treated as none above the fold
    expect(dim(s, "cta-focus").score).toBe(20);
  });
});

describe("croScore — visual hierarchy", () => {
  test("CTA is the most salient element → 100", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, score: 95 }),
          el({ category: "link", intent: "information", aboveFold: true, score: 80 }),
        ],
      }),
    );
    expect(dim(s, "visual-hierarchy").score).toBe(100);
  });

  test("CTA visually buried → critical low score", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, score: 20 }),
          el({ category: "link", intent: "information", aboveFold: true, score: 100 }),
        ],
      }),
    );
    expect(dim(s, "visual-hierarchy").score).toBe(30);
    expect(dim(s, "visual-hierarchy").findings[0].severity).toBe("critical");
  });
});

describe("croScore — value proposition", () => {
  test("clear headline + single h1 → 100", () => {
    const s = scoreCro(
      golden({ pageAudit: { hero: { headline: "Ship features without breaking prod" }, headings: { h1Count: 1 } } }),
    );
    expect(dim(s, "value-prop").score).toBe(100);
  });

  test("missing headline → critical", () => {
    const s = scoreCro(golden({ pageAudit: { hero: { headline: "" } } }));
    expect(dim(s, "value-prop").score).toBe(20);
    expect(dim(s, "value-prop").findings[0].severity).toBe("critical");
  });

  test("generic headline is penalized", () => {
    const s = scoreCro(
      golden({ pageAudit: { hero: { headline: "Welcome" }, headings: { h1Count: 1 } } }),
    );
    expect(dim(s, "value-prop").score).toBe(50);
  });

  test("good headline but multiple h1 → partial", () => {
    const s = scoreCro(
      golden({ pageAudit: { hero: { headline: "Automate your back office today" }, headings: { h1Count: 3 } } }),
    );
    expect(dim(s, "value-prop").score).toBe(70);
  });

  test("falls back to h1 when hero headline is a weak label (the hubspot case)", () => {
    const s = scoreCro(
      golden({
        pageAudit: {
          hero: { headline: "Marketing" }, // pageAudit grabbed a nav label
          headings: { h1Count: 1, h1: ["Where go-to-market teams go to grow"] },
        },
      }),
    );
    expect(dim(s, "value-prop").score).toBe(100);
    expect(dim(s, "value-prop").findings[0].evidence?.[0]).toContain("go-to-market");
  });
});

describe("croScore — trust", () => {
  test("trust above the fold → 100", () => {
    const s = scoreCro(
      golden({ pageAudit: { trustSummary: { total: 3, aboveFold: 1, byType: { testimonial: 1, customer_logos: 2 } } } }),
    );
    expect(dim(s, "trust").score).toBe(100);
  });

  test("no trust signals → warn", () => {
    const s = scoreCro(golden({ pageAudit: { trustSummary: { total: 0, aboveFold: 0, byType: {} } } }));
    expect(dim(s, "trust").score).toBe(30);
    expect(dim(s, "trust").findings[0].severity).toBe("warn");
  });
});

describe("croScore — friction & quality", () => {
  test("focused nav → 100; overload → 40", () => {
    const focused = scoreCro(
      golden({ elements: Array.from({ length: 5 }, () => el({ category: "nav_item", aboveFold: true })) }),
    );
    expect(dim(focused, "friction").score).toBe(100);
    const overload = scoreCro(
      golden({ elements: Array.from({ length: 15 }, () => el({ category: "nav_item", aboveFold: true })) }),
    );
    expect(dim(overload, "friction").score).toBe(40);
  });

  test("quality reflects alt coverage + h1 + title", () => {
    const s = scoreCro(
      golden({ pageAudit: { images: { total: 10, missingAlt: 0 }, headings: { h1Count: 1 }, head: { title: "Acme" } } }),
    );
    expect(dim(s, "quality").score).toBe(100);
    const poor = scoreCro(
      golden({ pageAudit: { images: { total: 10, missingAlt: 10 }, headings: { h1Count: 0 }, head: { title: "" } } }),
    );
    expect(poor.dimensions.find((d) => d.id === "quality")!.score).toBe(0);
  });
});

describe("croScore — page-type classification & adaptation", () => {
  const shopEls = [
    el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Add to cart" }),
    el({ category: "cta_secondary", intent: "navigation", aboveFold: true, text: "Shop women" }),
    el({ category: "link", intent: "information", text: "$95.00" }),
    el({ category: "link", intent: "information", text: "$120.00" }),
    el({ category: "link", intent: "information", text: "$75.00" }),
  ];

  test("classifies ecommerce from prices + shop CTAs", () => {
    expect(scoreCro(golden({ elements: shopEls })).pageType).toBe("ecommerce");
  });

  test("ecommerce: multiple shop CTAs are NOT choice overload", () => {
    const s = scoreCro(golden({ elements: shopEls }));
    expect(s.pageType).toBe("ecommerce");
    expect(dim(s, "cta-focus").score).toBe(100); // would have been penalized under saas rubric
  });

  test("ecommerce: image-led hero (no headline) is acceptable, not critical", () => {
    const s = scoreCro(golden({ elements: shopEls, pageAudit: { hero: { headline: "" } } }));
    expect(dim(s, "value-prop").score).toBe(80);
    expect(dim(s, "value-prop").findings[0].severity).toBe("good");
  });

  test("classifies saas-landing from demo/trial CTAs + pricing nav", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo" }),
          el({ category: "nav_item", intent: "navigation", aboveFold: true, text: "Pricing" }),
        ],
      }),
    );
    expect(s.pageType).toBe("saas-landing");
  });

  test("classifies content-media from many info links + few CTAs; missing CTA isn't critical", () => {
    const articles = Array.from({ length: 25 }, (_, i) =>
      el({ category: "link", intent: "information", text: `Headline article ${i}` }),
    );
    const s = scoreCro(golden({ elements: articles }));
    expect(s.pageType).toBe("content-media");
    // no conversion CTA, but content pages aren't failed for it (60, not 20)
    expect(dim(s, "cta-focus").score).toBe(60);
  });

  test("content-media with a subscribe CTA scores the conversion path full", () => {
    const els = [
      ...Array.from({ length: 25 }, (_, i) => el({ category: "link", intent: "information", text: `Story ${i}` })),
      el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Subscribe" }),
    ];
    const s = scoreCro(golden({ elements: els }));
    expect(s.pageType).toBe("content-media");
    expect(dim(s, "cta-focus").score).toBe(100);
  });

  test("weights adapt to page type (ecommerce value-prop weight is lower)", () => {
    const ecom = scoreCro(golden({ elements: shopEls }));
    expect(dim(ecom, "value-prop").weight).toBe(0.1);
    const saas = scoreCro(
      golden({ elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo" })] }),
    );
    expect(dim(saas, "value-prop").weight).toBe(0.2);
  });

  test("per-type weights always sum to 1.0", () => {
    for (const g of [
      golden({ elements: shopEls }),
      golden({ elements: [el({ category: "cta_primary", intent: "conversion", aboveFold: true, text: "Get a demo" })] }),
      golden({ elements: Array.from({ length: 25 }, () => el({ category: "link", intent: "information" })) }),
      golden({}),
    ]) {
      const s = scoreCro(g);
      expect(s.dimensions.reduce((a, d) => a + d.weight, 0)).toBeCloseTo(1.0, 6);
    }
  });
});

describe("croScore — end to end", () => {
  test("a well-built landing page grades high", () => {
    const s = scoreCro(
      golden({
        elements: [
          el({ category: "cta_primary", intent: "conversion", aboveFold: true, score: 95, text: "Get a demo" }),
          ...Array.from({ length: 4 }, () => el({ category: "nav_item", aboveFold: true })),
        ],
        pageAudit: {
          hero: { headline: "The CRM platform that grows with you" },
          headings: { h1Count: 1 },
          trustSummary: { total: 4, aboveFold: 2, byType: { testimonial: 2, customer_logos: 2 } },
          images: { total: 8, missingAlt: 0 },
          head: { title: "Acme CRM" },
        },
      }),
    );
    expect(s.overall).toBeGreaterThanOrEqual(90);
    expect(s.grade).toBe("A");
  });

  test("a weak page grades low with critical findings", () => {
    const s = scoreCro(
      golden({
        elements: [
          ...Array.from({ length: 14 }, () => el({ category: "nav_item", aboveFold: true })),
          el({ category: "link", intent: "information", aboveFold: true, score: 100 }),
        ],
        pageAudit: { hero: { headline: "" }, headings: { h1Count: 0 }, trustSummary: { total: 0, aboveFold: 0, byType: {} }, images: { total: 5, missingAlt: 5 } },
      }),
    );
    expect(s.overall).toBeLessThan(45);
    expect(s.grade).toBe("F");
    const allFindings = s.dimensions.flatMap((d) => d.findings);
    expect(allFindings.some((f) => f.severity === "critical")).toBe(true);
  });
});
