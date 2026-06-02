// Pure helper: collapses the raw PageAuditData into a compact, LLM-friendly
// shape grouped by audit category (SEO, CRO, trust, UX). No IO, no side
// effects. The scoring/findings engine keeps consuming PageAuditData; this
// is a separate representation built specifically for the findings prompt.

import type { PageAuditData, TrustSignal, CTAEntity } from "./schema";

export type LlmCta = {
  text: string;
  intent: string;
  aboveFold: boolean;
};

export type LlmAuditContext = {
  url: string;
  seo: {
    title: string;
    titleLength: number;
    description: string;
    descriptionLength: number;
    canonical: string;
    lang: string;
    ogImage: string;
    h1Count: number;
    h2Count: number;
    altTextCoverage: string;
    schema: string[];
    robots: { txtExists: boolean; sitemapExists: boolean };
    indexable: boolean;
    wordCount: number;
  };
  cro: {
    hero?: {
      headline: string;
      subheadline: string;
      primaryCta: string;
      aboveFold: boolean;
    };
    ctas: LlmCta[];
    aboveFoldCtaCount: number;
    secondaryCtaCount: number;
    formCount: number;
  };
  trust: {
    totalSignals: number;
    reviewBadges: number;
    customerLogos: number;
    testimonials: number;
    trustStatements: string[];
    contactVisible: boolean;
    certifications: string[];
  };
  ux: {
    sectionCount: number;
    sectionFlow: string[];
    navigation: {
      hasPricing: boolean;
      hasContact: boolean;
      hasLogin: boolean;
      hasSignup: boolean;
    };
    performance?: {
      domNodes: number;
      lazyLoadedImages: number;
      eagerImagesAboveFold: number;
    };
  };
};

const CTA_CAP_TOTAL = 8;
const CTA_BELOW_FOLD_CAP = 3;

function selectCtas(ctas: CTAEntity[]): LlmCta[] {
  const aboveFold = ctas.filter((c) => c.aboveFold);
  const belowFold = ctas
    .filter((c) => !c.aboveFold)
    .sort((a, b) => (b.visualWeight ?? 0) - (a.visualWeight ?? 0))
    .slice(0, CTA_BELOW_FOLD_CAP);

  return [...aboveFold, ...belowFold]
    .slice(0, CTA_CAP_TOTAL)
    .map((c) => ({ text: c.text, intent: c.intent, aboveFold: c.aboveFold }));
}

function trustStatements(trust: TrustSignal[]): string[] {
  // Explicit: only "trusted_by" copy (e.g. "Used by 10,000+ companies"),
  // never testimonial bodies or other types.
  return trust
    .filter((t) => t.type === "trusted_by")
    .map((t) => t.text)
    .filter((t): t is string => !!t && t.length > 0);
}

function certifications(trust: TrustSignal[]): string[] {
  return trust
    .filter((t) => t.type === "certification")
    .map((t) => t.text)
    .filter((t): t is string => !!t && t.length > 0);
}

export function buildLlmContext(audit: PageAuditData, url: string): LlmAuditContext {
  const head = audit.head;
  const images = audit.images;
  const altMissingPct = images.missingAltPct ?? 0;
  const altCoveragePct = Math.max(0, 100 - altMissingPct);
  const altTextCoverage =
    images.total > 0
      ? `${altCoveragePct}% (${altMissingPct}% of images missing alt)`
      : "n/a (no images)";

  const ps = audit.pageSummary;
  const trust = audit.trustSignals ?? [];
  const byType = audit.trustSummary?.byType ?? {};
  const nav = audit.navigation;

  return {
    url,
    seo: {
      title: head.title ?? "",
      titleLength: (head.title ?? "").length,
      description: head.description ?? "",
      descriptionLength: (head.description ?? "").length,
      canonical: head.canonical ?? "",
      lang: head.lang ?? "",
      ogImage: head.ogImage ?? "",
      h1Count: audit.headings.h1Count,
      h2Count: audit.headings.h2Count,
      altTextCoverage,
      schema: audit.schema.types ?? [],
      robots: {
        txtExists: audit.robotsTxt.exists,
        sitemapExists: audit.sitemap.exists,
      },
      indexable: audit.indexability?.indexable ?? true,
      wordCount: audit.content.wordCount,
    },
    cro: {
      hero: audit.hero
        ? {
            headline: audit.hero.headline,
            subheadline: audit.hero.subheadline,
            primaryCta: audit.hero.primaryCtaText,
            aboveFold: audit.hero.aboveFold,
          }
        : undefined,
      ctas: selectCtas(audit.ctas ?? []),
      aboveFoldCtaCount: ps?.aboveFoldCtaCount ?? 0,
      secondaryCtaCount: ps?.secondaryCtaCount ?? 0,
      formCount: ps?.formCount ?? 0,
    },
    trust: {
      totalSignals: trust.length,
      reviewBadges: byType.review_badges ?? 0,
      customerLogos: byType.customer_logos ?? 0,
      testimonials: byType.testimonial ?? 0,
      trustStatements: trustStatements(trust),
      contactVisible: nav?.contactPresent ?? false,
      certifications: certifications(trust),
    },
    ux: {
      sectionCount: audit.sections?.length ?? 0,
      sectionFlow: audit.sectionOrder ?? [],
      navigation: {
        hasPricing: nav?.pricingPresent ?? false,
        hasContact: nav?.contactPresent ?? false,
        hasLogin: nav?.loginPresent ?? false,
        hasSignup: nav?.signupPresent ?? false,
      },
      performance: audit.performanceProxy
        ? {
            domNodes: audit.performanceProxy.domNodes,
            lazyLoadedImages: audit.performanceProxy.lazyLoadedImages,
            eagerImagesAboveFold: audit.performanceProxy.eagerImagesAboveFold,
          }
        : undefined,
    },
  };
}
