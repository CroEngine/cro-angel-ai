// Pure helpers used by the pageAudit pipeline. No browser code, no IO.
// Operate on already-collected structured data.

import type {
  CTAEntity,
  FormEntity,
  HeroContent,
  NavigationData,
  PageSection,
  PageSummary,
  Rect,
  SectionRect,
  TrustSignal,
  TrustSummary,
} from "./schema";

function rectCenterInside(rect: Rect, container: SectionRect): boolean {
  const cy = rect.y + rect.h / 2;
  return cy >= container.y && cy <= container.y + container.h;
}

/**
 * Enrich each section with containsX flags + refine section.type based on
 * heading text and detected entities. Mutates sections in place.
 */
export function enrichSections(
  sections: PageSection[],
  ctas: CTAEntity[],
  trustSignals: TrustSignal[],
  forms: FormEntity[],
): void {
  // Structural testimonials: attribute each testimonial signal to the SMALLEST
  // section that contains its center, so a page-wrapper section can't swallow a
  // quote that belongs to a deeper testimonials block (hubspot's hero wrapper,
  // notion's). That section (if plain content/cards) becomes `testimonials` —
  // far more precise than the old heading keyword, which tagged "...Customer
  // Platform" / The Verge's "Reviews" as testimonials and missed every quote-only
  // section whose heading had no magic word ("Loved by teams that ship").
  const testimonialSectionIds = new Set<string>();
  for (const t of trustSignals) {
    if (t.type !== "testimonial" || t.rect === undefined) continue;
    let best: PageSection | null = null;
    let bestArea = Infinity;
    for (const s of sections) {
      if (!rectCenterInside(t.rect, s.rect)) continue;
      const area = s.rect.w * s.rect.h;
      if (area < bestArea) {
        bestArea = area;
        best = s;
      }
    }
    if (best) testimonialSectionIds.add(best.id);
  }

  for (const s of sections) {
    s.containsPrimaryCTA = ctas.some(
      (c) => c.category === "cta_primary" && rectCenterInside(c.rect, s.rect),
    );
    s.containsTrustSignals = trustSignals.some(
      (t) => t.rect !== undefined && rectCenterInside(t.rect, s.rect),
    );
    s.containsForm = forms.some((f) => rectCenterInside(f.rect, s.rect));

    const h = (s.heading || "").toLowerCase();
    if (s.type === "content" || s.type === "cards") {
      // Mirror classifyType's label gate: a semantic type is only assigned when
      // the heading reads like a short section LABEL, so an article title with an
      // incidental keyword (news/blog/feed cards) stays content. testimonials is
      // gated on actual signals (containsTrustSignals), not the heading keyword.
      const hw = (s.heading || "").trim().split(/\s+/).filter(Boolean).length;
      const isLabel = hw >= 1 && hw <= 4 && !/[?!]$/.test((s.heading || "").trim());
      if (s.containsForm) s.type = "form";
      else if (testimonialSectionIds.has(s.id)) s.type = "testimonials";
      else if (isLabel && /pric|plan|kostnad|prenum|abonnemang/.test(h)) s.type = "pricing";
      else if (isLabel && /faq|frågor|questions|hjälp/.test(h)) s.type = "faq";
      else if (isLabel && /feature|funktion|så funkar|how it works|capabilit/.test(h))
        s.type = "features";
      else if (isLabel && /benefit|fördel|varför|why /.test(h)) s.type = "benefits";
      else if (
        s.type === "cards" &&
        trustSignals.some(
          (t) =>
            t.type === "customer_logos" && t.rect !== undefined && rectCenterInside(t.rect, s.rect),
        )
      ) {
        s.type = "logos";
      }
    }
    s.containsPricing =
      s.type === "pricing" || /\$|€|kr\b|\/mo\b|\/mån/.test(s.heading + " " + (s.subheading ?? ""));
    s.containsNavigation = s.type === "nav" || s.type === "header" || s.type === "footer";
  }
}

export function buildTrustSummary(trustSignals: TrustSignal[]): TrustSummary {
  return {
    total: trustSignals.length,
    aboveFold: trustSignals.filter((t) => t.aboveFold).length,
    byType: trustSignals.reduce<Record<string, number>>((acc, t) => {
      acc[t.type] = (acc[t.type] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

export function buildPageSummary(input: {
  ctas: CTAEntity[];
  trustSignals: TrustSignal[];
  trustSummary: TrustSummary;
  forms: FormEntity[];
  navigation: NavigationData;
  sections: PageSection[];
  dims: { pageHeightPx: number; foldHeightPx: number };
}): PageSummary {
  const { ctas, trustSignals, trustSummary, forms, navigation, sections, dims } = input;

  let reviewCountSum = 0;
  // Pull rating from stars_aggregate when available; fall back to mean of
  // individual rating fields for review_rating/etc.
  const aggregate = trustSignals.find((t) => t.type === "stars_aggregate");
  let avgRating: number | null = null;
  let ratingCount = 0;
  if (aggregate) {
    avgRating = aggregate.averageRating ?? null;
    ratingCount = aggregate.count ?? 0;
  } else {
    let ratingSum = 0;
    let ratingN = 0;
    for (const t of trustSignals) {
      if (typeof t.rating === "number") {
        ratingSum += t.rating;
        ratingN++;
      }
    }
    if (ratingN > 0) {
      avgRating = Math.round((ratingSum / ratingN) * 100) / 100;
      ratingCount = ratingN;
    }
  }
  for (const t of trustSignals) {
    if (typeof t.reviewCount === "number") reviewCountSum += t.reviewCount;
  }

  // foldDepth: first CTA outside nav/header (the "real" page CTA),
  // measured in document px from the top.
  const eligibleCtaYs = ctas
    .filter((c) => c.section !== "nav" && c.section !== "header")
    .map((c) => c.rect.y);
  const foldDepthFirstCtaPx = eligibleCtaYs.length > 0 ? Math.min(...eligibleCtaYs) : null;

  // Contrast aggregates. Filter out nulls (transparent backgrounds / ghost CTAs)
  // before averaging — otherwise they'd skew the mean. Future flag
  // `ux_multiple_ctas_low_contrast` should likewise use `withContrast.length`
  // as denominator, not `ctas.length`.
  const withContrast = ctas.filter((c) => c.contrastRatio !== null);
  const ctaContrastAvg =
    withContrast.length > 0
      ? Math.round(
          (withContrast.reduce((s, c) => s + (c.contrastRatio as number), 0) /
            withContrast.length) *
            100,
        ) / 100
      : null;
  const ctaContrastFailCount = ctas.filter((c) => c.wcagLevel === "FAIL").length;

  const ctasScriptPrimaryCount = ctas.filter(
    (c) => c.category === "cta_primary" && c.intent === "conversion",
  ).length;
  const secondaryCtaCount = ctas.filter((c) => c.category === "cta_secondary").length;
  const iconButtonCount = ctas.filter((c) => c.category === "icon_button").length;
  const ctaTotalCount = ctas.length;
  const otherCtaCount =
    ctaTotalCount - ctasScriptPrimaryCount - secondaryCtaCount - iconButtonCount;

  // Reconcile assertion (dev-only warn): the four count buckets must sum to total.
  if (
    ctasScriptPrimaryCount + secondaryCtaCount + iconButtonCount + otherCtaCount !==
    ctaTotalCount
  ) {
    console.warn(
      `[buildPageSummary] CTA reconcile failed: ${ctasScriptPrimaryCount}+${secondaryCtaCount}+${iconButtonCount}+${otherCtaCount} !== ${ctaTotalCount}`,
    );
  }

  return {
    ctasScriptPrimaryCount,
    secondaryCtaCount,
    iconButtonCount,
    otherCtaCount,
    ctaTotalCount,
    aboveFoldCtaCount: ctas.filter((c) => c.aboveFold).length,
    foldDepthFirstCtaPx,
    aboveFoldTrustCount: trustSummary.aboveFold,
    trustSignalCount: trustSignals.length,
    testimonialCount: trustSignals.filter((t) => t.type === "testimonial").length,
    logoCount: trustSignals
      .filter((t) => t.type === "customer_logos")
      .reduce((s, t) => s + (t.logoCount ?? 1), 0),
    reviewCount: reviewCountSum,
    avgRating,
    ratingCount,

    formCount: forms.length,
    navigationLinks: navigation.topNavCount + navigation.footerNavCount,
    sectionCount: sections.length,
    pageHeightPx: dims.pageHeightPx,
    foldHeightPx: dims.foldHeightPx,
    ctaContrastFailCount,
    ctaContrastAvg,
  };
}

// Common off-canvas overlay-panel headings (cart drawers, nav menus, search/
// account modals) that get mis-typed as hero sections. Rejected as hero
// headlines unless they actually match the page h1.
const HERO_LABEL_BLOCKLIST =
  /^(home|menu|search( our site)?|cart|bag|shopping bag|wishlist|favou?rites|account|my account|log\s?in|sign\s?(in|up)|register|subscribe|newsletter|cookies?|consent|skip to (main )?content)$/i;

// A hero CTA should be a conversion ACTION, not a weak/content link that merely
// also scored cta_primary in the hero region. Without this, deriveHero took the
// first primary in DOM order — hashicorp picked "Learn more", replit "Quarterly
// review preview" — over the real "Get started" / "Start building". Used only to
// PREFER; the original any-primary pick stays as the fallback, so a legitimate
// non-matching CTA like "Contact sales" still wins when it's the only primary.
const HERO_CTA_CONVERSION =
  /\b(get started|start|sign\s?up|signup|try|book|buy|order|checkout|subscribe|register|download|demo|request|trial|join|create account|add to cart|get \w+ (free|now))\b/i;

// A hero CTA must be a real conversion ACTION — never a weak "learn more"/"read
// more" content link, page chrome (search/login), a nav/category tab, or a
// cookie-consent button. These otherwise win deriveHero when they score primary
// in the hero region: hubspot's lone cta_primary was "Learn more about Revenue
// Hub" while the real "Get a demo" sat in cta_secondary; gymshark's was "search"
// (utility); patagonia's were "Women's"/"Men's" category tabs scored conversion.
const HERO_CTA_WEAK = /^(learn|read|see|view|explore|discover|find out)\b|\b(learn|read) more\b/i;
const HERO_CTA_COOKIE =
  /\bcookies?\b|\bconsent\b|let me choose|essential cookies|allow all|only essential|manage preferences/i;
// Disqualifies a CTA from being the hero action regardless of category: a weak
// "learn/read more" content link, a cookie-consent button, or a pure search/
// utility control (gymshark's "search"). Applied to BOTH the conversion-worded
// preference and the fallback.
const isCleanAction = (c: CTAEntity): boolean => {
  const t = (c.text || "").trim();
  if (!t) return false;
  if (HERO_CTA_WEAK.test(t) || HERO_CTA_COOKIE.test(t)) return false;
  return c.intent !== "utility";
};
// The fallback (no conversion-worded CTA found) is stricter: a non-conversion
// primary may only win when it's a genuine in-content/header action — never nav/
// footer chrome or a navigation-intent tab (verge's "LATEST", patagonia's nav).
// A CONVERSION-worded CTA, by contrast, is the real action even in the nav
// (linear's primary is the nav "Sign up"), so it is NOT subject to this gate.
const isFallbackAction = (c: CTAEntity): boolean =>
  isCleanAction(c) && c.intent !== "navigation" && c.section !== "nav" && c.section !== "footer";

export function deriveHero(
  sections: PageSection[],
  ctas: CTAEntity[],
  h1Texts: string[] = [],
): HeroContent | undefined {
  const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  const h1set = h1Texts.map(norm).filter(Boolean);
  // The page's real <h1> is almost always the hero headline. Anchoring to it
  // sidesteps the classification bug where off-canvas overlay panels (cart/nav/
  // modal) get typed "hero" and their label ("Shopping Bag", "Home", "Marketing")
  // was taken as the headline while the actual hero sat in a "content" section.
  const matchesH1 = (heading: string): boolean => {
    const h = norm(heading);
    return !!h && h1set.some((x) => x.includes(h) || h.includes(x));
  };
  const isLabel = (heading: string): boolean => {
    const h = norm(heading);
    return !h || HERO_LABEL_BLOCKLIST.test(h) || h.split(" ").length < 2;
  };
  // A hero is main content, never page chrome or an off-canvas overlay. Without
  // this, a CTA-bearing cart/nav/search drawer (type "aside") above the fold wins
  // the heading-based finders when there's no h1 to anchor on — e.g. glossier
  // picked its cart panel "Edit item" over the real hero "You smell like vacation".
  // Excluded only from the CTA/heading finders; the h1-anchor finder stays
  // authoritative. "header" is intentionally NOT excluded (heroes often live in a
  // <header>); only aside/nav/footer are.
  const isChrome = (s: PageSection): boolean =>
    s.type === "aside" || s.type === "nav" || s.type === "footer";

  const heroSection =
    sections.find((s) => s.aboveFold && s.heading && matchesH1(s.heading)) ??
    sections.find((s) => s.type === "hero" && s.heading && !isLabel(s.heading)) ??
    sections.find(
      (s) =>
        s.aboveFold && s.containsPrimaryCTA && s.heading && !isLabel(s.heading) && !isChrome(s),
    ) ??
    // Last resorts: original behaviour (a hero/CTA section even if label-ish).
    sections.find((s) => s.type === "hero") ??
    sections.find((s) => s.aboveFold && s.containsPrimaryCTA && s.heading && !isChrome(s)) ??
    sections.find((s) => s.type === "form" && s.aboveFold && s.heading);
  const isConv = (c: CTAEntity) => HERO_CTA_CONVERSION.test((c.text || "").trim());
  const isPrimaryish = (c: CTAEntity) =>
    c.category === "cta_primary" || c.category === "cta_secondary";
  const convAction = (c: CTAEntity) => isConv(c) && isCleanAction(c);
  const heroCta =
    // 1-2. A conversion-worded action in the hero (then above the fold). Consider
    // cta_secondary too: real hero CTAs often score secondary while a weak link
    // takes the lone primary (hubspot's "Get a demo" was secondary, "Learn more"
    // the primary). A conversion CTA in the nav still counts (linear's "Sign up").
    ctas.find((c) => isPrimaryish(c) && c.section === "hero" && convAction(c)) ??
    ctas.find((c) => isPrimaryish(c) && c.aboveFold && convAction(c)) ??
    // 3-4. Else a real (non-weak/non-chrome/non-nav) primary — so "Contact sales"
    // still wins when nothing is conversion-worded, but "Learn more"/"search"/
    // a "LATEST" nav tab don't.
    ctas.find((c) => c.category === "cta_primary" && c.section === "hero" && isFallbackAction(c)) ??
    ctas.find((c) => c.category === "cta_primary" && c.aboveFold && isFallbackAction(c)) ??
    ctas.find((c) => c.category === "form_submit" && c.section === "hero") ??
    ctas.find((c) => c.category === "form_submit" && c.aboveFold);

  // Last resort: the page has a real h1 but no section anchored to it — e.g. a
  // landmark-less SPA whose content the walker collapsed into a single nav
  // section (warby-parker: valid capture, h1 "A new level of lightweight", yet
  // zero usable hero sections). The h1 is the headline by every other heuristic
  // here, so synthesize a hero from it rather than emitting none. Never reached
  // when a section anchors (the entire corpus), so goldens are unaffected.
  if (!heroSection) {
    const h1 = h1Texts.map((t) => (t || "").trim()).find((t) => t && !isLabel(t));
    if (!h1) return undefined;
    return {
      headline: h1,
      subheadline: "",
      primaryCtaText: heroCta?.text || "",
      primaryCtaIntent: heroCta?.intent || "",
      sectionId: "",
      aboveFold: true,
    };
  }

  return {
    // Fall back to the section's prominent display text when it has no semantic
    // heading (styled-<div> hero). displayHeading is only populated in that case,
    // so a normal h1/h2 hero is unaffected — and it never feeds classification.
    headline: heroSection.heading || heroSection.displayHeading || "",
    subheadline: heroSection.subheading || "",
    primaryCtaText: heroCta?.text || "",
    primaryCtaIntent: heroCta?.intent || "",
    sectionId: heroSection.id,
    aboveFold: heroSection.aboveFold,
  };
}

/**
 * Detect repeated controls (vote/save/share rows in feed cards, "Read more"
 * links repeating per article, etc.) and mark all but the first occurrence
 * as groupedAway so aggregates aren't dominated by them. Mutates `elements`.
 */
export type CollectedLite = {
  text: string;
  attributes: Record<string, string>;
  rect: Rect;
  category: import("./schema").ElementCategory;
  intent: import("./schema").ElementIntent;
  section: import("./schema").SectionKind;
  selector: string;
  groupId?: string;
  groupCount?: number;
  groupedAway?: boolean;
};

export function groupRepeatedControls<T extends CollectedLite>(
  elements: T[],
): import("./schema").RepeatedGroup[] {
  const buckets = new Map<string, T[]>();
  for (const el of elements) {
    const label = (el.text || el.attributes["aria-label"] || el.attributes["title"] || "")
      .trim()
      .toLowerCase();
    if (!label) continue;
    if (label.length > 60) continue;
    const wB = Math.round(el.rect.w / 10) * 10;
    const hB = Math.round(el.rect.h / 10) * 10;
    const key = `${el.category}|${el.intent}|${label}|${wB}x${hB}`;
    const arr = buckets.get(key) ?? [];
    arr.push(el);
    buckets.set(key, arr);
  }

  const groups: import("./schema").RepeatedGroup[] = [];
  for (const arr of buckets.values()) {
    if (arr.length < 3) continue;
    const groupId = `g_${groups.length + 1}`;
    arr.forEach((el, i) => {
      el.groupId = groupId;
      el.groupCount = arr.length;
      if (i > 0) el.groupedAway = true;
    });
    const head = arr[0];
    groups.push({
      label: (
        head.text ||
        head.attributes["aria-label"] ||
        head.attributes["title"] ||
        "(no label)"
      ).trim(),
      count: arr.length,
      category: head.category,
      intent: head.intent,
      section: head.section,
      exampleSelector: head.selector,
    });
  }
  groups.sort((a, b) => b.count - a.count);
  return groups;
}
