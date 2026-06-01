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

interface PageSectionLike {
  id?: string;
  type?: string;
  kind?: string;
  position?: number;
  heading?: string;
  subheading?: string;
  aboveFold?: boolean;
  heightPx?: number;
  visualWeight?: number;
  elementCount?: number;
  childCount?: number;
  repeatedChildren?: number;
  headingText?: string;
  containsPrimaryCTA?: boolean;
  containsTrustSignals?: boolean;
  containsForm?: boolean;
  containsPricing?: boolean;
  containsNavigation?: boolean;
  selector?: string;
}

interface TrustSignalLike {
  type: string;
  text: string;
  section: string;
  aboveFold: boolean;
  selector: string;
  rating?: number;
  reviewCount?: number;
  reviewSource?: string;
  logoCount?: number;
  recognizedBrands?: string[];
  personName?: string;
  company?: string;
}

interface CTALike {
  text: string;
  intent: string;
  category: string;
  section: string;
  aboveFold: boolean;
  competingActions: number;
  nearestTrustSignalDistance: number;
  nearestFormDistance: number;
}

interface FormLike {
  section: string;
  aboveFold: boolean;
  fieldCount: number;
  requiredFields: number;
  containsEmail: boolean;
  containsPhone: boolean;
  containsCompany: boolean;
  containsPassword: boolean;
  containsCreditCard: boolean;
  multiStep: boolean;
  submitText: string;
}

interface NavigationLike {
  topNavCount: number;
  footerNavCount: number;
  loginPresent: boolean;
  pricingPresent: boolean;
  contactPresent: boolean;
  blogPresent: boolean;
  docsPresent: boolean;
}

interface VisualHierarchyLike {
  selector: string;
  text: string;
  role: string;
  visualWeight: number;
  section: string;
  aboveFold: boolean;
}

interface PageSummaryLike {
  primaryCtaCount: number;
  secondaryCtaCount: number;
  aboveFoldCtaCount: number;
  aboveFoldTrustCount: number;
  trustSignalCount: number;
  testimonialCount: number;
  logoCount: number;
  reviewCount: number;
  averageRating: number;
  formCount: number;
  navigationLinks: number;
  sectionCount: number;
}

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
  sections?: PageSectionLike[];
  sectionOrder?: string[];
  trustSignals?: TrustSignalLike[];
  trustSummary?: {
    total: number;
    aboveFold: number;
    byType: Record<string, number>;
  };
  ctas?: CTALike[];
  forms?: FormLike[];
  navigation?: NavigationLike;
  visualHierarchy?: VisualHierarchyLike[];
  pageSummary?: PageSummaryLike;
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

function structureFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const sections = a.sections ?? [];
  if (sections.length === 0) return out;

  if (a.sectionOrder && a.sectionOrder.length > 0) {
    out.push({
      category: "ux",
      severity: "info",
      label: "Section order",
      detail: a.sectionOrder.join(" → "),
    });
  }

  const typeCounts: Record<string, number> = {};
  for (const s of sections) {
    const t = s.type || s.kind || "content";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  out.push({
    category: "ux",
    severity: "info",
    label: "Sections detected",
    detail: Object.entries(typeCounts).map(([k, v]) => `${k} ${v}`).join(" · "),
  });

  for (const s of sections.slice(0, 12)) {
    const t = s.type || s.kind || "?";
    const bits = [t];
    if (s.aboveFold) bits.push("above fold");
    if (s.heightPx) bits.push(`${s.heightPx}px`);
    if (s.containsPrimaryCTA) bits.push("CTA");
    if (s.containsForm) bits.push("form");
    if (s.containsTrustSignals) bits.push("trust");
    if (s.repeatedChildren && s.repeatedChildren >= 3) bits.push(`×${s.repeatedChildren} repeated`);
    const heading = s.heading || s.headingText;
    if (heading) bits.push(`"${heading.slice(0, 50)}"`);
    out.push({
      category: "ux",
      severity: "info",
      label: s.id || s.selector || t,
      detail: bits.join(" · "),
    });
  }
  return out;
}

function trustFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const sum = a.trustSummary;
  const signals = a.trustSignals ?? [];
  if (!sum) return out;

  if (sum.total === 0) {
    out.push({ category: "cro", severity: "warn", label: "Trust signals", detail: "none detected" });
    return out;
  }

  out.push({
    category: "cro",
    severity: "info",
    label: "Trust signals",
    detail: `${sum.total} total · ${sum.aboveFold} above fold`,
  });

  if (sum.aboveFold === 0) {
    out.push({ category: "cro", severity: "warn", label: "Trust above fold", detail: "none — first impression lacks proof" });
  }

  const byType = Object.entries(sum.byType).sort((a, b) => b[1] - a[1]);
  if (byType.length > 0) {
    out.push({
      category: "cro",
      severity: "info",
      label: "By type",
      detail: byType.map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(" · "),
    });
  }

  // Aggregate review/rating
  const ps = a.pageSummary;
  if (ps && (ps.averageRating > 0 || ps.reviewCount > 0)) {
    const bits = [];
    if (ps.averageRating > 0) bits.push(`★ ${ps.averageRating}/5`);
    if (ps.reviewCount > 0) bits.push(`${ps.reviewCount} reviews`);
    out.push({ category: "cro", severity: "info", label: "Aggregate rating", detail: bits.join(" · ") });
  }

  // Recognized brands
  const brands = new Set<string>();
  for (const s of signals) {
    if (s.recognizedBrands) for (const b of s.recognizedBrands) brands.add(b);
  }
  if (brands.size > 0) {
    out.push({
      category: "cro",
      severity: "info",
      label: "Recognized brands",
      detail: Array.from(brands).slice(0, 10).join(", "),
    });
  }

  if (!sum.byType["contact_info"]) {
    out.push({ category: "cro", severity: "warn", label: "Contact info", detail: "no tel/email/address found" });
  }

  for (const s of signals.slice(0, 5)) {
    const extras: string[] = [];
    if (s.personName) extras.push(s.personName);
    if (s.company) extras.push(s.company);
    if (s.rating) extras.push(`★ ${s.rating}`);
    if (s.reviewSource) extras.push(s.reviewSource);
    out.push({
      category: "cro",
      severity: "info",
      label: s.type.replace(/_/g, " "),
      detail: `${s.section}${s.aboveFold ? " · above fold" : ""}${extras.length ? " · " + extras.join(" / ") : ""} · "${s.text.slice(0, 60)}"`,
    });
  }
  return out;
}

function ctaFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const ctas = a.ctas ?? [];
  if (ctas.length === 0) return out;
  const ps = a.pageSummary;
  if (ps) {
    out.push({
      category: "cro",
      severity: ps.primaryCtaCount === 0 ? "warn" : "info",
      label: "CTAs total",
      detail: `${ctas.length} · primary ${ps.primaryCtaCount} · secondary ${ps.secondaryCtaCount} · ${ps.aboveFoldCtaCount} above fold`,
    });
  }
  const orphan = ctas.filter((c) => c.category === "cta_primary" && c.nearestTrustSignalDistance > 400);
  if (orphan.length > 0) {
    out.push({
      category: "cro",
      severity: "warn",
      label: "Primary CTAs without nearby trust",
      detail: `${orphan.length} (>400px to nearest trust signal)`,
    });
  }
  const highCompetition = ctas.filter((c) => c.category === "cta_primary" && c.competingActions >= 4);
  if (highCompetition.length > 0) {
    out.push({
      category: "cro",
      severity: "warn",
      label: "High CTA competition",
      detail: `${highCompetition.length} primary CTA(s) with ≥4 competing actions in same section`,
    });
  }
  for (const c of ctas.filter((x) => x.category === "cta_primary").slice(0, 4)) {
    out.push({
      category: "cro",
      severity: "info",
      label: `"${c.text || "(no text)"}"`,
      detail: `${c.section}${c.aboveFold ? " · af" : ""} · ${c.intent} · competing ${c.competingActions} · trust ${c.nearestTrustSignalDistance}px · form ${c.nearestFormDistance === 0 ? "in" : c.nearestFormDistance + "px"}`,
    });
  }
  return out;
}

function formFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const forms = a.forms ?? [];
  if (forms.length === 0) return out;
  out.push({
    category: "cro",
    severity: "info",
    label: "Forms",
    detail: `${forms.length} on page`,
  });
  for (const f of forms.slice(0, 4)) {
    const friction = f.requiredFields >= 6 ? "warn" : "info";
    const bits = [`${f.fieldCount} fields`, `${f.requiredFields} required`];
    if (f.multiStep) bits.push("multi-step");
    if (f.containsPhone) bits.push("phone");
    if (f.containsCompany) bits.push("company");
    if (f.containsCreditCard) bits.push("card");
    if (f.submitText) bits.push(`"${f.submitText}"`);
    out.push({
      category: "cro",
      severity: friction,
      label: `Form (${f.section}${f.aboveFold ? " · af" : ""})`,
      detail: bits.join(" · "),
    });
  }
  return out;
}

function navigationFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const n = a.navigation;
  if (!n) return out;
  out.push({
    category: "ux",
    severity: n.topNavCount > 9 ? "warn" : "info",
    label: "Top nav links",
    detail: `${n.topNavCount}${n.topNavCount > 9 ? " (consider trimming — choice overload)" : ""}`,
  });
  out.push({
    category: "ux",
    severity: "info",
    label: "Footer nav links",
    detail: String(n.footerNavCount),
  });
  const missing: string[] = [];
  if (!n.pricingPresent) missing.push("pricing");
  if (!n.contactPresent) missing.push("contact");
  if (missing.length > 0) {
    out.push({ category: "ux", severity: "warn", label: "Missing nav essentials", detail: missing.join(", ") });
  }
  const present: string[] = [];
  if (n.loginPresent) present.push("login");
  if (n.blogPresent) present.push("blog");
  if (n.docsPresent) present.push("docs");
  if (present.length > 0) {
    out.push({ category: "ux", severity: "info", label: "Nav features", detail: present.join(", ") });
  }
  return out;
}

function hierarchyFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const hier = a.visualHierarchy ?? [];
  if (hier.length === 0) return out;
  for (const h of hier.slice(0, 3)) {
    out.push({
      category: "ux",
      severity: "info",
      label: `#${hier.indexOf(h) + 1} ${h.role}`,
      detail: `weight ${h.visualWeight} · ${h.section}${h.aboveFold ? " · af" : ""} · "${h.text.slice(0, 60)}"`,
    });
  }
  const top5 = hier.slice(0, 5);
  const hasCta = top5.some((h) => h.role === "button" || h.role === "link");
  if (!hasCta) {
    out.push({
      category: "ux",
      severity: "warn",
      label: "Top 5 visual hierarchy",
      detail: "no CTA in top 5 — primary action lacks visual prominence",
    });
  }
  return out;
}

function pageSummaryFindings(a: PageAuditLike): Finding[] {
  const ps = a.pageSummary;
  if (!ps) return [];
  return [
    {
      category: "interaction",
      severity: "info",
      label: "Page summary",
      detail: `${ps.sectionCount} sections · ${ps.trustSignalCount} trust · ${ps.testimonialCount} testimonials · ${ps.logoCount} logos · ${ps.formCount} forms · ${ps.navigationLinks} nav links`,
    },
  ];
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
      current.findings.push(
        ...seoFindings(ev.data.data),
        ...structureFindings(ev.data.data),
        ...navigationFindings(ev.data.data),
        ...hierarchyFindings(ev.data.data),
        ...trustFindings(ev.data.data),
        ...ctaFindings(ev.data.data),
        ...formFindings(ev.data.data),
        ...pageSummaryFindings(ev.data.data),
      );
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
