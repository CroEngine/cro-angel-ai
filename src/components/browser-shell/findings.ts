import type { StreamEvent } from "./hooks/useTestStream";
import type { CollectData, PageAuditData } from "@/lib/tests/schema";

export type FindingCategory = "seo" | "cro" | "ux" | "interaction";

export interface Finding {
  category: FindingCategory;
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

const f = (category: FindingCategory, label: string, detail?: string): Finding => ({
  category,
  label,
  detail,
});

function seoFindings(a: PageAuditLike): Finding[] {
  return [
    f("seo", "Title", a.head.title ? `"${a.head.title}" (${a.head.title.length} chars)` : "not set"),
    f("seo", "Meta description", a.head.description ? `${a.head.description.length} chars` : "not set"),
    f("seo", "Canonical", a.head.canonical || "not set"),
    f("seo", "lang attribute", a.head.lang || "not set"),
    f("seo", "Open Graph image", a.head.ogImage ? "set" : "not set"),
    f("seo", "Headings", `h1:${a.headings.h1Count} · h2:${a.headings.h2Count} · h3:${a.headings.h3Count}`),
    f("seo", "Images alt", `${a.images.total} total · ${a.images.missingAlt} missing alt (${a.images.missingAltPct}%)`),
    f("seo", "Schema.org", a.schema.count > 0 ? a.schema.types.join(", ") : "none"),
    f("seo", "robots.txt", a.robotsTxt.exists ? "found" : "not found"),
    f("seo", "sitemap.xml", a.sitemap.exists ? `found (${a.sitemap.urlCount} urls)` : "not found"),
    f("seo", "Word count", String(a.content.wordCount)),
    f("seo", "Links", `${a.links.total} total · internal ${a.links.internal} · external ${a.links.external}`),
  ];
}

function croFindings(c: CollectLike): Finding[] {
  const out: Finding[] = [];
  const s = c.summary;
  if (!s) return out;
  out.push(f("cro", "Primary CTAs above fold", String(s.primaryCtaCount)));
  out.push(f("cro", "Competing CTAs above fold", String(s.competingAboveFold)));
  const top = s.topVisualWeight[0];
  if (top) {
    out.push(f("cro", "Top visual weight", `"${top.text || top.selector}" (${top.score})`));
  }
  if (s.groups && s.groups.length > 0) {
    out.push(
      f(
        "cro",
        "Repeated controls",
        s.groups.slice(0, 4).map((g) => `×${g.count} ${g.label}`).join(" · "),
      ),
    );
  }
  return out;
}

function uxFindings(c: CollectLike): Finding[] {
  const out: Finding[] = [];
  const s = c.summary;
  if (s?.bySection) {
    out.push(
      f(
        "ux",
        "Elements by section",
        Object.entries(s.bySection)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .map(([k, v]) => `${k} ${v}`)
          .join(" · "),
      ),
    );
  }
  if (s) {
    out.push(f("ux", "Above fold", `${s.aboveFold} / ${s.total} elements`));
  }
  const hiddenInteractive = c.elements.filter((e) => !e.visible).length;
  out.push(f("ux", "Hidden interactive elements", String(hiddenInteractive)));
  return out;
}

function interactionFindings(c: CollectLike): Finding[] {
  const out: Finding[] = [];
  out.push(f("interaction", `${c.count} ${c.target}`, "captured"));
  if (c.byCategory) {
    out.push(
      f(
        "interaction",
        "By category",
        Object.entries(c.byCategory)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
          .join(" · "),
      ),
    );
  }
  return out;
}

function structureFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const sections = a.sections ?? [];
  if (sections.length === 0) return out;

  if (a.sectionOrder && a.sectionOrder.length > 0) {
    out.push(f("ux", "Section order", a.sectionOrder.join(" → ")));
  }

  const typeCounts: Record<string, number> = {};
  for (const s of sections) {
    const t = s.type || s.kind || "content";
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }
  out.push(
    f(
      "ux",
      "Sections detected",
      Object.entries(typeCounts).map(([k, v]) => `${k} ${v}`).join(" · "),
    ),
  );

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
    out.push(f("ux", s.id || s.selector || t, bits.join(" · ")));
  }
  return out;
}

function heroFindings(a: PageAuditLike): Finding[] {
  const h = a.hero;
  if (!h) return [];
  const out: Finding[] = [];
  if (h.headline) out.push(f("cro", "Hero headline", `"${h.headline}"`));
  if (h.subheadline) out.push(f("cro", "Hero subheadline", `"${h.subheadline}"`));
  if (h.primaryCtaText) {
    out.push(
      f(
        "cro",
        "Hero primary CTA",
        `"${h.primaryCtaText}"${h.primaryCtaIntent ? " · " + h.primaryCtaIntent : ""}${h.aboveFold ? " · above fold" : ""}`,
      ),
    );
  }
  return out;
}

function trustFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const sum = a.trustSummary;
  const signals = a.trustSignals ?? [];
  if (!sum) return out;

  out.push(f("cro", "Trust signals", `${sum.total} total · ${sum.aboveFold} above fold`));

  const byType = Object.entries(sum.byType).sort((a, b) => b[1] - a[1]);
  if (byType.length > 0) {
    out.push(
      f(
        "cro",
        "By type",
        byType.map(([k, v]) => `${k.replace(/_/g, " ")} ×${v}`).join(" · "),
      ),
    );
  }

  const ps = a.pageSummary;
  if (ps && (ps.averageRating > 0 || ps.reviewCount > 0)) {
    const bits: string[] = [];
    if (ps.averageRating > 0) bits.push(`★ ${ps.averageRating}/5`);
    if (ps.reviewCount > 0) bits.push(`${ps.reviewCount} reviews`);
    out.push(f("cro", "Aggregate rating", bits.join(" · ")));
  }

  const brands = new Set<string>();
  for (const s of signals) {
    if (s.recognizedBrands) for (const b of s.recognizedBrands) brands.add(b);
  }
  if (brands.size > 0) {
    out.push(f("cro", "Recognized brands", Array.from(brands).slice(0, 10).join(", ")));
  }

  out.push(f("cro", "Contact info signals", String(sum.byType["contact_info"] ?? 0)));

  for (const s of signals.slice(0, 5)) {
    const extras: string[] = [];
    if (s.personName) extras.push(s.personName);
    if (s.company) extras.push(s.company);
    if (s.rating) extras.push(`★ ${s.rating}`);
    if (s.reviewSource) extras.push(s.reviewSource);
    out.push(
      f(
        "cro",
        s.type.replace(/_/g, " "),
        `${s.section}${s.aboveFold ? " · above fold" : ""}${extras.length ? " · " + extras.join(" / ") : ""} · "${s.text.slice(0, 60)}"`,
      ),
    );
  }
  return out;
}

function ctaFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const ctas = a.ctas ?? [];
  if (ctas.length === 0) return out;
  const ps = a.pageSummary;
  if (ps) {
    out.push(
      f(
        "cro",
        "CTAs total",
        `${ctas.length} · primary ${ps.primaryCtaCount} · secondary ${ps.secondaryCtaCount} · ${ps.aboveFoldCtaCount} above fold`,
      ),
    );
  }
  for (const c of ctas.filter((x) => x.category === "cta_primary").slice(0, 6)) {
    out.push(
      f(
        "cro",
        `"${c.text || "(no text)"}"`,
        `${c.section}${c.aboveFold ? " · af" : ""} · ${c.intent} · competing ${c.competingActions} · trust ${c.nearestTrustSignalDistance}px · form ${c.nearestFormDistance === 0 ? "in" : c.nearestFormDistance + "px"}`,
      ),
    );
  }
  return out;
}

function formFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const forms = a.forms ?? [];
  if (forms.length === 0) return out;
  out.push(f("cro", "Forms", `${forms.length} on page`));
  for (const fm of forms.slice(0, 4)) {
    const bits = [`${fm.fieldCount} fields`, `${fm.requiredFields} required`];
    if (fm.multiStep) bits.push("multi-step");
    if (fm.containsEmail) bits.push("email");
    if (fm.containsPhone) bits.push("phone");
    if (fm.containsCompany) bits.push("company");
    if (fm.containsPassword) bits.push("password");
    if (fm.containsCreditCard) bits.push("card");
    if (fm.submitText) bits.push(`"${fm.submitText}"`);
    out.push(f("cro", `Form (${fm.section}${fm.aboveFold ? " · af" : ""})`, bits.join(" · ")));
  }
  return out;
}

function navigationFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const n = a.navigation;
  if (!n) return out;
  out.push(f("ux", "Top nav links", String(n.topNavCount)));
  out.push(f("ux", "Footer nav links", String(n.footerNavCount)));
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
      "Nav entries",
      entries.map(([k, v]) => `${k}: ${v ? "present" : "absent"}`).join(" · "),
    ),
  );
  return out;
}

function hierarchyFindings(a: PageAuditLike): Finding[] {
  const out: Finding[] = [];
  const hier = a.visualHierarchy ?? [];
  if (hier.length === 0) return out;
  for (let i = 0; i < Math.min(5, hier.length); i++) {
    const h = hier[i];
    out.push(
      f(
        "ux",
        `#${i + 1} ${h.role}`,
        `weight ${h.visualWeight} · ${h.section}${h.aboveFold ? " · af" : ""} · "${h.text.slice(0, 60)}"`,
      ),
    );
  }
  return out;
}

function pageSummaryFindings(a: PageAuditLike): Finding[] {
  const ps = a.pageSummary;
  if (!ps) return [];
  return [
    f(
      "interaction",
      "Page summary",
      `${ps.sectionCount} sections · ${ps.trustSignalCount} trust · ${ps.testimonialCount} testimonials · ${ps.logoCount} logos · ${ps.formCount} forms · ${ps.navigationLinks} nav links`,
    ),
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
        ...heroFindings(ev.data.data),
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
