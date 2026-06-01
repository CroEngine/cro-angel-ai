// Step 2 — Interpret. Deterministic rule layer over collected page facts.
// No AI, no network, no recommendations. Pure function over PageReport[].

import type { PageReport } from "./findings";
import type { PageAuditData, CollectData, ElementIntent } from "@/lib/tests/schema";

export type Severity = "low" | "medium" | "high";
export type Category = "seo" | "cro" | "ux" | "trust";

export interface InterpretFinding {
  ruleId: string;
  category: Category;
  severity: Severity;
  title: string;
  evidence: string;
}

export interface Win {
  ruleId: string;
  category: Category;
  title: string;
}

export interface PageInterpretation {
  url: string;
  scores: { seo: number; cro: number; ux: number; trust: number; overall: number };
  findings: InterpretFinding[];
  wins: Win[];
}

const SEVERITY_WEIGHT: Record<Severity, number> = { low: 5, medium: 10, high: 20 };
const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

interface RuleCtx {
  audit: PageAuditData;
  collect?: CollectData;
}

interface RuleResult {
  evidence: string;
  severity?: Severity;
}

interface Rule {
  id: string;
  category: Category;
  severity: Severity; // default severity
  weight?: number;
  title: string;
  passTitle: string;
  evaluate: (ctx: RuleCtx) => null | RuleResult;
}

const SEO_RULES: Rule[] = [
  {
    id: "seo.title.missing",
    category: "seo",
    severity: "high",
    title: "Page title missing",
    passTitle: "Page title set",
    evaluate: ({ audit: a }) =>
      a.head.title.trim() === "" ? { evidence: "<title> is empty" } : null,
  },
  {
    id: "seo.meta.description.missing",
    category: "seo",
    severity: "medium",
    title: "Meta description missing",
    passTitle: "Meta description set",
    evaluate: ({ audit: a }) =>
      a.head.description.trim() === ""
        ? { evidence: 'meta[name="description"] is empty' }
        : null,
  },
  {
    id: "seo.h1.count",
    category: "seo",
    severity: "medium",
    title: "Page should have exactly one H1",
    passTitle: "Exactly one H1 present",
    evaluate: ({ audit: a }) =>
      a.headings.h1Count !== 1 ? { evidence: `h1Count = ${a.headings.h1Count}` } : null,
  },
  {
    id: "seo.canonical.missing",
    category: "seo",
    severity: "medium",
    title: "Canonical tag missing",
    passTitle: "Canonical tag present",
    evaluate: ({ audit: a }) =>
      !a.head.canonical || a.head.canonical.trim() === ""
        ? { evidence: 'link[rel="canonical"] not set' }
        : null,
  },
  {
    id: "seo.schema.missing",
    category: "seo",
    severity: "medium",
    title: "No structured data (schema.org) on the page",
    passTitle: "Structured data present",
    evaluate: ({ audit: a }) =>
      a.schema.count === 0 ? { evidence: "schema.count = 0" } : null,
  },
  {
    id: "seo.images.alt.coverage",
    category: "seo",
    severity: "medium",
    title: "Many images missing alt text",
    passTitle: "Image alt coverage acceptable",
    evaluate: ({ audit: a }) => {
      const pct = a.images.missingAltPct;
      if (a.images.total === 0) return null;
      if (pct > 25) return { evidence: `${pct}% of images missing alt`, severity: "high" };
      if (pct > 10) return { evidence: `${pct}% of images missing alt` };
      return null;
    },
  },
  {
    id: "seo.images.dimensions.missing",
    category: "seo",
    severity: "low",
    title: "Images missing width/height",
    passTitle: "Image dimensions set",
    evaluate: ({ audit: a }) => {
      const total = a.images.total;
      const missing = a.images.missingDims;
      if (total === 0 || missing === 0) return null;
      const pct = (missing / total) * 100;
      if (pct > 10)
        return {
          evidence: `${missing}/${total} images missing dimensions (${pct.toFixed(0)}%)`,
          severity: "medium",
        };
      return { evidence: `${missing}/${total} images missing dimensions` };
    },
  },
  {
    id: "seo.content.thin",
    category: "seo",
    severity: "medium",
    title: "Thin content",
    passTitle: "Content length sufficient",
    evaluate: ({ audit: a }) => {
      const w = a.content.wordCount;
      if (w >= 300) return null;
      if (w < 150) return { evidence: `wordCount = ${w} (<150)`, severity: "high" };
      return { evidence: `wordCount = ${w} (<300)` };
    },
  },
  {
    id: "seo.h2.missing",
    category: "seo",
    severity: "low",
    title: "No H2 headings on the page",
    passTitle: "H2 headings present",
    evaluate: ({ audit: a }) =>
      a.headings.h2Count === 0 ? { evidence: "h2Count = 0" } : null,
  },
];

const CRO_RULES: Rule[] = [
  {
    id: "cro.primaryCta.missing",
    category: "cro",
    severity: "high",
    title: "No primary CTA detected",
    passTitle: "Primary CTA detected",
    evaluate: ({ audit: a }) =>
      a.pageSummary.primaryCtaCount === 0 ? { evidence: "primaryCtaCount = 0" } : null,
  },
  {
    id: "cro.hero.headline.missing",
    category: "cro",
    severity: "high",
    title: "Hero headline missing",
    passTitle: "Hero headline present",
    evaluate: ({ audit: a }) => {
      if (!a.hero) return { evidence: "no hero section detected" };
      if (a.hero.headline.trim() === "") return { evidence: "hero headline is empty" };
      return null;
    },
  },
  {
    id: "cro.cta.competition",
    category: "cro",
    severity: "medium",
    title: "Too many competing actions above the fold",
    passTitle: "CTA competition within limits",
    evaluate: ({ audit: a, collect }) => {
      const n =
        (a.pageSummary as { competingAboveFold?: number }).competingAboveFold ??
        collect?.summary?.competingAboveFold ??
        0;
      return n > 3 ? { evidence: `${n} competing actions above fold` } : null;
    },
  },
  {
    id: "cro.hero.cta.missing",
    category: "cro",
    severity: "high",
    title: "Hero CTA missing",
    passTitle: "Hero CTA present",
    evaluate: ({ audit: a }) => {
      if (!a.hero) return null; // covered by hero.headline.missing
      return a.hero.primaryCtaText.trim() === ""
        ? { evidence: "hero has no primary CTA text" }
        : null;
    },
  },
  {
    id: "cro.cta.aboveFold.missing",
    category: "cro",
    severity: "high",
    title: "No CTA above the fold",
    passTitle: "CTA above the fold",
    evaluate: ({ audit: a }) =>
      a.pageSummary.aboveFoldCtaCount === 0
        ? { evidence: "aboveFoldCtaCount = 0" }
        : null,
  },
  {
    id: "cro.primaryCta.multipleAboveFold",
    category: "cro",
    severity: "medium",
    title: "Multiple primary CTAs above the fold",
    passTitle: "Single primary CTA above fold",
    evaluate: ({ audit: a }) => {
      const ctas = a.ctas ?? [];
      const n = ctas.filter((c) => c.category === "cta_primary" && c.aboveFold).length;
      return n > 1 ? { evidence: `${n} primary CTAs above fold` } : null;
    },
  },
  {
    id: "cro.cta.trust.distance",
    category: "cro",
    severity: "medium",
    title: "Primary CTA far from trust signals",
    passTitle: "Primary CTA near trust signal",
    evaluate: ({ audit: a }) => {
      const primaries = (a.ctas ?? []).filter((c) => c.category === "cta_primary");
      if (primaries.length === 0) return null;
      let worst = primaries[0];
      for (const c of primaries) {
        if (c.nearestTrustSignalDistance > worst.nearestTrustSignalDistance) worst = c;
      }
      const d = worst.nearestTrustSignalDistance;
      const minD = Math.min(...primaries.map((c) => c.nearestTrustSignalDistance));
      if (minD <= 600 && d !== 9999) return null;
      const label = worst.text || "(no text)";
      const dist = d === 9999 ? "no trust signal on page" : `${d}px from nearest trust signal`;
      return { evidence: `primary CTA "${label}" — ${dist}` };
    },
  },
  {
    id: "cro.form.aboveFold.missing",
    category: "cro",
    severity: "low",
    title: "No form reachable above the fold",
    passTitle: "Form reachable above fold",
    evaluate: ({ audit: a }) => {
      const forms = a.forms ?? [];
      if (forms.length === 0) return null;
      return forms.every((f) => !f.aboveFold)
        ? { evidence: `${forms.length} form(s), none above fold` }
        : null;
    },
  },
  {
    id: "cro.pricing.missing",
    category: "cro",
    severity: "low",
    title: "Pricing link in nav but no pricing section",
    passTitle: "Pricing section present",
    evaluate: ({ audit: a }) => {
      if (!a.navigation?.pricingPresent) return null;
      const has = (a.sectionOrder ?? []).includes("pricing");
      return has ? null : { evidence: "nav has pricing, no pricing section detected" };
    },
  },
];

const UX_RULES: Rule[] = [
  {
    id: "ux.hidden.interactive",
    category: "ux",
    severity: "high",
    title: "Hidden interactive elements detected",
    passTitle: "No hidden interactive elements",
    evaluate: ({ audit: a, collect }) => {
      let n: number | undefined = (a.pageSummary as { hiddenInteractive?: number })
        .hiddenInteractive;
      if (typeof n !== "number" && collect) {
        n = collect.elements.filter((e) => !e.visible).length;
      }
      if (typeof n !== "number") return null;
      return n > 0 ? { evidence: `${n} hidden interactive element(s)` } : null;
    },
  },
  {
    id: "ux.navigation.overload",
    category: "ux",
    severity: "medium",
    title: "Top navigation has too many links",
    passTitle: "Top nav within limits",
    evaluate: ({ audit: a }) => {
      const n = a.navigation?.topNavCount ?? 0;
      if (n <= 10) return null;
      if (n > 20) return { evidence: `topNavCount = ${n}`, severity: "high" };
      return { evidence: `topNavCount = ${n}` };
    },
  },
  {
    id: "ux.footer.navigation.overload",
    category: "ux",
    severity: "low",
    title: "Footer navigation has too many links",
    passTitle: "Footer nav within limits",
    evaluate: ({ audit: a }) => {
      const n = a.navigation?.footerNavCount ?? 0;
      if (n <= 40) return null;
      if (n > 60) return { evidence: `footerNavCount = ${n}`, severity: "medium" };
      return { evidence: `footerNavCount = ${n}` };
    },
  },
  {
    id: "ux.interactive.aboveFold.density",
    category: "ux",
    severity: "medium",
    title: "High interactive density above the fold",
    passTitle: "Above-fold interactive density OK",
    evaluate: ({ collect }) => {
      if (!collect?.summary) return null;
      const n = collect.summary.aboveFold;
      return n > 25 ? { evidence: `${n} interactive elements above fold` } : null;
    },
  },
  {
    id: "ux.unknown.intent.ratio",
    category: "ux",
    severity: "low",
    title: "Many interactive elements with unclassified intent",
    passTitle: "Element intent largely classified",
    evaluate: ({ collect }) => {
      if (!collect?.summary) return null;
      const total = collect.summary.total;
      if (total === 0) return null;
      const unknown =
        (collect.summary.intentBreakdown as Partial<Record<ElementIntent, number>>)
          ?.unknown ?? 0;
      const ratio = unknown / total;
      if (ratio <= 0.3) return null;
      const pct = Math.round(ratio * 100);
      if (ratio > 0.5)
        return { evidence: `${unknown}/${total} unknown intent (${pct}%)`, severity: "medium" };
      return { evidence: `${unknown}/${total} unknown intent (${pct}%)` };
    },
  },
  {
    id: "ux.lang.missing",
    category: "ux",
    severity: "low",
    title: "<html lang> attribute missing",
    passTitle: "<html lang> set",
    evaluate: ({ audit: a }) =>
      a.head.lang.trim() === "" ? { evidence: "html[lang] is empty" } : null,
  },
];

const TRUST_RULES: Rule[] = [
  {
    id: "trust.signals.none",
    category: "trust",
    severity: "high",
    title: "No trust signals on the page",
    passTitle: "Trust signals present",
    evaluate: ({ audit: a }) =>
      a.trustSummary.total === 0 ? { evidence: "trustSummary.total = 0" } : null,
  },
  {
    id: "trust.abovefold.missing",
    category: "trust",
    severity: "medium",
    title: "No trust signals above the fold",
    passTitle: "Trust signals above the fold",
    evaluate: ({ audit: a }) =>
      a.trustSummary.total > 0 && a.trustSummary.aboveFold === 0
        ? { evidence: `${a.trustSummary.total} trust signals, 0 above fold` }
        : null,
  },
  {
    id: "trust.diversity.low",
    category: "trust",
    severity: "low",
    title: "Low diversity of trust signal types",
    passTitle: "Trust signal diversity present",
    evaluate: ({ audit: a }) => {
      if (a.trustSummary.total === 0) return null;
      const types = Object.keys(a.trustSummary.byType ?? {}).length;
      return types < 2 ? { evidence: `${types} trust signal type(s)` } : null;
    },
  },
];

const ALL_RULES: Rule[] = [...SEO_RULES, ...CRO_RULES, ...UX_RULES, ...TRUST_RULES];

const CATEGORIES: Category[] = ["seo", "cro", "ux", "trust"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ruleWeight(r: Rule, effective: Severity): number {
  return r.weight ?? SEVERITY_WEIGHT[effective];
}

function isPageAudit(v: unknown): v is PageAuditData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.url === "string" &&
    !!o.head &&
    !!o.headings &&
    !!o.pageSummary &&
    !!o.trustSummary
  );
}

function isCollect(v: unknown): v is CollectData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.target === "string" && typeof o.count === "number" && Array.isArray(o.elements);
}

function interpretOne(report: PageReport): PageInterpretation | null {
  if (!isPageAudit(report.rawPageAudit)) return null;
  const ctx: RuleCtx = {
    audit: report.rawPageAudit,
    collect: isCollect(report.rawCollect) ? report.rawCollect : undefined,
  };

  const findings: InterpretFinding[] = [];
  const wins: Win[] = [];
  const triggeredWeightByCategory: Record<Category, number> = {
    seo: 0,
    cro: 0,
    ux: 0,
    trust: 0,
  };

  for (const rule of ALL_RULES) {
    const result = rule.evaluate(ctx);
    if (result === null) {
      wins.push({ ruleId: rule.id, category: rule.category, title: rule.passTitle });
    } else {
      const sev = result.severity ?? rule.severity;
      findings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: sev,
        title: rule.title,
        evidence: result.evidence,
      });
      triggeredWeightByCategory[rule.category] += ruleWeight(rule, sev);
    }
  }

  findings.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return a.ruleId.localeCompare(b.ruleId);
  });

  const scores = {
    seo: clamp(100 - triggeredWeightByCategory.seo, 0, 100),
    cro: clamp(100 - triggeredWeightByCategory.cro, 0, 100),
    ux: clamp(100 - triggeredWeightByCategory.ux, 0, 100),
    trust: clamp(100 - triggeredWeightByCategory.trust, 0, 100),
    overall: 0,
  };
  scores.overall = Math.round(
    CATEGORIES.reduce((sum, c) => sum + scores[c], 0) / CATEGORIES.length,
  );

  return { url: report.url, scores, findings, wins };
}

export function interpretReports(reports: PageReport[]): PageInterpretation[] {
  const out: PageInterpretation[] = [];
  for (const r of reports) {
    const i = interpretOne(r);
    if (i) out.push(i);
  }
  return out;
}
