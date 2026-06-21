// Deterministic CRO scorer. Pure function over the NORMALIZED golden (the
// regression-tested artifact: collect.elements + slim pageAudit). No IO, no
// Date/random, browser-safe — like llmContext.ts. Same golden in → same score
// out, so the score is itself regression-testable and the Angel LLM reasons
// over scored signals instead of raw DOM.
//
// This is rules, not an LLM. Each dimension yields a 0–100 sub-score plus the
// EVIDENCE (which elements drove it) and templated findings. The overall is a
// fixed-weight blend. Stamped with EXTRACTOR_VERSION so a score is never
// compared across scorer revisions.
//
// Scored on VISIBLE elements: CRO is about what the visitor actually sees, and
// the v1.1.0 completeness pass lets us tell visible content from the hidden
// mega-menu/accordion inventory it now also captures.

import { EXTRACTOR_VERSION } from "./extractor-version";

// --- Input shapes (subset of the normalized golden we read) ------------------
export interface ScoredElement {
  text: string;
  category: string; // cta_primary | cta_secondary | form_submit | icon_button | nav_item | link | other
  intent: string; // conversion | information | navigation | social | utility | engagement | unknown
  section: string; // nav | header | hero | cards | content | footer
  aboveFold: boolean;
  visible?: boolean;
  score: number; // visual salience 0–100
}
export interface NormalizedCollectLike {
  elements: ScoredElement[];
}
export interface NormalizedPageAuditLike {
  hero?: {
    headline?: string;
    primaryCtaText?: string;
    primaryCtaIntent?: string;
    aboveFold?: boolean;
  } | null;
  headings?: { h1Count?: number; h1?: string[] } | null;
  ctaSummary?: { total?: number; primary?: number; aboveFold?: number } | null;
  trustSummary?: {
    total?: number;
    aboveFold?: number;
    byType?: Record<string, number>;
  } | null;
  images?: { total?: number; missingAlt?: number } | null;
  head?: { title?: string | null } | null;
}
export interface GoldenLike {
  collect?: NormalizedCollectLike | null;
  pageAudit?: NormalizedPageAuditLike | null;
}

// --- Output shapes -----------------------------------------------------------
export type Severity = "good" | "warn" | "critical";

export interface CroFinding {
  severity: Severity;
  message: string;
  evidence?: string[];
}

export interface CroDimension {
  id: string;
  label: string;
  score: number; // 0–100
  weight: number; // contribution to overall
  findings: CroFinding[];
}

export interface CroScore {
  extractorVersion: string;
  overall: number; // 0–100, weighted
  grade: "A" | "B" | "C" | "D" | "F";
  dimensions: CroDimension[];
}

// --- helpers -----------------------------------------------------------------
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);

// Generic-headline guard: a value prop that's just the brand or a greeting
// communicates nothing about why to convert.
const GENERIC_HEADLINE_RX =
  /^(welcome|home|homepage|hello|hi there|get started|sign in|log ?in)\b/i;

function isConversion(el: ScoredElement): boolean {
  if (el.intent === "conversion") return true;
  return el.category === "form_submit";
}
function isCtaish(el: ScoredElement): boolean {
  return (
    el.category === "cta_primary" ||
    el.category === "cta_secondary" ||
    el.category === "form_submit"
  );
}
function evidenceTexts(els: ScoredElement[], cap = 6): string[] {
  return els
    .map((e) => (e.text || "").trim())
    .filter((t) => t.length > 0)
    .slice(0, cap);
}

// --- dimensions --------------------------------------------------------------
// Each returns {score, findings}; the caller stamps id/label/weight.

// The same CTA repeated across the sticky nav + hero is ONE logical action,
// not competition — dedupe on normalized text+intent before counting. Empty-
// text CTAs (icon buttons) are kept distinct so they aren't collapsed together.
function distinctConversionCtas(visible: ScoredElement[]): ScoredElement[] {
  const conv = visible.filter(
    (e) => e.aboveFold && isCtaish(e) && isConversion(e),
  );
  const seen = new Set<string>();
  const out: ScoredElement[] = [];
  for (const e of conv) {
    const t = (e.text || "").trim().toLowerCase();
    const key = t ? `${t}|${e.intent}` : `__empty_${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function scoreCtaFocus(visible: ScoredElement[]): {
  score: number;
  findings: CroFinding[];
} {
  const distinct = distinctConversionCtas(visible);
  const n = distinct.length;
  const evidence = evidenceTexts(distinct);
  if (n === 0) {
    return {
      score: 20,
      findings: [
        {
          severity: "critical",
          message:
            "No conversion CTA above the fold — the primary action isn't visible without scrolling.",
        },
      ],
    };
  }
  if (n === 1) {
    return {
      score: 100,
      findings: [
        {
          severity: "good",
          message: `Single clear conversion CTA above the fold ("${evidence[0]}").`,
          evidence,
        },
      ],
    };
  }
  if (n === 2) {
    return {
      score: 90,
      findings: [
        {
          severity: "good",
          message:
            "Two distinct conversion CTAs above the fold — a focused primary + secondary pattern.",
          evidence,
        },
      ],
    };
  }
  if (n === 3) {
    return {
      score: 70,
      findings: [
        {
          severity: "warn",
          message:
            "3 distinct conversion CTAs above the fold start competing for attention.",
          evidence,
        },
      ],
    };
  }
  return {
    score: 45,
    findings: [
      {
        severity: "warn",
        message: `${n} distinct conversion CTAs above the fold dilute focus (choice overload).`,
        evidence,
      },
    ],
  };
}

function scoreVisualHierarchy(visible: ScoredElement[]): {
  score: number;
  findings: CroFinding[];
} {
  const aboveFold = visible.filter((e) => e.aboveFold);
  const conv = aboveFold.filter((e) => isCtaish(e) && isConversion(e));
  if (aboveFold.length === 0 || conv.length === 0) {
    return {
      score: 40,
      findings: [
        {
          severity: "warn",
          message:
            "No above-the-fold conversion CTA to anchor visual hierarchy on.",
        },
      ],
    };
  }
  const maxAll = Math.max(...aboveFold.map((e) => e.score));
  const maxCta = Math.max(...conv.map((e) => e.score));
  const ratio = maxAll > 0 ? maxCta / maxAll : 0;
  const evidence = [
    `primary CTA salience ${maxCta} vs page max ${maxAll}`,
  ];
  if (ratio >= 0.9) {
    return {
      score: 100,
      findings: [
        {
          severity: "good",
          message:
            "The conversion CTA is the most visually prominent element above the fold.",
          evidence,
        },
      ],
    };
  }
  if (ratio >= 0.7) {
    return {
      score: 75,
      findings: [
        {
          severity: "warn",
          message:
            "The conversion CTA is prominent but not the single strongest visual element.",
          evidence,
        },
      ],
    };
  }
  if (ratio >= 0.5) {
    return {
      score: 50,
      findings: [
        {
          severity: "warn",
          message:
            "The conversion CTA is visually outweighed by other elements above the fold.",
          evidence,
        },
      ],
    };
  }
  return {
    score: 30,
    findings: [
      {
        severity: "critical",
        message:
          "The conversion CTA is visually buried — other elements dominate the fold.",
        evidence,
      },
    ],
  };
}

// The pageAudit hero-headline heuristic sometimes grabs a nav/section label
// (hubspot: "Marketing") while the real value proposition sits in the h1. Pick
// the strongest available headline: prefer a substantial, non-generic
// candidate; otherwise fall back to the longest. The underlying data is already
// in the golden — this just stops a weak hero pick from masking a strong h1.
function pickHeadline(audit: NormalizedPageAuditLike): string {
  const hero = (audit.hero?.headline || "").trim();
  const h1 = (audit.headings?.h1?.[0] || "").trim();
  const candidates = [hero, h1].filter((c) => c.length > 0);
  if (candidates.length === 0) return "";
  const strong = candidates.filter(
    (c) => c.length >= 10 && !GENERIC_HEADLINE_RX.test(c),
  );
  const pool = strong.length > 0 ? strong : candidates;
  return pool.slice().sort((a, b) => b.length - a.length)[0];
}

function scoreValueProp(audit: NormalizedPageAuditLike): {
  score: number;
  findings: CroFinding[];
} {
  const headline = pickHeadline(audit);
  const h1Count = audit.headings?.h1Count ?? 0;
  const evidence = headline ? [headline] : [];

  if (!headline) {
    return {
      score: 20,
      findings: [
        {
          severity: "critical",
          message: "No hero headline detected — the value proposition is missing.",
        },
      ],
    };
  }
  if (headline.length < 10 || GENERIC_HEADLINE_RX.test(headline)) {
    return {
      score: 50,
      findings: [
        {
          severity: "warn",
          message: `Hero headline is weak or generic ("${headline}") — it should state a specific value.`,
          evidence,
        },
      ],
    };
  }
  if (h1Count !== 1) {
    return {
      score: 70,
      findings: [
        {
          severity: "warn",
          message: `Clear hero headline, but ${h1Count} h1 tags (expect exactly 1) muddies the page's primary message.`,
          evidence,
        },
      ],
    };
  }
  return {
    score: 100,
    findings: [
      {
        severity: "good",
        message: `Clear value proposition in the hero ("${headline}") with a single h1.`,
        evidence,
      },
    ],
  };
}

function scoreTrust(audit: NormalizedPageAuditLike): {
  score: number;
  findings: CroFinding[];
} {
  const total = audit.trustSummary?.total ?? 0;
  const aboveFold = audit.trustSummary?.aboveFold ?? 0;
  const byType = audit.trustSummary?.byType ?? {};
  const evidence = Object.entries(byType)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}: ${n}`);

  if (total === 0) {
    return {
      score: 30,
      findings: [
        {
          severity: "warn",
          message:
            "No trust signals detected (testimonials, customer logos, review badges) — credibility is unsupported.",
        },
      ],
    };
  }
  if (aboveFold >= 1 && total >= 2) {
    return {
      score: 100,
      findings: [
        {
          severity: "good",
          message: `${total} trust signals, ${aboveFold} above the fold.`,
          evidence,
        },
      ],
    };
  }
  return {
    score: 70,
    findings: [
      {
        severity: "warn",
        message: `${total} trust signal(s) present but none above the fold — surface social proof earlier.`,
        evidence,
      },
    ],
  };
}

function scoreFriction(visible: ScoredElement[]): {
  score: number;
  findings: CroFinding[];
} {
  const navAboveFold = visible.filter(
    (e) => e.aboveFold && e.category === "nav_item",
  );
  const n = navAboveFold.length;
  if (n <= 7) {
    return {
      score: 100,
      findings: [
        {
          severity: "good",
          message: `Focused navigation (${n} above-fold nav items) — minimal distraction from the primary action.`,
        },
      ],
    };
  }
  if (n <= 12) {
    return {
      score: 70,
      findings: [
        {
          severity: "warn",
          message: `${n} above-fold nav items compete with the conversion path.`,
        },
      ],
    };
  }
  return {
    score: 40,
    findings: [
      {
        severity: "warn",
        message: `Navigation overload (${n} above-fold nav items) pulls attention away from converting.`,
      },
    ],
  };
}

function scoreQuality(audit: NormalizedPageAuditLike): {
  score: number;
  findings: CroFinding[];
} {
  const total = audit.images?.total ?? 0;
  const missingAlt = audit.images?.missingAlt ?? 0;
  const h1Count = audit.headings?.h1Count ?? 0;
  const hasTitle = !!(audit.head?.title || "").trim();

  const altCoverage = total > 0 ? (total - missingAlt) / total : 1;
  const h1Ok = h1Count === 1 ? 1 : 0;
  const titleOk = hasTitle ? 1 : 0;
  const score = clamp(round((altCoverage * 0.5 + h1Ok * 0.3 + titleOk * 0.2) * 100));

  const findings: CroFinding[] = [];
  if (total > 0 && altCoverage < 0.9) {
    findings.push({
      severity: "warn",
      message: `${missingAlt}/${total} images missing alt text (${round(altCoverage * 100)}% coverage).`,
    });
  }
  if (h1Count !== 1) {
    findings.push({
      severity: "warn",
      message: `${h1Count} h1 tags (expect exactly 1).`,
    });
  }
  if (!hasTitle) {
    findings.push({ severity: "warn", message: "Missing <title>." });
  }
  if (findings.length === 0) {
    findings.push({
      severity: "good",
      message: "Clean page fundamentals (alt coverage, single h1, title present).",
    });
  }
  return { score, findings };
}

// --- public API --------------------------------------------------------------
const WEIGHTS = {
  ctaFocus: 0.25,
  visualHierarchy: 0.2,
  valueProp: 0.2,
  trust: 0.15,
  friction: 0.1,
  quality: 0.1,
} as const;

function gradeFor(overall: number): CroScore["grade"] {
  if (overall >= 90) return "A";
  if (overall >= 75) return "B";
  if (overall >= 60) return "C";
  if (overall >= 45) return "D";
  return "F";
}

export function scoreCro(golden: GoldenLike): CroScore {
  const elements = golden.collect?.elements ?? [];
  // CRO judges what the visitor sees. Hidden inventory (mega-menu, accordions)
  // is captured for completeness but excluded from on-screen scoring.
  const visible = elements.filter((e) => e.visible !== false);
  const audit = golden.pageAudit ?? {};

  const cta = scoreCtaFocus(visible);
  const hier = scoreVisualHierarchy(visible);
  const vp = scoreValueProp(audit);
  const trust = scoreTrust(audit);
  const friction = scoreFriction(visible);
  const quality = scoreQuality(audit);

  const dimensions: CroDimension[] = [
    { id: "cta-focus", label: "CTA Focus", weight: WEIGHTS.ctaFocus, ...cta },
    {
      id: "visual-hierarchy",
      label: "Visual Hierarchy",
      weight: WEIGHTS.visualHierarchy,
      ...hier,
    },
    {
      id: "value-prop",
      label: "Value Proposition",
      weight: WEIGHTS.valueProp,
      ...vp,
    },
    { id: "trust", label: "Trust Signals", weight: WEIGHTS.trust, ...trust },
    { id: "friction", label: "Friction", weight: WEIGHTS.friction, ...friction },
    { id: "quality", label: "Page Quality", weight: WEIGHTS.quality, ...quality },
  ];

  const weightSum = dimensions.reduce((s, d) => s + d.weight, 0);
  const overall = round(
    dimensions.reduce((s, d) => s + d.score * d.weight, 0) / weightSum,
  );

  return {
    extractorVersion: EXTRACTOR_VERSION,
    overall,
    grade: gradeFor(overall),
    dimensions,
  };
}
