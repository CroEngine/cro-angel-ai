import type { StreamEvent } from "./hooks/useTestStream";

export type FindingSeverity = "info" | "warn" | "error";
export type FindingCategory = "seo" | "cro" | "ux" | "interaction";

export interface Finding {
  category: FindingCategory;
  severity: FindingSeverity;
  label: string;
  detail?: string;
}

export interface PageReport {
  url: string;
  startedAt: number;
  findings: Finding[];
  rawPageAudit?: unknown;
  rawCollect?: unknown;
}

type ElementCategory =
  | "cta_primary"
  | "cta_secondary"
  | "form_submit"
  | "icon_button"
  | "nav_item"
  | "link"
  | "other";

type SectionKind = "nav" | "header" | "hero" | "cards" | "content" | "footer";

interface PageAuditLike {
  url: string;
  head: {
    title: string;
    description: string;
    canonical: string;
    lang: string;
    ogImage: string;
    ogTitle: string;
    twitterCard: string;
  };
  headings: { h1Count: number; h2Count: number; h3Count: number };
  images: { total: number; missingAlt: number; missingAltPct: number };
  links: { internal: number; external: number; total: number };
  schema: { count: number; types: string[] };
  content: { wordCount: number; sections: number };
  robotsTxt: { exists: boolean; hasSitemap: boolean };
  sitemap: { exists: boolean; urlCount: number };
  sections?: Array<{
    kind: string;
    selector: string;
    aboveFold: boolean;
    childCount: number;
    repeatedChildren: number;
    headingText: string;
  }>;
  trustSignals?: Array<{
    type: string;
    text: string;
    section: string;
    aboveFold: boolean;
    selector: string;
  }>;
  trustSummary?: {
    total: number;
    aboveFold: number;
    byType: Record<string, number>;
  };
  flags: string[];
}

interface CollectLike {
  target: string;
  count: number;
  byCategory?: Partial<Record<ElementCategory, number>>;
  summary?: {
    total: number;
    aboveFold: number;
    primaryCtaCount: number;
    competingAboveFold: number;
    topVisualWeight: Array<{ selector: string; text: string; score: number }>;
    bySection?: Partial<Record<SectionKind, number>>;
    groups?: Array<{ label: string; count: number; section: SectionKind; intent: string }>;
  };
  elements: Array<{ visible: boolean; aboveFold: boolean }>;
}

function isPageAudit(v: unknown): v is PageAuditLike {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.url === "string" && !!o.head && !!o.headings && Array.isArray(o.flags);
}

function isCollect(v: unknown): v is CollectLike {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.target === "string" && typeof o.count === "number" && Array.isArray(o.elements);
}

function urlFromSummary(summary: unknown): string | null {
  if (typeof summary !== "string") return null;
  const m = summary.match(/^goto\s+(.+)$/);
  return m ? m[1].trim() : null;
}

function seoFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  out.push(
    a.head.title
      ? { category: "seo", severity: "info", label: "Title", detail: `"${a.head.title}" (${a.head.title.length} chars)` }
      : { category: "seo", severity: "warn", label: "Title", detail: "missing" }
  );
  out.push(
    a.head.description
      ? { category: "seo", severity: "info", label: "Meta description", detail: `${a.head.description.length} chars` }
      : { category: "seo", severity: "warn", label: "Meta description", detail: "missing" }
  );
  out.push(
    a.head.canonical
      ? { category: "seo", severity: "info", label: "Canonical", detail: a.head.canonical }
      : { category: "seo", severity: "warn", label: "Canonical", detail: "missing" }
  );
  out.push({
    category: "seo",
    severity: a.head.lang ? "info" : "warn",
    label: "lang attribute",
    detail: a.head.lang || "missing",
  });
  out.push({
    category: "seo",
    severity: a.head.ogImage ? "info" : "warn",
    label: "Open Graph image",
    detail: a.head.ogImage ? "set" : "missing",
  });
  out.push({
    category: "seo",
    severity: a.headings.h1Count === 1 ? "info" : "warn",
    label: "H1",
    detail: `${a.headings.h1Count} found · h2:${a.headings.h2Count} h3:${a.headings.h3Count}`,
  });
  out.push({
    category: "seo",
    severity: a.images.missingAltPct > 10 ? "warn" : "info",
    label: "Images alt",
    detail: `${a.images.total} total, ${a.images.missingAlt} missing alt (${a.images.missingAltPct}%)`,
  });
  out.push({
    category: "seo",
    severity: "info",
    label: "Schema.org",
    detail: a.schema.count > 0 ? a.schema.types.join(", ") : "none",
  });
  out.push({
    category: "seo",
    severity: a.robotsTxt.exists ? "info" : "warn",
    label: "robots.txt",
    detail: a.robotsTxt.exists ? "found" : "missing",
  });
  out.push({
    category: "seo",
    severity: a.sitemap.exists ? "info" : "warn",
    label: "sitemap.xml",
    detail: a.sitemap.exists ? `found (${a.sitemap.urlCount} urls)` : "missing",
  });
  out.push({
    category: "seo",
    severity: "info",
    label: "Word count",
    detail: String(a.content.wordCount),
  });
  for (const f of a.flags) {
    out.push({ category: "seo", severity: "warn", label: "Flag", detail: f });
  }
  return out;
}

function croFindings(c: CollectLike): Finding[] {
  const out: Finding[] = [];
  const s = c.summary;
  if (!s) return out;
  out.push({
    category: "cro",
    severity: s.primaryCtaCount === 0 ? "warn" : "info",
    label: "Primary CTAs above fold",
    detail: String(s.primaryCtaCount),
  });
  out.push({
    category: "cro",
    severity: s.competingAboveFold >= 4 ? "warn" : "info",
    label: "Competing CTAs above fold",
    detail: String(s.competingAboveFold),
  });
  const top = s.topVisualWeight[0];
  if (top) {
    out.push({
      category: "cro",
      severity: "info",
      label: "Top visual weight",
      detail: `"${top.text || top.selector}" (${top.score})`,
    });
  }
  if (s.groups && s.groups.length > 0) {
    const summary = s.groups
      .slice(0, 4)
      .map((g) => `×${g.count} ${g.label}`)
      .join(" · ");
    out.push({ category: "cro", severity: "info", label: "Repeated controls", detail: summary });
  }
  return out;
}

function uxFindings(c: CollectLike): Finding[] {
  const out: Finding[] = [];
  const s = c.summary;
  if (s?.bySection) {
    const parts = Object.entries(s.bySection)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ");
    out.push({ category: "ux", severity: "info", label: "Sections", detail: parts });
  }
  if (s) {
    out.push({
      category: "ux",
      severity: "info",
      label: "Above fold",
      detail: `${s.aboveFold} / ${s.total} elements`,
    });
  }
  const hiddenInteractive = c.elements.filter((e) => !e.visible).length;
  if (hiddenInteractive > 0) {
    out.push({
      category: "ux",
      severity: "warn",
      label: "Hidden but interactive",
      detail: String(hiddenInteractive),
    });
  }
  return out;
}

function interactionFindings(c: CollectLike): Finding[] {
  const out: Finding[] = [];
  out.push({
    category: "interaction",
    severity: "info",
    label: `${c.count} ${c.target}`,
    detail: "captured",
  });
  if (c.byCategory) {
    const parts = Object.entries(c.byCategory)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
      .join(" · ");
    out.push({ category: "interaction", severity: "info", label: "By category", detail: parts });
  }
  return out;
}

export function buildPageReports(events: StreamEvent[]): PageReport[] {
  const reports: PageReport[] = [];
  let current: PageReport | null = null;

  for (const ev of events) {
    if (ev.type === "step_started" && ev.data.kind === "goto") {
      const url = urlFromSummary(ev.data.summary) ?? "(unknown url)";
      current = {
        url,
        startedAt: typeof ev.data.ts === "number" ? ev.data.ts : Date.now(),
        findings: [],
      };
      reports.push(current);
      continue;
    }
    if (ev.type !== "step_passed") continue;
    if (!current) {
      current = { url: "(no goto)", startedAt: Date.now(), findings: [] };
      reports.push(current);
    }
    if (ev.data.kind === "pageAudit" && isPageAudit(ev.data.data)) {
      if (current.url === "(unknown url)" || current.url === "(no goto)") current.url = ev.data.data.url;
      current.rawPageAudit = ev.data.data;
      current.findings.push(...seoFindings(ev.data.data));
    } else if (ev.data.kind === "collect" && isCollect(ev.data.data)) {
      current.rawCollect = ev.data.data;
      current.findings.push(
        ...croFindings(ev.data.data),
        ...uxFindings(ev.data.data),
        ...interactionFindings(ev.data.data),
      );
    }
  }

  return reports;
}

export function countBySeverity(report: PageReport) {
  let warns = 0;
  let checks = 0;
  for (const f of report.findings) {
    if (f.severity === "warn" || f.severity === "error") warns++;
    else checks++;
  }
  return { warns, checks };
}
