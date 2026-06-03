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

type RobotsSitemapFetch = {
  robots: string | null;
  sitemap: string | null;
  sitemapUrl: string | null;
  sitemapIsIndex: boolean;
  sitemapChildCount: number;
};

export async function runPageAudit(page: Page): Promise<PageAuditData> {
  // Scroll warmup: triggers IntersectionObserver-based animations so lazy
  // sections promote from opacity:0 to opacity:1 before DOM traversal.
  // 8-step sweep + bottom pause keeps total cost ~1.5s regardless of page height.
  await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const h = document.documentElement.scrollHeight;
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      window.scrollTo({ top: (h / steps) * i, behavior: 'instant' });
      await sleep(80);
    }
    await sleep(600);
    window.scrollTo({ top: 0, behavior: 'instant' });
    await sleep(200);
  })()`);

  // Active poll for late-injected cookie banners (OneTrust, Cookiebot, etc.).
  // When found, mark the outermost cookie container with data-lovable-cookie-root
  // so downstream scripts (sections, ctas) can filter via a single ancestor check.
  await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const SEL = [
      '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#onetrust-accept-btn-handler',
      '[id*="onetrust" i]', '[class*="onetrust" i]',
      '#osano-cm-window', '[class*="osano-cm" i]',
      '[id*="cookiebot" i]', '[id^="CybotCookiebot" i]',
      '[id*="cookie-banner" i]', '[id*="cookie-consent" i]',
      '[class*="cookie-banner" i]', '[class*="cookie-consent" i]',
      '[id*="truste" i]', '[class*="truste" i]',
      '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
      '[id*="usercentrics" i]', '[id*="didomi" i]', '[class*="didomi" i]',
    ].join(',');
    const ROOT_SEL = '#onetrust-consent-sdk, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [id*="onetrust" i]';
    window.__cookiePollAttempts = 0;
    window.__cookieFoundEl = null;
    window.__cookieRootTagged = null;
    window.__cookieWaitMs = null;
    const start = Date.now();
    const deadline = start + 2500;
    while (Date.now() < deadline) {
      window.__cookiePollAttempts++;
      const found = Array.from(document.querySelectorAll(SEL)).find(el => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT' && el.tagName !== 'LINK');
      if (found) {
        const r = found.getBoundingClientRect();
        window.__cookieFoundEl = {
          tag: found.tagName,
          id: found.id || null,
          cls: (found.className || '').toString().slice(0, 120),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
        if (r.width > 50 && r.height > 30) {
          const root = (found.closest && found.closest(ROOT_SEL)) || found;
          try { root.setAttribute('data-lovable-cookie-root', '1'); } catch (_) {}
          window.__cookieRootTagged = {
            tag: root.tagName,
            id: root.id || null,
            cls: (root.className || '').toString().slice(0, 120),
          };
          window.__cookieWaitMs = Date.now() - start;
          return;
        }
      }
      await sleep(150);
    }
    window.__cookieWaitMs = Date.now() - start;
  })()`);


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
        const out = { robots: null, sitemap: null, sitemapUrl: null, sitemapIsIndex: false, sitemapChildCount: 0 };
        async function tryFetch(u) {
          try {
            const r = await fetch(u, { credentials: 'omit' });
            if (r.ok) return await r.text();
          } catch (e) {}
          return null;
        }
        out.robots = await tryFetch(origin + '/robots.txt');

        // Build sitemap candidate list: Sitemap: lines from robots.txt first,
        // then well-known fallbacks.
        const candidates = [];
        if (out.robots) {
          const re = /^Sitemap:\\s*(\\S+)/gim;
          let m;
          while ((m = re.exec(out.robots)) !== null) candidates.push(m[1]);
        }
        for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml']) {
          candidates.push(origin + p);
        }

        for (const url of candidates) {
          const body = await tryFetch(url);
          if (!body) continue;
          out.sitemap = body;
          out.sitemapUrl = url;
          if (/<sitemapindex[\\s>]/i.test(body)) {
            out.sitemapIsIndex = true;
            // Follow up to 5 child sitemaps and sum their <url> counts
            const childUrls = [];
            const locRe = /<loc>\\s*([^<]+?)\\s*<\\/loc>/gi;
            let cm;
            while ((cm = locRe.exec(body)) !== null && childUrls.length < 5) {
              childUrls.push(cm[1].trim());
            }
            let total = 0;
            for (const childUrl of childUrls) {
              const childBody = await tryFetch(childUrl);
              if (childBody) total += (childBody.match(/<url[\\s>]/gi) || []).length;
            }
            out.sitemapChildCount = total;
          }
          break;
        }
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

  const wrapperDebug = (await page.evaluate(
    "window.__wrapperDebug || []",
  )) as PageAuditData["wrapperDebug"];
  const lazyDebug = (await page.evaluate(
    "window.__lazyDebug || []",
  )) as PageAuditData["lazyDebug"];
  const cookieDebug = (await page.evaluate(
    "window.__cookieDebug || []",
  )) as PageAuditData["cookieDebug"];
  const cookiePollAttempts = (await page.evaluate(
    "window.__cookiePollAttempts ?? null",
  )) as number | null;
  const cookieFoundEl = (await page.evaluate(
    "window.__cookieFoundEl ?? null",
  )) as PageAuditData["cookieFoundEl"];
  const cookieRootTagged = (await page.evaluate(
    "window.__cookieRootTagged ?? null",
  )) as PageAuditData["cookieRootTagged"];
  const cookieWaitMs = (await page.evaluate(
    "window.__cookieWaitMs ?? null",
  )) as number | null;
  const ctaCookieFilterHits = (await page.evaluate(
    "window.__ctaCookieFilterHits ?? null",
  )) as number | null;

  const audit = rawAudit as RawPageAudit;
  const robotsSitemap = fetched as RobotsSitemapFetch;

  const robotsTxt = { exists: false, blocksAll: false, hasSitemap: false };
  const sitemap: { exists: boolean; urlCount: number; url: string | null; isIndex?: boolean } = {
    exists: false,
    urlCount: 0,
    url: null,
  };
  if (robotsSitemap.robots) {
    robotsTxt.exists = true;
    robotsTxt.blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsSitemap.robots);
    robotsTxt.hasSitemap = /^Sitemap:\s*\S+/im.test(robotsSitemap.robots);
  }
  if (robotsSitemap.sitemap) {
    sitemap.exists = true;
    sitemap.url = robotsSitemap.sitemapUrl;
    if (robotsSitemap.sitemapIsIndex) {
      sitemap.isIndex = true;
      sitemap.urlCount = robotsSitemap.sitemapChildCount;
    } else {
      sitemap.urlCount = (robotsSitemap.sitemap.match(/<url[\s>]/gi) ?? []).length;
    }
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

  // Strip transient `selector` from sections before persistence — it's a
  // DOM lookup helper for the browser-side scripts, not analytics data.
  // NOTE: trustSignals + ctas keep selector here because engine.server.ts
  // needs it to build the overlay; it's stripped downstream after overlay.
  const sectionsForSnapshot = sectionsTyped.map(({ selector: _s, ...rest }) => rest);

  return {
    ...audit,
    auditedAt: new Date().toISOString(),
    robotsTxt,
    sitemap,
    sections: sectionsForSnapshot,
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
    wrapperDebug,
    lazyDebug,
    cookieDebug,
    cookiePollAttempts,
    cookieFoundEl,
    cookieRootTagged,
    cookieWaitMs,
    ctaCookieFilterHits,
  };
}
