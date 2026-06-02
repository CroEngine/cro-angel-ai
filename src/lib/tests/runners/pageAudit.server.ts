// Extracted from engine.server.ts — runs the full pageAudit step.
// Browser evaluates + robots.txt fetch + sections/trust/cta/forms/nav/hierarchy,
// then assembles a PageAuditData.

import type { Page } from "@browserbasehq/stagehand";

import { PAGE_AUDIT_SCRIPT } from "../scripts/pageAudit";
import { SECTIONS_SCRIPT } from "../scripts/sections";
import { TRUST_SIGNALS_SCRIPT } from "../scripts/trustSignals";
import { CTAS_SCRIPT } from "../scripts/ctas";
import { FORMS_SCRIPT } from "../scripts/forms";
import { NAVIGATION_SCRIPT } from "../scripts/navigation";
import { VISUAL_HIERARCHY_SCRIPT } from "../scripts/visualHierarchy";

import {
  buildPageSummary,
  buildTrustSummary,
  deriveHero,
  enrichSections,
} from "../audit-helpers";

import type {
  CTAEntity,
  FormEntity,
  NavigationData,
  PageAuditData,
  PageSection,
  TrustSignal,
  VisualHierarchyEntry,
} from "../schema";

type RawPageAudit = Omit<
  PageAuditData,
  | "robotsTxt"
  | "sitemap"
  | "flags"
  | "url"
  | "sections"
  | "sectionOrder"
  | "trustSignals"
  | "trustSummary"
  | "ctas"
  | "forms"
  | "navigation"
  | "visualHierarchy"
  | "pageSummary"
  | "hero"
> & { url: string };

type RobotsSitemapFetch = { robots: string | null; sitemap: string | null };

export async function runPageAudit(page: Page): Promise<PageAuditData> {
  const [
    rawAudit,
    fetched,
    sections,
    trustSignals,
    ctas,
    forms,
    navigation,
    visualHierarchy,
    dims,
  ] = await Promise.all([
    page.evaluate(PAGE_AUDIT_SCRIPT),
    page.evaluate(`
      (async () => {
        const origin = location.origin;
        const out = { robots: null, sitemap: null };
        try {
          const r = await fetch(origin + '/robots.txt', { credentials: 'omit' });
          if (r.ok) out.robots = await r.text();
        } catch (e) {}
        try {
          const r = await fetch(origin + '/sitemap.xml', { credentials: 'omit' });
          if (r.ok) out.sitemap = await r.text();
        } catch (e) {}
        return out;
      })()
    `),
    page.evaluate(SECTIONS_SCRIPT),
    page.evaluate(TRUST_SIGNALS_SCRIPT),
    page.evaluate(CTAS_SCRIPT),
    page.evaluate(FORMS_SCRIPT),
    page.evaluate(NAVIGATION_SCRIPT),
    page.evaluate(VISUAL_HIERARCHY_SCRIPT),
    page.evaluate(
      "({ pageHeightPx: document.documentElement.scrollHeight, foldHeightPx: window.innerHeight })",
    ),
  ]);

  const audit = rawAudit as RawPageAudit;
  const robotsSitemap = fetched as RobotsSitemapFetch;

  const robotsTxt = { exists: false, blocksAll: false, hasSitemap: false };
  const sitemap = { exists: false, urlCount: 0 };
  if (robotsSitemap.robots) {
    robotsTxt.exists = true;
    robotsTxt.blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsSitemap.robots);
    robotsTxt.hasSitemap = /^Sitemap:\s*\S+/im.test(robotsSitemap.robots);
  }
  if (robotsSitemap.sitemap) {
    sitemap.exists = true;
    sitemap.urlCount = (robotsSitemap.sitemap.match(/<loc>/g) ?? []).length;
  }

  // Derive final indexability now that robots.txt is known.
  if (audit.indexability) {
    audit.indexability.robotsTxtAllows = !robotsTxt.blocksAll;
    audit.indexability.indexable =
      !audit.indexability.noindex && audit.indexability.robotsTxtAllows;
  }

  const sectionsTyped = sections as PageSection[];
  const trustTyped = trustSignals as TrustSignal[];
  const ctasTyped = ctas as CTAEntity[];
  const formsTyped = forms as FormEntity[];
  const navTyped = navigation as NavigationData;
  const hierarchyTyped = visualHierarchy as VisualHierarchyEntry[];
  const dimsTyped = dims as { pageHeightPx: number; foldHeightPx: number };

  enrichSections(sectionsTyped, ctasTyped, trustTyped, formsTyped);
  const sectionOrder = sectionsTyped.map((s) => s.type);
  const trustSummary = buildTrustSummary(trustTyped);
  const pageSummary = buildPageSummary({
    ctas: ctasTyped,
    trustSignals: trustTyped,
    trustSummary,
    forms: formsTyped,
    navigation: navTyped,
    sections: sectionsTyped,
    dims: dimsTyped,
  });
  const hero = deriveHero(sectionsTyped, ctasTyped);

  return {
    ...audit,
    robotsTxt,
    sitemap,
    sections: sectionsTyped,
    sectionOrder,
    trustSignals: trustTyped,
    trustSummary,
    ctas: ctasTyped,
    forms: formsTyped,
    navigation: navTyped,
    visualHierarchy: hierarchyTyped,
    pageSummary,
    hero,
    // Collect-only: no derived diagnosis flags. Interpretation lives in the AI layer.
    flags: [],
  };
}
