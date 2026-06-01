// Step 2 — Interpret. Deterministic rule layer over collected page facts.
// No AI, no network, no recommendations. Pure function over PageReport[].
//
// Input:  PageReport[] (from buildPageReports)
// Output: PageInterpretation[] — scores + findings + wins per URL.

import type { PageReport } from "./findings";
import type { PageAuditData } from "@/lib/tests/schema";

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

interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  weight?: number; // defaults to SEVERITY_WEIGHT[severity]
  title: string;
  evaluate: (audit: PageAuditData) => null | { evidence: string };
}

const SEO_RULES: Rule[] = [
  {
    id: "seo.title.missing",
    category: "seo",
    severity: "high",
    title: "Page title missing",
    evaluate: (a) => (a.head.title.trim() === "" ? { evidence: "<title> is empty" } : null),
  },
  {
    id: "seo.meta.description.missing",
    category: "seo",
    severity: "medium",
    title: "Meta description missing",
    evaluate: (a) =>
      a.head.description.trim() === "" ? { evidence: 'meta[name="description"] is empty' } : null,
  },
  {
    id: "seo.h1.count",
    category: "seo",
    severity: "medium",
    title: "Page should have exactly one H1",
    evaluate: (a) =>
      a.headings.h1Count !== 1 ? { evidence: `h1Count = ${a.headings.h1Count}` } : null,
  },
];

const CRO_RULES: Rule[] = [
  {
    id: "cro.primaryCta.missing",
    category: "cro",
    severity: "high",
    title: "No primary CTA detected",
    evaluate: (a) =>
      a.pageSummary.primaryCtaCount === 0 ? { evidence: "primaryCtaCount = 0" } : null,
  },
  {
    id: "cro.hero.headline.missing",
    category: "cro",
    severity: "high",
    title: "Hero headline missing",
    evaluate: (a) => {
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
    evaluate: (a) => {
      const n = (a.pageSummary as { competingAboveFold?: number }).competingAboveFold ?? 0;
      return n > 3 ? { evidence: `${n} competing actions above fold` } : null;
    },
  },
];

const UX_RULES: Rule[] = [
  {
    id: "ux.hidden.interactive",
    category: "ux",
    severity: "high",
    title: "Hidden interactive elements detected",
    evaluate: (a) => {
      const n = (a.pageSummary as { hiddenInteractive?: number }).hiddenInteractive;
      if (typeof n !== "number") return null; // field unavailable → skip
      return n > 0 ? { evidence: `${n} hidden interactive element(s)` } : null;
    },
  },
  {
    id: "ux.abovefold.ratio",
    category: "ux",
    severity: "medium",
    title: "Fold occupies a small share of the page",
    evaluate: (a) => {
      const { foldHeightPx, pageHeightPx } = a.pageSummary;
      if (!pageHeightPx || !foldHeightPx) return null;
      const ratio = foldHeightPx / pageHeightPx;
      return ratio < 0.3
        ? { evidence: `fold/page ratio = ${ratio.toFixed(2)} (<0.30)` }
        : null;
    },
  },
];

const TRUST_RULES: Rule[] = [
  {
    id: "trust.signals.none",
    category: "trust",
    severity: "high",
    title: "No trust signals on the page",
    evaluate: (a) =>
      a.trustSummary.total === 0 ? { evidence: "trustSummary.total = 0" } : null,
  },
  {
    id: "trust.abovefold.missing",
    category: "trust",
    severity: "medium",
    title: "No trust signals above the fold",
    evaluate: (a) =>
      a.trustSummary.total > 0 && a.trustSummary.aboveFold === 0
        ? { evidence: `${a.trustSummary.total} trust signals, 0 above fold` }
        : null,
  },
];

const ALL_RULES: Rule[] = [...SEO_RULES, ...CRO_RULES, ...UX_RULES, ...TRUST_RULES];

const CATEGORIES: Category[] = ["seo", "cro", "ux", "trust"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ruleWeight(r: Rule): number {
  return r.weight ?? SEVERITY_WEIGHT[r.severity];
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

function interpretOne(report: PageReport): PageInterpretation | null {
  if (!isPageAudit(report.rawPageAudit)) return null;
  const audit = report.rawPageAudit;

  const findings: InterpretFinding[] = [];
  const wins: Win[] = [];
  const triggeredWeightByCategory: Record<Category, number> = {
    seo: 0,
    cro: 0,
    ux: 0,
    trust: 0,
  };

  for (const rule of ALL_RULES) {
    const result = rule.evaluate(audit);
    if (result === null) {
      wins.push({ ruleId: rule.id, category: rule.category, title: rule.title });
    } else {
      findings.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        evidence: result.evidence,
      });
      triggeredWeightByCategory[rule.category] += ruleWeight(rule);
    }
  }

  findings.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    const ruleA = ALL_RULES.find((r) => r.id === a.ruleId)!;
    const ruleB = ALL_RULES.find((r) => r.id === b.ruleId)!;
    const w = ruleWeight(ruleB) - ruleWeight(ruleA);
    if (w !== 0) return w;
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
