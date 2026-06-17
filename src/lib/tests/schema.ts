// Shared schema for the audit engine. Browser-safe — no server imports.
// Single source of truth for both the engine and the UI.

export type Step =
  | { kind: "goto"; url: string }
  | { kind: "wait"; ms: number }
  | { kind: "assertText"; text: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "act"; instruction: string }
  | { kind: "extract"; instruction: string }
  | { kind: "observe"; instruction: string }
  | { kind: "collect"; target: CollectTarget }
  | { kind: "pageAudit" };

export type CollectTarget = "clickables" | "buttons";

export type Rect = { x: number; y: number; w: number; h: number };

export type ElementCategory =
  | "cta_primary"
  | "cta_secondary"
  | "form_submit"
  | "icon_button"
  | "nav_item"
  | "link"
  | "other";

export type ViewportZone = "above_fold" | "mid_page" | "below_fold";

export type ElementIntent =
  | "conversion"
  | "information"
  | "navigation"
  | "social"
  | "utility"
  | "engagement"
  | "unknown";

export type SectionKind =
  | "nav"
  | "header"
  | "hero"
  | "cards"
  | "content"
  | "footer";

export type CollectedElement = {
  text: string;
  tagName: string;
  selector: string;
  category: ElementCategory;
  intent: ElementIntent;
  section: SectionKind;
  href: string | null;
  disabled: boolean;
  visible: boolean;
  aboveFold: boolean;
  rect: Rect;
  position: {
    viewportZone: ViewportZone;
    yPercent: number;
    xPercent: number;
  };
  visualWeight: {
    area: number;
    fontSize: number;
    fontWeight: number;
    backgroundContrast: number | null;
    score: number;
  };
  groupId?: string;
  groupCount?: number;
  groupedAway?: boolean;
  attributes: Record<string, string>;
  computedStyles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontWeight: string;
    padding: string;
    borderRadius: string;
    border: string;
    cursor: string;
    display: string;
  };
  /** Set when off-flow + partially off-screen / micro-rect / text-indent
   *  hack — element som passerade isVisible men ser ut som dold a11y-
   *  mekanism. Diagnostik, inte filter. Endast satt när true. */
  suspectOffFlow?: true;
};

export type RepeatedGroup = {
  label: string;
  count: number;
  category: ElementCategory;
  intent: ElementIntent;
  section: SectionKind;
  exampleSelector: string;
};

export type SectionType =
  | "nav"
  | "header"
  | "hero"
  | "logos"
  | "benefits"
  | "features"
  | "testimonials"
  | "reviews"
  | "pricing"
  | "faq"
  | "cta"
  | "form"
  | "cards"
  | "content"
  | "footer"
  | "aside";

export type SectionRect = { y: number; w: number; h: number };

export type PageSection = {
  id: string;
  type: SectionType;
  position: number;
  heading: string;
  subheading?: string;
  selector?: string; // transient — present in browser script output, stripped before persistence
  rect: SectionRect;
  aboveFold: boolean;
  visualWeight: number; // 0–100 normalized
  elementCount: number;
  childCount: number;
  containsPrimaryCTA: boolean;
  containsTrustSignals: boolean;
  containsForm: boolean;
  containsPricing: boolean;
  containsNavigation: boolean;
};

export type HeroContent = {
  headline: string;
  subheadline: string;
  primaryCtaText: string;
  primaryCtaIntent: string;
  sectionId: string;
  aboveFold: boolean;
};

export type TrustSignalType =
  | "testimonial"
  | "review_rating"
  | "stars"
  | "stars_aggregate"
  | "trusted_by"
  | "customer_logos"
  | "review_badges"
  | "certification"
  | "guarantee"
  | "secure_payment"
  | "contact_info"
  | "org_number"
  | "press_mention"
  | "social_proof_count";


export type TrustSignal = {
  type: TrustSignalType;
  text: string;
  section: SectionKind;
  aboveFold: boolean;
  inCarousel?: boolean;
  derivedFromStars?: boolean;


  selector?: string;
  visualWeight: number;
  source: "text" | "attr" | "schema" | "img_alt";
  rect?: Rect;
  personName?: string;
  company?: string;
  hasImage?: boolean;
  rating?: number;
  reviewCount?: number;
  reviewSource?: string;
  logoCount?: number;
  aboveFoldLogoCount?: number;
  recognizedBrands?: string[];
  badgeCount?: number;
  badgeTitles?: string[];
  detectionMethod?: "keyword";
  // stars_aggregate-only fields
  averageRating?: number | null;
  count?: number;
  aboveFoldCount?: number;
};


export type WcagLevel = "AAA" | "AA" | "AA-large" | "FAIL";

export type CTAEntity = {
  text: string;
  intent: ElementIntent;
  category: ElementCategory;
  section: SectionKind;
  aboveFold: boolean;
  visualWeight: number;
  competingActions: number;
  nearestTrustSignalDistance: number;
  nearestFormDistance: number;
  contrastRatio: number | null;
  wcagLevel: WcagLevel | null;
  selector?: string; // transient — present in browser script output, stripped before persistence
  rect: Rect;
};

export type FormField = {
  name: string;
  type: string;
  required: boolean;
  label: string;
};

export type FormEntity = {
  section: SectionKind;
  aboveFold: boolean;
  selector: string;
  fieldCount: number;
  requiredFields: number;
  containsEmail: boolean;
  containsPhone: boolean;
  containsCompany: boolean;
  containsPassword: boolean;
  containsCreditCard: boolean;
  multiStep: boolean;
  socialLogin: boolean;
  socialProviders: string[];
  submitText: string;
  fields: FormField[];
  rect: Rect;
};


export type NavigationData = {
  topNavCount: number;
  footerNavCount: number;
  topNavLinks: string[];
  footerNavLinks: string[];
  loginPresent: boolean;
  signupPresent: boolean;
  pricingPresent: boolean;
  contactPresent: boolean;
  blogPresent: boolean;
  docsPresent: boolean;
  languageSwitcherPresent: boolean;
  cartPresent: boolean;
};

export type VisualHierarchyRole =
  | "hero_headline"
  | "hero_cta"
  | "nav_item"
  | "footer_link"
  | "heading"
  | "image"
  | "paragraph"
  | "other";

export type VisualHierarchyEntry = {
  selector: string;
  text: string;
  role: VisualHierarchyRole;
  tagName: string;
  visualWeight: number;
  area: number;
  fontSize: number;
  fontWeight: number;
  contrast: number;
  wcagLevel: WcagLevel | null;
  position: { xPct: number; yPct: number };
  aboveFold: boolean;
  section: SectionKind;
};

export type PageSummary = {
  /**
   * Count of CTAs with category 'cta_primary' as classified by the
   * CTAS_SCRIPT in pageAudit. NOT intent-grided — a nav "primary" CTA
   * (e.g. a login link styled as a primary button) is included here.
   * For the intent-grided number (cta_primary AND intent==='conversion'),
   * see `CollectSummary.primaryConversionCtaCount` produced by the
   * `collect` step.
   */
  ctasScriptPrimaryCount: number;
  secondaryCtaCount: number;
  iconButtonCount: number;
  /** CTAs not in ctasScriptPrimary/secondary/iconButton. Reconciles total. */
  otherCtaCount: number;
  ctaTotalCount: number;
  aboveFoldCtaCount: number;
  foldDepthFirstCtaPx: number | null;
  aboveFoldTrustCount: number;
  trustSignalCount: number;
  testimonialCount: number;
  logoCount: number;
  reviewCount: number;
  avgRating?: number | null;
  ratingCount?: number;
  formCount: number;
  navigationLinks: number;
  sectionCount: number;
  pageHeightPx: number;
  foldHeightPx: number;
  ctaContrastFailCount: number;
  ctaContrastAvg: number | null;
};

export type TrustSummary = {
  total: number;
  aboveFold: number;
  byType: Record<string, number>;
};

// Note: `auditedAt` is optional for backwards compatibility with snapshots
// persisted before this field was introduced. Consumers should fall back to
// the database row's `created_at` when this field is missing.
export type PageAuditData = {
  url: string;
  auditedAt?: string;
  head: {
    title: string;
    description: string;
    canonical: string | null;
    lang: string;
    viewport: string | null;
    robots: string | null;
    ogTitle: string;
    ogDescription: string;
    ogImage: string | null;
    ogType: string | null;
    ogUrl: string | null;
    twitterCard: string | null;
    twitterTitle: string | null;
    twitterImage: string | null;
  };
  headings: {
    h1Count: number;
    h2Count: number;
    h3Count: number;
    h1Texts: string[];
  };
  hreflang: {
    count: number;
    hasXDefault: boolean;
    /** false om någon entry använder relativ URL (ogiltigt enligt Google). */
    hasAbsoluteUrls: boolean;
    entries: Array<{ lang: string; href: string }>;
  };
  images: {
    total: number;
    missingAlt: number;
    missingAltPct: number;
    missingDims: number;
    lazy: number;
    /** Räknat på filändelsen i currentSrc/src. OBS: CDN:er som serverar WebP via
     *  content negotiation utan att ändra URL:en (?format=auto) räknas som jpg/png. */
    formats: {
      webp: number; avif: number; jpg: number; png: number;
      gif: number; svg: number; other: number; unknown: number;
    };
    modernCount: number;
    legacyCount: number;
  };
  videos: {
    count: number;
    autoplayCount: number;
    autoplayAboveFold: number;
    unmutedAutoplay: number;
    items: Array<{
      autoplay: boolean;
      muted: boolean;
      loop: boolean;
      controls: boolean;
      preload: string | null;
      poster: string | null;
      src: string | null;
      aboveFold: boolean;
      widthPx: number;
      heightPx: number;
    }>;
  };
  resourceHints: {
    preconnectCount: number;
    dnsPrefetchCount: number;
    preloadCount: number;
    prefetchCount: number;
    modulePreloadCount: number;
    total: number;
    items: Array<{ rel: string; href: string; as: string | null; crossorigin: boolean }>;
  };
  links: { internal: number; external: number; nofollow: number; total: number };
  schema: {
    /** Antal `<script type="application/ld+json">`-element på sidan. */
    count: number;
    /** Unika `@type`-värden som hittats över alla block (inkl. @graph-utpackning). */
    types: string[];
    /**
     * Ett entry per individuellt JSON-LD-objekt. Ett enda `<script>`-block med
     * `@graph: [...]` packas upp till flera blocks här, så `blocks.length` kan
     * vara större än `count`. Använd `blocks.length` för per-typ-analys och
     * `count` för att räkna script-taggar.
     */
    blocks: Array<{
      type: string | null;
      missingRequired: string[];
      parseError: string | null;
    }>;
  };
  content: { wordCount: number; sections: number; articles: number };
  robotsTxt: {
    exists: boolean;
    blocksAll: boolean;
    hasSitemap: boolean;
    syntaxErrors: string[];
    hasUserAgent: boolean;
    sitemapDirectives: Array<{ url: string; status: number | null; reachable: boolean }>;
  };
  sitemap: { exists: boolean; urlCount: number; url: string | null; isIndex?: boolean };
  sections: PageSection[];
  sectionOrder: SectionType[];
  trustSignals: TrustSignal[];
  trustSummary: TrustSummary;
  /**
   * Per-decision log for testimonial classifier. Temporary — remove once
   * the classifier is stable across multiple sites. Each entry: stage,
   * decision ('accepted'|'rejected'), reason, selector, text snippet, and
   * attribution flags (hasQuote/hasAuthor/personName/company/...).
   */
  trustDebug?: Array<Record<string, unknown>>;
  ctas: CTAEntity[];
  forms: FormEntity[];
  navigation: NavigationData;
  visualHierarchy: VisualHierarchyEntry[];
  pageSummary: PageSummary;
  hero?: HeroContent;
  flags: string[];


  indexability?: {
    indexable: boolean;
    noindex: boolean;
    nofollow: boolean;
    canonicalUrl: string | null;
    canonicalMatchesSelf: boolean;
    canonicalIsAbsolute: boolean;
    ogUrl: string | null;
    canonicalMatchesOgUrl: boolean;
    robotsTxtAllows: boolean;
    canonicalHttp: {
      status: number | null;
      reachable: boolean;
      redirectsTo: string | null;
    } | null;
    /** True om X-Robots-Tag-headern matchar /noindex/i. Separat från meta-baserad `noindex`. */
    noindexViaHeader?: boolean;
    /** `noindex || noindexViaHeader` — använd för effektiv indexerbarhet. */
    noindexEffective?: boolean;
  };
  httpHeaders?: {
    status: number | null;
    finalUrl: string | null;
    cacheControl: string | null;
    lastModified: string | null;
    etag: string | null;
    /** Kan sätta noindex utan att det syns i <meta>. */
    xRobotsTag: string | null;
    contentType: string | null;
    contentEncoding: string | null;
    contentLength: number | null;
    server: string | null;
    poweredBy: string | null;
    strictTransportSecurity: string | null;
    contentSecurityPolicy: string | null;
    /** Kan innehålla hreflang/preload via HTTP-header istället för <link>. */
    link: string | null;
  };
  techStack?: {
    detected: string[];
    byCategory: {
      analytics: string[];
      chat: string[];
      marketing: string[];
      advertising: string[];
      consent: string[];
      cms: string[];
      cdn: string[];
      experimentation: string[];
    };
    thirdPartyScriptCount: number;
    firstPartyScriptCount: number;
    items: Array<{
      tech: string;
      category: string;
      source: "script" | "resource_timing" | "dom" | "meta";
      evidence: string;
    }>;
  };
  contentMetrics?: {
    readingTimeMinutes: number;
    paragraphCount: number;
    listCount: number;
    listItemCount: number;
    faqCount: number;
    blockquoteCount: number;
    headingDepth: number;
  };
  /**
   * @deprecated PROVENIENS, EJ SCORE. Capture-time approximations som inte
   * får viktas in i jämförbar score. Behålls top-level för bakåtkomp; nya
   * konsumenter bör läsa `provenance.performanceProxy` istället.
   */
  performanceProxy?: {
    domNodes: number;
    aboveFoldElements: number;
    aboveFoldImageCount: number;
    largestImagePx: number;
    lazyLoadedImages: number;
    eagerImagesAboveFold: number;
    stylesheetCount: number;
    scriptCount: number;
  };
  /**
   * Extractor-version stämpel. Score = f(frusen DOM, extractor_vN). Två
   * scores med olika extractorVersion får INTE jämföras direkt — kör
   * scripts/rescore-corpus.ts för att re-scora under en gemensam version.
   */
  extractorVersion?: string;
  /**
   * Capture-mätt + render-beroende metadata. Allt här är "observerat vid
   * snapshot-tillfället", aldrig score-input. UI får visa det som
   * "observerat vid capture", men aldrig blanda in i jämförbar siffra.
   */
  provenance?: {
    extractorRanAt: string;       // ISO — när extractor körde (replay-tid)
    capturedAt?: string;           // ISO — när snapshot frystes (freeze-tid)
    chromiumVersion?: string;      // browser som körde extractor
    viewport?: { width: number; height: number };
    nonComparable: true;           // sanity-flagga: hela blocket är icke-jämförbart
    performanceProxy?: {
      domNodes: number;
      aboveFoldElements: number;
      aboveFoldImageCount: number;
      largestImagePx: number;
      lazyLoadedImages: number;
      eagerImagesAboveFold: number;
      stylesheetCount: number;
      scriptCount: number;
    };
    pageSpeed?: {
      strategy: "mobile" | "desktop";
      performance: number | null;
      lcpMs: number | null;
      fcpMs: number | null;
      cls: number | null;
    };
  };
};



export type CollectSummary = {
  total: number;
  aboveFold: number;
  primaryConversionCtaCount: number;
  competingAboveFold: number;
  topVisualWeight: Array<{ selector: string; text: string; score: number }>;
  intentBreakdown: Partial<Record<ElementIntent, number>>;
  bySection?: Partial<Record<SectionKind, number>>;
  groups?: RepeatedGroup[];
};

export type CollectData = {
  target: CollectTarget;
  count: number;
  totalCount?: number;
  byCategory?: Partial<Record<ElementCategory, number>>;
  summary?: CollectSummary;
  elements: CollectedElement[];
  overlayElements?: Array<{ selector: string; category: ElementCategory; rect: Rect }>;
  screenshot?: { dataUrl: string; viewport: { w: number; h: number } };
};

export type EngineEvent =
  | { type: "step_started"; index: number; kind: Step["kind"]; summary: string }
  | { type: "step_passed"; index: number; kind: Step["kind"]; summary: string; durationMs: number; data?: unknown }
  | { type: "step_failed"; index: number; kind: Step["kind"]; summary: string; durationMs: number; error: string }
  | { type: "log"; message: string };
