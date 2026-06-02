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
      if (s.containsForm) s.type = "form";
      else if (/pric|plan|kostnad|prenum|abonnemang/.test(h)) s.type = "pricing";
      else if (/faq|frågor|questions|hjälp/.test(h)) s.type = "faq";
      else if (/testimonial|kund|customer|review|omdöme|recension/.test(h)) s.type = "testimonials";
      else if (/feature|funktion|so funkar|how it works|capabilit/.test(h)) s.type = "features";
      else if (/benefit|fördel|varför|why /.test(h)) s.type = "benefits";
      else if (
        s.type === "cards" &&
        trustSignals.some(
          (t) => t.type === "customer_logos" && t.rect !== undefined && rectCenterInside(t.rect, s.rect),
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
  let ratingSum = 0;
  let ratingN = 0;
  for (const t of trustSignals) {
    if (typeof t.reviewCount === "number") reviewCountSum += t.reviewCount;
    if (typeof t.rating === "number") {
      ratingSum += t.rating;
      ratingN++;
    }
  }

  return {
    primaryCtaCount: ctas.filter((c) => c.category === "cta_primary").length,
    secondaryCtaCount: ctas.filter((c) => c.category === "cta_secondary").length,
    aboveFoldCtaCount: ctas.filter((c) => c.aboveFold).length,
    aboveFoldTrustCount: trustSummary.aboveFold,
    trustSignalCount: trustSignals.length,
    testimonialCount: trustSignals.filter((t) => t.type === "testimonial").length,
    logoCount: trustSignals
      .filter((t) => t.type === "customer_logos")
      .reduce((s, t) => s + (t.logoCount ?? 1), 0),
    reviewCount: reviewCountSum,

    formCount: forms.length,
    navigationLinks: navigation.topNavCount + navigation.footerNavCount,
    sectionCount: sections.length,
    pageHeightPx: dims.pageHeightPx,
    foldHeightPx: dims.foldHeightPx,
  };
}

export function deriveHero(
  sections: PageSection[],
  ctas: CTAEntity[],
): HeroContent | undefined {
  const heroSection =
    sections.find((s) => s.type === "hero") ??
    sections.find((s) => s.aboveFold && s.containsPrimaryCTA && s.heading);
  if (!heroSection) return undefined;

  const heroCta =
    ctas.find((c) => c.category === "cta_primary" && c.section === "hero") ??
    ctas.find((c) => c.category === "cta_primary" && c.aboveFold);

  return {
    headline: heroSection.heading || "",
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
      label: (head.text || head.attributes["aria-label"] || head.attributes["title"] || "(no label)").trim(),
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
