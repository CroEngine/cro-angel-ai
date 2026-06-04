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

type HeadCheckResult = { status: number | null; reachable: boolean; redirectsTo: string | null };

function parseRobotsTxt(body: string): {
  errors: string[];
  sitemapUrls: string[];
  hasUserAgent: boolean;
} {
  const lines = body.split(/\r?\n/);
  const errors: string[] = [];
  const sitemapUrls: string[] = [];
  let currentUA: string | null = null;
  let sawUA = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) {
      errors.push(`Line ${i + 1}: invalid syntax "${raw.trim()}"`);
      return;
    }
    const key = m[1];
    const val = m[2].trim();
    const k = key.toLowerCase();
    if (k === "user-agent") {
      currentUA = val;
      sawUA = true;
      return;
    }
    if (k === "allow" || k === "disallow" || k === "crawl-delay") {
      if (!currentUA) errors.push(`Line ${i + 1}: "${key}" before any User-agent`);
      // Empty path = "allow all" (valid). "*" accepted by some crawlers.
      if (k !== "crawl-delay" && val !== "" && val !== "*" && !val.startsWith("/")) {
        errors.push(`Line ${i + 1}: "${key}" path must start with /`);
      }
      return;
    }
    if (k === "sitemap") {
      if (!/^https?:\/\//i.test(val)) {
        errors.push(`Line ${i + 1}: Sitemap must be absolute URL`);
      } else {
        sitemapUrls.push(val);
      }
      return;
    }
    if (k !== "host" && k !== "cleanparam" && k !== "clean-param" && k !== "noindex") {
      errors.push(`Line ${i + 1}: unknown directive "${key}"`);
    }
  });
  return { errors, sitemapUrls, hasUserAgent: sawUA };
}

async function headCheck(url: string, signal: AbortSignal): Promise<HeadCheckResult> {
  try {
    let res = await fetch(url, { method: "HEAD", signal, redirect: "manual" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", signal, redirect: "manual" });
    }
    const loc = res.headers.get("location");
    return {
      status: res.status,
      reachable: res.status >= 200 && res.status < 400,
      redirectsTo: res.status >= 300 && res.status < 400 ? loc : null,
    };
  } catch {
    return { status: null, reachable: false, redirectsTo: null };
  }
}

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
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const found = Array.from(document.querySelectorAll(SEL)).find(el => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT' && el.tagName !== 'LINK');
      if (found) {
        const r = found.getBoundingClientRect();
        const isKnownVendor = /onetrust|cookiebot|usercentrics|didomi|osano/i.test(found.id || '');
        if (isKnownVendor || (r.width > 50 && r.height > 30)) {
          const root = (found.closest && found.closest(ROOT_SEL)) || found;
          try { root.setAttribute('data-lovable-cookie-root', '1'); } catch (_) {}
          return;
        }
      }
      await sleep(150);
    }
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




  const audit = rawAudit as RawPageAudit;
  const robotsSitemap = fetched as RobotsSitemapFetch;

  const robotsTxt: {
    exists: boolean;
    blocksAll: boolean;
    hasSitemap: boolean;
    syntaxErrors: string[];
    hasUserAgent: boolean;
    sitemapDirectives: Array<{ url: string; status: number | null; reachable: boolean }>;
  } = {
    exists: false,
    blocksAll: false,
    hasSitemap: false,
    syntaxErrors: [],
    hasUserAgent: false,
    sitemapDirectives: [],
  };
  const sitemap: { exists: boolean; urlCount: number; url: string | null; isIndex?: boolean } = {
    exists: false,
    urlCount: 0,
    url: null,
  };
  let parsedSitemapUrls: string[] = [];
  if (robotsSitemap.robots) {
    robotsTxt.exists = true;
    robotsTxt.blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*$/im.test(robotsSitemap.robots);
    robotsTxt.hasSitemap = /^Sitemap:\s*\S+/im.test(robotsSitemap.robots);
    const parsed = parseRobotsTxt(robotsSitemap.robots);
    robotsTxt.syntaxErrors = parsed.errors;
    robotsTxt.hasUserAgent = parsed.hasUserAgent;
    parsedSitemapUrls = parsed.sitemapUrls;
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

  // Read HTTP response stashed by the `goto` step in engine.server.ts.
  const stashed = (page as unknown as {
    __lovableLastResponse?: { status: number; headers: Record<string, string>; url: string };
  }).__lovableLastResponse;
  const h = (key: string): string | null =>
    stashed?.headers ? (stashed.headers[key.toLowerCase()] ?? null) : null;
  const contentLengthRaw = h("content-length");
  const httpHeaders: NonNullable<PageAuditData["httpHeaders"]> = {
    status: stashed?.status ?? null,
    finalUrl: stashed?.url ?? null,
    cacheControl: h("cache-control"),
    lastModified: h("last-modified"),
    etag: h("etag"),
    xRobotsTag: h("x-robots-tag"),
    contentType: h("content-type"),
    contentEncoding: h("content-encoding"),
    contentLength: contentLengthRaw && /^\d+$/.test(contentLengthRaw) ? parseInt(contentLengthRaw, 10) : null,
    server: h("server"),
    poweredBy: h("x-powered-by"),
    strictTransportSecurity: h("strict-transport-security"),
    contentSecurityPolicy: h("content-security-policy"),
    link: h("link"),
  };

  // Derive final indexability now that robots.txt + HTTP headers are known.
  if (audit.indexability) {
    audit.indexability.robotsTxtAllows = !robotsTxt.blocksAll;
    const noindexViaHeader = /noindex/i.test(httpHeaders.xRobotsTag ?? "");
    audit.indexability.noindexViaHeader = noindexViaHeader;
    audit.indexability.noindexEffective = audit.indexability.noindex || noindexViaHeader;
    audit.indexability.indexable =
      !audit.indexability.noindexEffective && audit.indexability.robotsTxtAllows;
    audit.indexability.canonicalHttp = null;
  }


  // Network validation: canonical + sitemap HEAD checks under a shared 5s budget.
  const canonicalAbs =
    audit.indexability?.canonicalUrl && /^https?:\/\//i.test(audit.indexability.canonicalUrl)
      ? audit.indexability.canonicalUrl
      : null;
  const sitemapTargets = parsedSitemapUrls.slice(0, 3);
  if (canonicalAbs || sitemapTargets.length > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const results = await Promise.allSettled([
        canonicalAbs ? headCheck(canonicalAbs, controller.signal) : Promise.resolve(null),
        ...sitemapTargets.map((u) => headCheck(u, controller.signal)),
      ]);
      const [canonRes, ...sitemapRes] = results;
      if (canonicalAbs && audit.indexability && canonRes.status === "fulfilled" && canonRes.value) {
        audit.indexability.canonicalHttp = canonRes.value;
      } else if (canonicalAbs && audit.indexability) {
        audit.indexability.canonicalHttp = { status: null, reachable: false, redirectsTo: null };
      }
      sitemapRes.forEach((r, i) => {
        const url = sitemapTargets[i];
        if (r.status === "fulfilled" && r.value) {
          robotsTxt.sitemapDirectives.push({ url, status: r.value.status, reachable: r.value.reachable });
        } else {
          robotsTxt.sitemapDirectives.push({ url, status: null, reachable: false });
        }
      });
    } finally {
      clearTimeout(timer);
    }
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

  let trustDebug: unknown[] = [];
  try {
    trustDebug = (await page.evaluate("window.__trustDebug__ || []")) as unknown[];
  } catch { /* ignore */ }


  return {
    ...audit,
    auditedAt: new Date().toISOString(),
    robotsTxt,
    sitemap,
    httpHeaders,
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
    layout: {
      desktop: {
        pageSummary,
        trustSummary,
        heroAboveFold: !!hero?.aboveFold,
      },
      mobile: null,
    },
    viewportDelta: null,
    // Collect-only: no derived diagnosis flags. Interpretation lives in the AI layer.
    flags: [],
  };
}

// ---------------------------------------------------------------------------
// Mobile viewport pass
// ---------------------------------------------------------------------------

async function collectLayoutPass(page: Page): Promise<{
  sections: PageSection[];
  trustSignals: TrustSignal[];
  ctas: CTAEntity[];
  visualHierarchy: VisualHierarchyEntry[];
  dims: { pageHeightPx: number; foldHeightPx: number };
}> {
  const [sections, trustSignals, ctas, visualHierarchy, dims] = await Promise.all([
    page.evaluate(SECTIONS_SCRIPT),
    page.evaluate(TRUST_SIGNALS_SCRIPT),
    page.evaluate(CTAS_SCRIPT),
    page.evaluate(VISUAL_HIERARCHY_SCRIPT),
    page.evaluate(
      "({ pageHeightPx: document.documentElement.scrollHeight, foldHeightPx: window.innerHeight })",
    ),
  ]);
  return {
    sections: sections as PageSection[],
    trustSignals: trustSignals as TrustSignal[],
    ctas: ctas as CTAEntity[],
    visualHierarchy: visualHierarchy as VisualHierarchyEntry[],
    dims: dims as { pageHeightPx: number; foldHeightPx: number },
  };
}

export type MobilePassResult = {
  mobile: NonNullable<NonNullable<PageAuditData["layout"]>["mobile"]> | null;
  viewportDelta: PageAuditData["viewportDelta"] | null;
};

/**
 * Re-collect viewport-sensitive data in a mobile emulation (390x844, iPhone UA, touch).
 * Uses CDP override + full reload — flip-only leaves desktop JS state (e.g. hamburger
 * menus initialised once via matchMedia) intact, which corrupts mobile counts.
 *
 * Order matters: this MUST run as the last DOM-dependent step in the pipeline.
 * `clearDeviceMetricsOverride` resets metrics but not the mobile-rendered DOM that
 * the server delivered under the iPhone UA.
 */
export async function runMobilePass(
  page: Page,
  navigation: NavigationData,
  desktop: NonNullable<PageAuditData["layout"]>["desktop"],
): Promise<MobilePassResult> {
  let sendCDP: ((m: string, p?: unknown) => Promise<unknown>) | null = null;
  try {
    // Stagehand v3 (understudy) — no Playwright underneath. V3Page exposes
    // sendCDP(method, params) against its main CDP session. That's the only
    // public CDP surface; newCDPSession does not exist.
    const raw = (page as unknown as {
      sendCDP?: (m: string, p?: unknown) => Promise<unknown>;
    }).sendCDP;
    if (typeof raw !== "function") {
      throw new Error("page.sendCDP unavailable (Stagehand v3 expected)");
    }
    sendCDP = raw.bind(page) as (m: string, p?: unknown) => Promise<unknown>;

    await sendCDP("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });

    await sendCDP("Emulation.setTouchEmulationEnabled", { enabled: true });

    await sendCDP("Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });

    // domcontentloaded + warmup-loop, inte networkidle — autoplay-video + 3p-script
    // håller nätet aktivt på t.ex. HiBob och får networkidle att timeouta tyst.
    await page.reload({ waitUntil: "domcontentloaded", timeoutMs: 30_000 });

    // Re-warm lazy content + return to top before measurement.
    await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const h = document.documentElement.scrollHeight;
      for (let i = 0; i <= 8; i++) {
        window.scrollTo({ top: (h / 8) * i, behavior: 'instant' });
        await sleep(80);
      }
      await sleep(400);
      window.scrollTo({ top: 0, behavior: 'instant' });
      await sleep(250);
    })()`);

    const raw2 = await collectLayoutPass(page);

    // Mobile pass intentionally re-uses desktop navigation/forms — those are
    // viewport-independent and not re-collected here.
    enrichSections(raw2.sections, raw2.ctas, raw2.trustSignals, []);
    const trustSummaryMobile = buildTrustSummary(raw2.trustSignals);
    const pageSummaryMobile = buildPageSummary({
      ctas: raw2.ctas,
      trustSignals: raw2.trustSignals,
      trustSummary: trustSummaryMobile,
      forms: [],
      navigation,
      sections: raw2.sections,
      dims: raw2.dims,
    });
    const heroMobile = deriveHero(raw2.sections, raw2.ctas);
    const heroAboveFoldMobile = !!heroMobile?.aboveFold;

    const primaryCtas = raw2.ctas
      .filter((c) => c.category === "cta_primary")
      .slice(0, 5)
      .map((c) => ({
        text: c.text,
        intent: c.intent,
        aboveFold: c.aboveFold,
        foldDepthPx: c.rect.y,
      }));
    const aboveFoldTrust = raw2.trustSignals
      .filter((t) => t.aboveFold)
      .slice(0, 5)
      .map((t) => ({ type: t.type, text: t.text }));

    const mobile = {
      pageSummary: pageSummaryMobile,
      trustSummary: trustSummaryMobile,
      heroAboveFold: heroAboveFoldMobile,
      primaryCtas,
      aboveFoldTrust,
    };

    const viewportDelta = {
      aboveFoldCtaCount: {
        desktop: desktop.pageSummary.aboveFoldCtaCount,
        mobile: pageSummaryMobile.aboveFoldCtaCount,
      },
      foldDepthFirstCtaPx: {
        desktop: desktop.pageSummary.foldDepthFirstCtaPx,
        mobile: pageSummaryMobile.foldDepthFirstCtaPx,
      },
      aboveFoldTrustCount: {
        desktop: desktop.trustSummary.aboveFold,
        mobile: trustSummaryMobile.aboveFold,
      },
      heroVisibleMobile: heroAboveFoldMobile,
    };

    return { mobile, viewportDelta };
  } catch (e) {
    console.warn("[mobile-pass] failed:", e instanceof Error ? e.message : e);
    return { mobile: null, viewportDelta: null };
  } finally {
    // Restore desktop state regardless of outcome. Clear ALL three overrides —
    // a lingering mobile UA would make any subsequent navigation serve mobile HTML.
    if (typeof sendCDP === "function") {
      try {
        await sendCDP("Emulation.clearDeviceMetricsOverride");
      } catch {
        /* ignore */
      }
      try {
        await sendCDP("Emulation.setTouchEmulationEnabled", { enabled: false });
      } catch {
        /* ignore */
      }
      try {
        await sendCDP("Emulation.setUserAgentOverride", { userAgent: "" });
      } catch {
        /* ignore */
      }
    }
  }
}


