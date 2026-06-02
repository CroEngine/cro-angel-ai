import type { StreamEvent } from "./hooks/useTestStream";
import type { CollectData, PageAuditData } from "@/lib/tests/schema";

export type FindingCategory = "seo" | "cro" | "trust" | "ux";

export type FindingGroup =
  // seo
  | "meta"
  | "structure"
  | "indexing"
  | "links"
  // cro
  | "hero"
  | "ctas"
  | "forms"
  // trust
  | "summary"
  | "byType"
  | "signals"
  // ux
  | "navigation"
  | "sections"
  | "hierarchy"
  | "page";

export interface Finding {
  category: FindingCategory;
  group: FindingGroup;
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

function isPageAudit(v: unknown): v is PageAuditData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.url === "string" && !!o.head && !!o.headings && Array.isArray(o.flags);
}

function isCollect(v: unknown): v is CollectData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.target === "string" && typeof o.count === "number" && Array.isArray(o.elements);
}

function urlFromSummary(summary: unknown): string | null {
  if (typeof summary !== "string") return null;
  const m = summary.match(/^goto\s+(.+)$/);
  return m ? m[1].trim() : null;
}

const f = (
  category: FindingCategory,
  group: FindingGroup,
  label: string,
  detail?: string,
): Finding => ({ category, group, label, detail });

// ---------------------------------------------------------------------------
// Human-readable formatters (presentation only)
// ---------------------------------------------------------------------------

const SECTION_LABEL: Record<string, string> = {
  header: "in header",
  hero: "in hero",
  nav: "in navigation",
  navigation: "in navigation",
  footer: "in footer",
  content: "in content",
};

const INTENT_LABEL: Record<string, string> = {
  conversion: "Conversion intent",
  navigation: "Navigation intent",
  utility: "Utility",
  social: "Social",
};

const TRUST_TYPE_LABEL: Record<string, string> = {
  customer_review: "Customer review",
  trust_badge: "Trust badge",
  aggregate_rating: "Aggregate rating",
  contact_info: "Contact info",
  certification: "Certification",
  press_mention: "Press mention",
  client_logo: "Client logo",
};

const formatSection = (s?: string): string | undefined =>
  s ? SECTION_LABEL[s] ?? `in ${s}` : undefined;

const formatIntent = (i?: string): string | undefined =>
  i ? INTENT_LABEL[i] : undefined;

const formatAboveFold = (af?: boolean): string | undefined =>
  af ? "above the fold" : undefined;

const formatCompetingCTAs = (n: number): string =>
  n === 0 ? "no competing CTAs" : n === 1 ? "1 competing CTA" : `${n} competing CTAs`;

function formatTrustDistance(px?: number): string {
  if (px == null || px >= 1500 || px === 9999) return "no trust signal nearby";
  if (px <= 200) return `trust signal nearby (${px}px)`;
  return `trust signal ${px}px away`;
}

function formatFormDistance(px?: number): string {
  if (px === 0) return "inside a form";
  if (px == null || px >= 9999) return "not near a form";
  return `form ${px}px away`;
}

const formatTrustType = (t: string): string =>
  TRUST_TYPE_LABEL[t] ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const joinBits = (...bits: Array<string | undefined | false | null>): string =>
  bits.filter((b): b is string => Boolean(b)).join(" · ");

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

function seoFindings(a: PageAuditData): Finding[] {
  return [
    // meta
    f("seo", "meta", "Title", a.head.title ? `"${a.head.title}" (${a.head.title.length} chars)` : "not set"),
    f("seo", "meta", "Meta description", a.head.description ? `${a.head.description.length} chars` : "not set"),
    f("seo", "meta", "Canonical", a.head.canonical || "not set"),
    f("seo", "meta", "lang attribute", a.head.lang || "not set"),
    f("seo", "meta", "Open Graph image", a.head.ogImage ? "set" : "not set"),
    f("seo", "meta", "Schema.org", a.schema.count > 0 ? a.schema.types.join(", ") : "none"),
    // structure
    f("seo", "structure", "Headings", `h1:${a.headings.h1Count} · h2:${a.headings.h2Count} · h3:${a.headings.h3Count}`),
    f("seo", "structure", "Word count", String(a.content.wordCount)),
    // indexing
    f("seo", "indexing", "robots.txt", a.robotsTxt.exists ? "found" : "not found"),
    f("seo", "indexing", "sitemap.xml", a.sitemap.exists ? `found (${a.sitemap.urlCount} urls)` : "not found"),
    // links
    f("seo", "links", "Links", `${a.links.total} total · internal ${a.links.internal} · external ${a.links.external}`),
    f("seo", "links", "Images alt", `${a.images.total} total · ${a.images.missingAlt} missing alt (${a.images.missingAltPct}%)`),
  ];
}

// ---------------------------------------------------------------------------
// CRO — hero / ctas / forms
// ---------------------------------------------------------------------------

function heroFindings(a: PageAuditData): Finding[] {
  const h = a.hero;
  if (!h) return [];
  const out: Finding[] = [];
  if (h.headline) out.push(f("cro", "hero", "Hero headline", `"${h.headline}"`));
  if (h.subheadline) out.push(f("cro", "hero", "Hero subheadline", `"${h.subheadline}"`));
  if (h.primaryCtaText) {
    out.push(
      f(
        "cro",
        "hero",
        "Hero primary CTA",
        joinBits(
          `"${h.primaryCtaText}"`,
          formatIntent(h.primaryCtaIntent),
          formatAboveFold(h.aboveFold),
        ),
      ),
    );
  }
  return out;
}

function ctaFindings(a: PageAuditData, c?: CollectData): Finding[] {
  const out: Finding[] = [];
  const ctas = a.ctas ?? [];
  const ps = a.pageSummary;
  if (ctas.length > 0 && ps) {
    out.push(
      f(
        "cro",
        "ctas",
        "CTAs total",
        `${ctas.length} CTAs · ${ps.primaryCtaCount} primary · ${ps.secondaryCtaCount} secondary · ${ps.aboveFoldCtaCount} above the fold`,
      ),
    );
  }
  const s = c?.summary;
  if (s) {
    out.push(
      f(
        "cro",
        "ctas",
        "Competing CTAs above the fold",
        s.competingAboveFold === 0
          ? "None"
          : `${s.competingAboveFold} CTAs compete above the fold`,
      ),
    );
    const top = s.topVisualWeight[0];
    if (top) {
      out.push(f("cro", "ctas", "Top visual weight", `"${top.text || top.selector}" (${top.score})`));
    }
  }
  for (const c2 of ctas.filter((x) => x.category === "cta_primary").slice(0, 6)) {
    out.push(
      f(
        "cro",
        "ctas",
        `"${c2.text || "(no text)"}"`,
        joinBits(
          formatSection(c2.section),
          formatAboveFold(c2.aboveFold),
          formatIntent(c2.intent),
          formatCompetingCTAs(c2.competingActions),
          formatTrustDistance(c2.nearestTrustSignalDistance),
          formatFormDistance(c2.nearestFormDistance),
        ),
      ),
    );
  }
  return out;
}

function formFindings(a: PageAuditData): Finding[] {
  const out: Finding[] = [];
  const forms = a.forms ?? [];
  if (forms.length === 0) return out;
  out.push(f("cro", "forms", "Forms", `${forms.length} on page`));
  for (const fm of forms.slice(0, 4)) {
    const bits = [`${fm.fieldCount} fields`, `${fm.requiredFields} required`];
    if (fm.multiStep) bits.push("multi-step");
    if (fm.containsEmail) bits.push("email");
    if (fm.containsPhone) bits.push("phone");
    if (fm.containsCompany) bits.push("company");
    if (fm.containsPassword) bits.push("password");
    if (fm.containsCreditCard) bits.push("card");
    if (fm.submitText) bits.push(`"${fm.submitText}"`);
    const label = `Form ${formatSection(fm.section) ?? ""}${fm.aboveFold ? " (above the fold)" : ""}`.trim();
    out.push(f("cro", "forms", label, bits.join(" · ")));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

function trustFindings(a: PageAuditData): Finding[] {
  const out: Finding[] = [];
  const sum = a.trustSummary;
  const signals = a.trustSignals ?? [];
  if (!sum) return out;

  // summary
  out.push(f("trust", "summary", "Trust signals", `${sum.total} total · ${sum.aboveFold} above fold`));
  const ps = a.pageSummary;
  if (ps && (ps.averageRating > 0 || ps.reviewCount > 0)) {
    const bits: string[] = [];
    if (ps.averageRating > 0) bits.push(`★ ${ps.averageRating}/5`);
    if (ps.reviewCount > 0) bits.push(`${ps.reviewCount} reviews`);
    out.push(f("trust", "summary", "Aggregate rating", bits.join(" · ")));
  }

  // byType
  const byType = Object.entries(sum.byType).sort((a, b) => b[1] - a[1]);
  if (byType.length > 0) {
    out.push(
      f(
        "trust",
        "byType",
        "By type",
        byType.map(([k, v]) => `${formatTrustType(k)} ×${v}`).join(" · "),
      ),
    );
  }
  const brands = new Set<string>();
  for (const s of signals) {
    if (s.recognizedBrands) for (const b of s.recognizedBrands) brands.add(b);
  }
  if (brands.size > 0) {
    out.push(f("trust", "byType", "Recognized brands", Array.from(brands).slice(0, 10).join(", ")));
  }
  out.push(f("trust", "byType", "Contact info signals", String(sum.byType["contact_info"] ?? 0)));

  // signals
  for (const s of signals.slice(0, 5)) {
    const extras: string[] = [];
    if (s.personName) extras.push(s.personName);
    if (s.company) extras.push(s.company);
    if (s.rating) extras.push(`★ ${s.rating}`);
    if (s.reviewSource) extras.push(s.reviewSource);
    out.push(
      f(
        "trust",
        "signals",
        formatTrustType(s.type),
        joinBits(
          formatSection(s.section),
          formatAboveFold(s.aboveFold),
          extras.length ? extras.join(" / ") : undefined,
          `"${s.text.slice(0, 60)}"`,
        ),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// UX
// ---------------------------------------------------------------------------

function navigationFindings(a: PageAuditData): Finding[] {
  const out: Finding[] = [];
  const n = a.navigation;
  if (!n) return out;
  out.push(f("ux", "navigation", "Top nav links", String(n.topNavCount)));
  out.push(f("ux", "navigation", "Footer nav links", String(n.footerNavCount)));
  const entries: Array<[string, boolean]> = [
    ["login", n.loginPresent],
    ["pricing", n.pricingPresent],
    ["contact", n.contactPresent],
    ["blog", n.blogPresent],
    ["docs", n.docsPresent],
  ];
  out.push(
    f(
      "ux",
      "navigation",
      "Nav entries",
      entries.map(([k, v]) => `${k}: ${v ? "present" : "absent"}`).join(" · "),
    ),
  );
  return out;
}

function structureFindings(a: PageAuditData, c?: CollectData): Finding[] {
  const out: Finding[] = [];
  const sections = a.sections ?? [];
  const s = c?.summary;

  if (a.sectionOrder && a.sectionOrder.length > 0) {
    out.push(f("ux", "sections", "Section order", a.sectionOrder.join(" → ")));
  }

  if (sections.length > 0) {
    const typeCounts: Record<string, number> = {};
    for (const s2 of sections) {
      const t = s2.type || s2.kind || "content";
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    }
    out.push(
      f(
        "ux",
        "sections",
        "Sections detected",
        Object.entries(typeCounts).map(([k, v]) => `${k} ${v}`).join(" · "),
      ),
    );
  }

  if (s) {
    out.push(f("ux", "sections", "Above fold", `${s.aboveFold} / ${s.total} elements`));
    if (s.bySection) {
      out.push(
        f(
          "ux",
          "sections",
          "Elements by section",
          Object.entries(s.bySection)
            .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
            .map(([k, v]) => `${k} ${v}`)
            .join(" · "),
        ),
      );
    }
  }

  for (const s2 of sections.slice(0, 12)) {
    const t = s2.type || s2.kind || "?";
    const bits: string[] = [t];
    if (s2.aboveFold) bits.push("above fold");
    if (s2.heightPx) bits.push(`${s2.heightPx}px`);
    if (s2.containsPrimaryCTA) bits.push("CTA");
    if (s2.containsForm) bits.push("form");
    if (s2.containsTrustSignals) bits.push("trust");
    if (s2.repeatedChildren && s2.repeatedChildren >= 3) bits.push(`×${s2.repeatedChildren} repeated`);
    const heading = s2.heading || s2.headingText;
    if (heading) bits.push(`"${heading.slice(0, 50)}"`);
    out.push(f("ux", "sections", s2.id || s2.selector || t, bits.join(" · ")));
  }
  return out;
}

function hierarchyFindings(a: PageAuditData): Finding[] {
  const out: Finding[] = [];
  const hier = a.visualHierarchy ?? [];
  if (hier.length === 0) return out;
  for (let i = 0; i < Math.min(5, hier.length); i++) {
    const h = hier[i];
    out.push(
      f(
        "ux",
        "hierarchy",
        `#${i + 1} ${h.role}`,
        `weight ${h.visualWeight} · ${h.section}${h.aboveFold ? " · af" : ""} · "${h.text.slice(0, 60)}"`,
      ),
    );
  }
  return out;
}

function pageSummaryFindings(a: PageAuditData, c?: CollectData): Finding[] {
  const out: Finding[] = [];
  const ps = a.pageSummary;
  if (ps) {
    out.push(
      f(
        "ux",
        "page",
        "Page summary",
        `${ps.sectionCount} sections · ${ps.trustSignalCount} trust · ${ps.testimonialCount} testimonials · ${ps.logoCount} logos · ${ps.formCount} forms · ${ps.navigationLinks} nav links`,
      ),
    );
  }
  if (c) {
    const hiddenInteractive = c.elements.filter((e) => !e.visible).length;
    out.push(f("ux", "page", "Hidden interactive elements", String(hiddenInteractive)));
    const s = c.summary;
    if (s?.groups && s.groups.length > 0) {
      out.push(
        f(
          "ux",
          "page",
          "Repeated controls",
          s.groups.slice(0, 4).map((g) => `×${g.count} ${g.label}`).join(" · "),
        ),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildAllFindings(a: PageAuditData, c?: CollectData): Finding[] {
  return [
    ...seoFindings(a),
    ...heroFindings(a),
    ...ctaFindings(a, c),
    ...formFindings(a),
    ...trustFindings(a),
    ...navigationFindings(a),
    ...structureFindings(a, c),
    ...hierarchyFindings(a),
    ...pageSummaryFindings(a, c),
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
    } else if (ev.data.kind === "collect" && isCollect(ev.data.data)) {
      current.rawCollect = ev.data.data;
    }
  }

  // Rebuild findings per page from final audit + collect to avoid duplicates
  // when both events arrive in different orders.
  for (const r of reports) {
    const a = isPageAudit(r.rawPageAudit) ? r.rawPageAudit : null;
    const c = isCollect(r.rawCollect) ? r.rawCollect : undefined;
    if (a) r.findings = buildAllFindings(a, c);
  }

  return reports;
}
