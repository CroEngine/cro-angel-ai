// Pins buildPageReports rendering-logik mot tre granskningsfynd (2026-08-14):
//
//  1. "Hidden interactive elements" var strukturellt alltid 0 — COLLECT_SCRIPT
//     filtrerar bort osynliga element före emit och hårdkodar visible: true
//     (collect.ts). Den döda mätaren är borttagen och får inte återuppstå.
//  2. "Total review count" summerade per-widget reviewCounts och dubbelräknade
//     samma recensionskorpus (header + footer, stars_aggregate + review_rating).
//     Nu: max per namngiven källa, summera distinkta källor; källösa signaler
//     höjer bara totalen om deras max överstiger den (kollektorns B7-anda).
//  3. CTA-detaljen renderade 9999px-ingen-form-sentinelen (ctas.ts minDist)
//     som ett verkligt avstånd ("form 9999px"). Sentinelen renderas nu som
//     "form none", aldrig som ett tal.
//
// Fixturerna är minimala men går genom den publika ytan buildPageReports, så
// event-routningen (goto → pageAudit/collect) pinnas på köpet.

import { describe, it, expect } from "vitest";

import { buildPageReports, type Finding } from "../findings";
import type { StreamEvent } from "../hooks/useTestStream";
import type {
  CollectData,
  CollectedElement,
  CTAEntity,
  PageAuditData,
  TrustSignal,
} from "@/lib/tests/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface AuditOver {
  trustSignals?: TrustSignal[];
  ctas?: CTAEntity[];
}

// Minimal men körbar PageAuditData: exakt de fält findings.ts läser utan
// guard (seoFindings + isPageAudit); allt valfritt/guardat utelämnas.
function mkAudit(o: AuditOver = {}): PageAuditData {
  const audit = {
    url: "https://example.com/",
    head: {
      title: "Example",
      description: "",
      canonical: null,
      lang: "en",
      ogImage: null,
    },
    headings: { h1Count: 1, h2Count: 2, h3Count: 0 },
    images: { total: 0, missingAlt: 0, missingAltPct: 0 },
    schema: { count: 0, types: [] },
    robotsTxt: { exists: false },
    sitemap: { exists: false, urlCount: 0 },
    content: { wordCount: 100 },
    links: { total: 0, internal: 0, external: 0 },
    sections: [],
    trustSignals: o.trustSignals ?? [],
    trustSummary: { total: o.trustSignals?.length ?? 0, aboveFold: 0, byType: {} },
    ctas: o.ctas ?? [],
    forms: [],
    visualHierarchy: [],
    flags: [],
  };
  return audit as unknown as PageAuditData;
}

function mkTrust(o: Partial<TrustSignal> & { type: TrustSignal["type"] }): TrustSignal {
  return {
    text: "4.7 of 5",
    section: "footer",
    aboveFold: false,
    visualWeight: 0,
    source: "text",
    ...o,
  } as TrustSignal;
}

function mkCta(o: Partial<CTAEntity> = {}): CTAEntity {
  return {
    text: "Get started",
    intent: "conversion",
    category: "cta_primary",
    section: "hero",
    aboveFold: true,
    visualWeight: 80,
    competingActions: 0,
    nearestTrustSignalDistance: null,
    nearestFormDistance: 0,
    contrastRatio: null,
    wcagLevel: null,
    rect: { x: 0, y: 0, w: 120, h: 40 },
    ...o,
  };
}

function mkElement(o: Partial<CollectedElement> = {}): CollectedElement {
  return {
    text: "Button",
    tagName: "a",
    selector: "a.x",
    category: "link",
    intent: "information",
    section: "content",
    href: null,
    disabled: false,
    // Kollektorn hårdkodar visible: true på allt den emitterar — det är just
    // därför den döda mätaren togs bort.
    visible: true,
    aboveFold: false,
    rect: { x: 0, y: 0, w: 120, h: 40 },
    position: { viewportZone: "mid_page", yPercent: 0, xPercent: 0 },
    visualWeight: { area: 4800, fontSize: 16, fontWeight: 400, backgroundContrast: 1, score: 10 },
    attributes: {},
    ...o,
  } as CollectedElement;
}

function mkCollect(o: Partial<CollectData> = {}): CollectData {
  const elements = o.elements ?? [mkElement()];
  return {
    target: "interactive",
    count: elements.length,
    elements,
    summary: {
      total: elements.length,
      aboveFold: 0,
      primaryConversionCtaCount: 1,
      competingAboveFold: 0,
      topVisualWeight: [],
      intentBreakdown: {},
    },
    ...o,
  } as CollectData;
}

function auditEvents(audit: PageAuditData): StreamEvent[] {
  return [
    { type: "step_started", data: { kind: "goto", summary: "goto https://example.com/" } },
    { type: "step_passed", data: { kind: "pageAudit", summary: "pageAudit", data: audit } },
  ];
}

function collectEvents(collect: CollectData): StreamEvent[] {
  return [
    { type: "step_started", data: { kind: "goto", summary: "goto https://example.com/" } },
    {
      type: "step_passed",
      data: { kind: "collect", summary: "collect interactive", data: collect },
    },
  ];
}

function findingsFor(events: StreamEvent[]): Finding[] {
  const reports = buildPageReports(events);
  expect(reports).toHaveLength(1);
  return reports[0].findings;
}

function byLabel(findings: Finding[], label: string): Finding | undefined {
  return findings.find((x) => x.label === label);
}

// ---------------------------------------------------------------------------
// Fynd 1: den döda "Hidden interactive elements"-mätaren är borttagen
// ---------------------------------------------------------------------------

describe("hidden interactive elements (dead metric, removed)", () => {
  it("emits no 'Hidden interactive elements' finding for collector-shaped data", () => {
    const findings = findingsFor(
      collectEvents(mkCollect({ elements: [mkElement(), mkElement(), mkElement()] })),
    );
    expect(byLabel(findings, "Hidden interactive elements")).toBeUndefined();
    // uxFindings kördes fortfarande — grannmätaren finns kvar.
    expect(byLabel(findings, "Above fold")).toBeDefined();
  });

  it("emits no hidden-elements meter even if an element claimed !visible", () => {
    // Kan inte hända med dagens kollektor (visible hårdkodas true) — pinnar
    // att vyn inte återinför mätaren utifrån ett fält som aldrig varierar.
    const findings = findingsFor(
      collectEvents(
        mkCollect({ elements: [mkElement({ visible: false } as Partial<CollectedElement>)] }),
      ),
    );
    expect(findings.some((x) => x.label.toLowerCase().includes("hidden"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fynd 2: "Total review count" dedupliceras i stället för att rakt summeras
// ---------------------------------------------------------------------------

describe("total review count dedup", () => {
  const label = "Total review count";

  it("collapses same-source restatements via max, not sum (header + footer widget)", () => {
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({
              type: "review_rating",
              section: "header",
              reviewCount: 2113,
              reviewSource: "Trustpilot",
            }),
            mkTrust({
              type: "review_rating",
              section: "footer",
              reviewCount: 2113,
              reviewSource: "Trustpilot",
            }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)?.detail).toBe("2113");
  });

  it("sums distinct named sources", () => {
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({ type: "review_rating", reviewCount: 2113, reviewSource: "Trustpilot" }),
            mkTrust({ type: "review_rating", reviewCount: 890, reviewSource: "Google" }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)?.detail).toBe("3003");
  });

  it("treats a sourceless stars_aggregate as a restatement of a named source", () => {
    // stars_aggregate bär ingen reviewSource — rak summering gav 4226 här.
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({ type: "review_rating", reviewCount: 2113, reviewSource: "Trustpilot" }),
            mkTrust({
              type: "stars_aggregate",
              text: "3 star ratings (avg 4.7)",
              reviewCount: 2113,
            }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)?.detail).toBe("2113");
  });

  it("lets a larger sourceless aggregate win over the named total (site-wide corpus)", () => {
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({ type: "review_rating", reviewCount: 2113, reviewSource: "Trustpilot" }),
            mkTrust({ type: "stars_aggregate", reviewCount: 5000 }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)?.detail).toBe("5000");
  });

  it("uses max across sourceless-only signals (B7: max, not sum)", () => {
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({ type: "review_rating", reviewCount: 2113 }),
            mkTrust({ type: "review_rating", reviewCount: 1500 }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)?.detail).toBe("2113");
  });

  it("case-insensitively keys named sources", () => {
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({ type: "review_rating", reviewCount: 2113, reviewSource: "Trustpilot" }),
            mkTrust({ type: "review_rating", reviewCount: 2000, reviewSource: "trustpilot" }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)?.detail).toBe("2113");
  });

  it("emits no finding when no review-bearing signal carries a count", () => {
    const findings = findingsFor(
      auditEvents(mkAudit({ trustSignals: [mkTrust({ type: "review_rating", rating: 4.7 })] })),
    );
    expect(byLabel(findings, label)).toBeUndefined();
  });

  it("ignores reviewCount on non-review signal types", () => {
    const findings = findingsFor(
      auditEvents(
        mkAudit({
          trustSignals: [
            mkTrust({ type: "testimonial", reviewCount: 999 } as Partial<TrustSignal> & {
              type: "testimonial";
            }),
          ],
        }),
      ),
    );
    expect(byLabel(findings, label)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fynd 3: 9999-sentinelen renderas som "none", aldrig som ett avstånd
// ---------------------------------------------------------------------------

describe("CTA nearest-form rendering", () => {
  function ctaDetail(nearestFormDistance: number): string {
    const findings = findingsFor(
      auditEvents(mkAudit({ ctas: [mkCta({ text: "Buy now", nearestFormDistance })] })),
    );
    const cta = byLabel(findings, '"Buy now"');
    expect(cta).toBeDefined();
    return cta!.detail ?? "";
  }

  it("renders the 9999 no-form sentinel as 'form none', never with a px suffix", () => {
    const detail = ctaDetail(9999);
    expect(detail).toContain("form none");
    expect(detail).not.toContain("9999");
  });

  it("renders distance 0 as inside the form", () => {
    expect(ctaDetail(0)).toContain("form in");
  });

  it("renders real distances with a px suffix", () => {
    expect(ctaDetail(240)).toContain("form 240px");
  });
});
