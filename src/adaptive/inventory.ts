// Angel Adaptive — Content Inventory extractor.
//
// Runs the SAME hardened detectors the audit engine already uses (page audit,
// sections, trust signals, CTAs, forms, navigation), but composed into ONE
// browser-evaluable script so the adaptive snippet can read a live page's
// content inventory in-browser — no Browserbase, no server round-trip.
//
// READ-ONLY. This never mutates the page. Its only job is to catalog the
// content that ALREADY EXISTS, organised by the product's content categories.
// That catalog is the foundation the decision engine + pattern library build
// on later — and it enforces the core safety rule from day one: Angel only ever
// reuses content the customer already published, so we must first know exactly
// what that content is.
//
// The sub-detectors (trust signals especially) are the hardened, CI-gated code
// from src/lib/tests/scripts/*; we reuse them verbatim rather than re-deriving.

import * as detectors from "./detectors.generated";

export type InventorySignal = {
  type: string;
  text: string;
  section?: string;
  aboveFold: boolean;
  selector?: string;
  rating?: number;
  reviewCount?: number;
  logoCount?: number;
  recognizedBrands?: string[];
  personName?: string;
  company?: string;
};

export type InventorySection = {
  type: string;
  heading: string;
  position: number;
  aboveFold: boolean;
  containsPricing: boolean;
  containsTrustSignals: boolean;
  containsForm: boolean;
  selector?: string;
};

export type InventoryCta = {
  text: string;
  intent: string;
  category: string;
  section: string;
  aboveFold: boolean;
  href: string | null;
  selector?: string;
};

export type ContentInventory = {
  url: string;
  capturedAt: string;
  page: {
    title: string;
    description: string;
    lang: string;
    hero: { headline: string; subheadline: string };
    h1: string[];
    headingCounts: { h1: number; h2: number; h3: number };
    wordCount: number;
    images: { total: number };
  };
  ctas: InventoryCta[];
  trust: {
    total: number;
    byType: Record<string, number>;
    testimonials: InventorySignal[];
    customerLogos: InventorySignal[];
    ratings: InventorySignal[];
    guarantees: InventorySignal[];
    certifications: InventorySignal[];
    securePayment: InventorySignal[];
    socialProof: InventorySignal[];
    pressMentions: InventorySignal[];
    trustedBy: InventorySignal[];
    reviewBadges: InventorySignal[];
    contactInfo: InventorySignal[];
  };
  sections: InventorySection[];
  sectionTypes: Record<string, number>;
  forms: { count: number; hasSignup: boolean };
  navigation: Record<string, unknown>;
  /**
   * What content EXISTS to adapt with — the catalog the pattern library reads.
   * Each flag is "this category is present on the page". Angel never invents
   * content; a pattern can only fire when its required content is available here.
   */
  available: Record<string, boolean>;
};

/* eslint-disable */
// Inlined verbatim via .toString() into INVENTORY_SCRIPT, then run in the page.
// Type annotations are FINE: the build (Vite) and the harness (bun) transpile
// TS→JS before .toString() is read, so the inlined source is already plain JS —
// same pattern as collect.ts's isVisible. The hard rules are: only reference the
// `parts` argument + browser globals (no closure over module scope), and the raw
// detector outputs are genuinely untyped (`any`) since they come back from eval.
export function assembleInventory(parts: any): ContentInventory {
  var audit = parts.audit || {};
  var signals = (parts.trust && parts.trust.signals) || [];
  var sectionsRaw = parts.sections || [];
  var ctasRaw = parts.ctas || [];
  var formsRaw = parts.forms || [];
  var nav = parts.navigation || {};

  function countTypes(arr: any[]): Record<string, number> {
    var m: Record<string, number> = {};
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i].type;
      m[t] = (m[t] || 0) + 1;
    }
    return m;
  }
  function pickSignal(s: any): any {
    var o: any = {
      type: s.type,
      text: (s.text || "").slice(0, 140),
      section: s.section,
      aboveFold: !!s.aboveFold,
      selector: s.selector,
    };
    if (s.rating !== undefined) o.rating = s.rating;
    if (s.reviewCount !== undefined) o.reviewCount = s.reviewCount;
    if (s.logoCount !== undefined) o.logoCount = s.logoCount;
    if (s.recognizedBrands) o.recognizedBrands = s.recognizedBrands;
    if (s.personName) o.personName = s.personName;
    if (s.company) o.company = s.company;
    return o;
  }

  var byType: Record<string, any[]> = {};
  for (var i = 0; i < signals.length; i++) {
    var s = signals[i];
    if (!byType[s.type]) byType[s.type] = [];
    byType[s.type].push(pickSignal(s));
  }
  function g(t: string): any[] {
    return byType[t] || [];
  }

  var trust = {
    total: signals.length,
    byType: countTypes(signals),
    testimonials: g("testimonial"),
    customerLogos: g("customer_logos"),
    ratings: g("review_rating").concat(g("stars_aggregate")),
    guarantees: g("guarantee"),
    certifications: g("certification"),
    securePayment: g("secure_payment"),
    socialProof: g("social_proof_count"),
    pressMentions: g("press_mention"),
    trustedBy: g("trusted_by"),
    reviewBadges: g("review_badges"),
    contactInfo: g("contact_info"),
  };

  var sections = [];
  for (var j = 0; j < sectionsRaw.length; j++) {
    var sec = sectionsRaw[j];
    sections.push({
      type: sec.type,
      heading: (sec.heading || sec.displayHeading || "").slice(0, 120),
      position: sec.position,
      aboveFold: !!sec.aboveFold,
      containsPricing: !!sec.containsPricing,
      containsTrustSignals: !!sec.containsTrustSignals,
      containsForm: !!sec.containsForm,
      selector: sec.selector,
    });
  }
  var sectionTypes: Record<string, number> = {};
  for (var k = 0; k < sections.length; k++) {
    var ty = sections[k].type;
    sectionTypes[ty] = (sectionTypes[ty] || 0) + 1;
  }

  var ctas = [];
  for (var m2 = 0; m2 < ctasRaw.length; m2++) {
    var c = ctasRaw[m2];
    ctas.push({
      text: (c.text || "").slice(0, 80),
      intent: c.intent,
      category: c.category,
      section: c.section,
      aboveFold: !!c.aboveFold,
      href: c.href === undefined ? null : c.href,
      selector: c.selector,
    });
  }

  var h1s = (audit.headings && audit.headings.h1Texts) || [];
  var heroSec = null;
  for (var n = 0; n < sectionsRaw.length; n++) {
    if (sectionsRaw[n].type === "hero") {
      heroSec = sectionsRaw[n];
      break;
    }
  }
  var hero = {
    headline: ((heroSec && (heroSec.heading || heroSec.displayHeading)) || h1s[0] || "").slice(0, 160),
    subheadline: ((heroSec && heroSec.subheading) || "").slice(0, 200),
  };

  var hasConvCta = false;
  for (var p = 0; p < ctas.length; p++) {
    if (ctas[p].intent === "conversion") {
      hasConvCta = true;
      break;
    }
  }

  var available = {
    testimonials: trust.testimonials.length > 0,
    customerLogos: trust.customerLogos.length > 0,
    ratings: trust.ratings.length > 0,
    guarantee: trust.guarantees.length > 0,
    certification: trust.certifications.length > 0,
    securePayment: trust.securePayment.length > 0,
    socialProof: trust.socialProof.length > 0,
    pressMention: trust.pressMentions.length > 0,
    trustedBy: trust.trustedBy.length > 0,
    reviewBadges: trust.reviewBadges.length > 0,
    faq: !!sectionTypes["faq"],
    pricing: !!sectionTypes["pricing"] || !!nav.pricingPresent,
    features: !!sectionTypes["features"] || !!sectionTypes["benefits"],
    conversionCta: hasConvCta || !!nav.signupPresent,
  };

  var img = audit.images || {};
  return {
    url: audit.url || location.href,
    capturedAt: new Date().toISOString(),
    page: {
      title: (audit.head && audit.head.title) || "",
      description: (audit.head && audit.head.description) || "",
      lang: (audit.head && audit.head.lang) || "",
      hero: hero,
      h1: h1s,
      headingCounts: {
        h1: (audit.headings && audit.headings.h1Count) || 0,
        h2: (audit.headings && audit.headings.h2Count) || 0,
        h3: (audit.headings && audit.headings.h3Count) || 0,
      },
      wordCount: (audit.content && audit.content.wordCount) || 0,
      images: { total: img.total || 0 },
    },
    ctas: ctas,
    trust: trust,
    sections: sections,
    sectionTypes: sectionTypes,
    forms: { count: formsRaw.length, hasSignup: !!nav.signupPresent },
    navigation: nav,
    available: available,
  };
}
/* eslint-enable */

/**
 * Eval-free inventory build. Runs the GENERATED detector functions directly —
 * no eval, no new Function — so the snippet works under a strict CSP. Produces
 * the same {@link ContentInventory} as INVENTORY_SCRIPT (which stays for
 * page.evaluate-based tooling that runs against frozen MHTML captures).
 */
export function collectInventory(): ContentInventory {
  return assembleInventory({
    audit: detectors.pageAuditRun(),
    sections: detectors.sectionsRun(),
    trust: detectors.trustSignalsRun(),
    ctas: detectors.ctasRun(),
    forms: detectors.formsRun(),
    navigation: detectors.navigationRun(),
  });
}
