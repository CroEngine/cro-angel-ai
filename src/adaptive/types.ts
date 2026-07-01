// Angel Adaptive — core domain types.
//
// These types are shared between the browser snippet contract, the server
// decision endpoint, and the dashboard. They are pure data: no DOM, no Node,
// no Supabase imports, so they are safe to use on either side of the wire.
//
// The model follows the blueprint:
//   visitor context  ->  decision engine  +  content inventory  ->  adaptations
// Nothing here invents content. Adaptations only ever reference content the
// site already published (captured in the ContentInventory).

/** Where the visit came from. Derived from UTM parameters, referrer host, and
 * (for in-app browsers that strip the referrer) the User-Agent. */
export type TrafficSource =
  | "google"
  | "google_ads"
  | "linkedin"
  | "facebook"
  | "instagram"
  | "reddit"
  | "tiktok"
  | "youtube"
  | "snapchat"
  | "pinterest"
  | "twitter"
  | "bing"
  | "partner"
  | "newsletter"
  | "direct"
  | "other";

export type DeviceType = "desktop" | "mobile" | "tablet";

/**
 * Everything the engine knows about the current visitor. Assembled from
 * server-side signals (headers) and client-side signals (the snippet).
 */
export interface VisitorContext {
  trafficSource: TrafficSource;
  device: DeviceType;
  /** chrome | safari | edge | firefox | other */
  browser: string;
  /** windows | macos | android | ios | linux | other */
  os: string;
  /** Primary BCP-47 language tag, e.g. "en", "sv". */
  language: string;
  /** ISO-3166-1 alpha-2 if the edge resolved it, else null. */
  country: string | null;
  /** Campaign id from utm_campaign, if any. */
  campaign: string | null;
  /** Has this visitor been seen before (snippet localStorage)? */
  isReturning: boolean;
  /** Number of prior visits the snippet has recorded (this one excluded). */
  visitCount: number;
  /** Did the visitor view a pricing page in a prior visit? */
  viewedPricing: boolean;
  /** Last path the visitor was on in a prior visit, if any. */
  lastPath: string | null;
  /** Visitor-local hour of day, 0-23. */
  hourOfDay: number;
  /** The URL currently being adapted. */
  url: string;
}

/**
 * Content categories the crawler extracts from a site (blueprint Step 2).
 * A pattern that needs published content names the slot it draws from.
 */
export type InventorySlot =
  | "headline"
  | "hero"
  | "feature"
  | "cta"
  | "testimonial"
  | "customer_logos"
  | "faq"
  | "case_study"
  | "trust_badge"
  | "guarantee"
  | "pricing"
  | "security"
  | "microcopy";

/** A single piece of content the site already published. */
export interface InventoryItem {
  id: string;
  slot: InventorySlot;
  /** Textual content (CTA label, microcopy, testimonial quote, ...). */
  text?: string;
  /**
   * Where this content lives / should be applied on the page. The snippet and
   * demo use the convention `[data-angel-slot="<slot>"]`.
   */
  selector?: string;
  /** Free-form hints, e.g. { intent: "demo" } on a CTA. */
  meta?: Record<string, string>;
}

/** Everything Angel found on one site (blueprint "Content Inventory"). */
export interface ContentInventory {
  site: string;
  slots: Partial<Record<InventorySlot, InventoryItem[]>>;
}

/**
 * A DOM operation the snippet knows how to perform. The set is deliberately
 * tiny and reversible — every op records the original state so it can be undone.
 */
export type AdaptationOp =
  | "reveal" // un-hide / de-suppress an existing element
  | "move_up" // reorder a slot earlier within its parent
  | "emphasize" // visually highlight an existing element
  | "set_text" // replace a target's text with published inventory text
  | "condense" // collapse a slot to its essentials (e.g. shorten hero)
  | "inject_badge"; // insert published microcopy near a target

/** One concrete change selected for this specific visitor. */
export interface Adaptation {
  pattern: PatternId;
  op: AdaptationOp;
  /** CSS selector the op applies to. */
  target: string;
  /** Inventory slot this targets. Lets the snippet fall back to
   *  `[data-angel-slot="<slot>"]` when `target` no longer resolves (DOM drift). */
  slot?: InventorySlot;
  /** Published text of the targeted element. Last-resort locator: lets the
   *  snippet re-resolve by content when both `target` and the slot selector
   *  miss. Only set for ops that act on an existing element by its content. */
  anchorText?: string;
  /** Terminal element tag (e.g. "a", "button"). Narrows the text fallback to
   *  the right element type. */
  tag?: string;
  /** Published content used by the op (set_text / inject_badge). */
  value?: string;
  /** Human-readable rationale — surfaced in the dashboard and event log. */
  reason: string;
  /** Higher runs first; also used to cap how many adaptations apply. */
  priority: number;
}

/** The engine's answer for one visitor on one page load. */
export interface Decision {
  /** Deterministic hash of (site + normalized context). Stable for replay. */
  decisionId: string;
  site: string;
  adaptations: Adaptation[];
  /** True when this visitor is in the measurement control bucket — the snippet
   *  withholds the adaptations so their lift can be measured. */
  holdout?: boolean;
  /** Echoed back for transparency / logging. */
  context: VisitorContext;
}

/** Identifiers for the safe-pattern catalog (blueprint Step 6). */
export type PatternId =
  | "show_customer_logos_early"
  | "show_testimonial"
  | "show_enterprise_testimonial"
  | "show_trust_badge"
  | "clarify_cta"
  | "show_guarantee"
  | "move_faq_up"
  | "shorten_hero"
  | "highlight_popular_plan"
  | "show_security_info"
  | "show_case_study"
  | "add_microcopy"
  | "show_no_credit_card"
  | "show_2min_setup"
  | "surface_pricing"
  | "continue_where_left_off";

/** A catalog entry describing one safe transformation. */
export interface Pattern {
  id: PatternId;
  label: string;
  description: string;
  op: AdaptationOp;
  /** The slot this pattern operates on. */
  slot: InventorySlot;
  /**
   * When true, the pattern injects/sets published text and is SKIPPED if the
   * inventory has no item for its slot — this is how "never invent content" is
   * enforced. When false, the op only reorders/reveals existing DOM.
   */
  requiresContent: boolean;
}

/** Client-collected signals POSTed to /api/adaptive/decide. */
export interface ClientSignals {
  site: string;
  url: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Screen width in CSS px — refines device classification. */
  screenWidth?: number;
  language?: string;
  hourOfDay?: number;
  isReturning?: boolean;
  visitCount?: number;
  viewedPricing?: boolean;
  lastPath?: string;
  /** Persistent visitor id (localStorage). Used server-side for holdout
   *  bucketing and to stamp adaptation exposure events for attribution. */
  visitorHash?: string;
  /** Percentage (0–100) of visitors held out as control for measurement.
   *  Config-driven; 0 = off (default). */
  holdoutPct?: number;
}

/** A single analytics event POSTed to /api/adaptive/events. */
export interface AngelEvent {
  type:
    | "pageview"
    | "adaptation_shown"
    | "adaptation_withheld"
    | "cta_click"
    | "scroll_depth"
    | "conversion";
  decisionId?: string;
  payload?: Record<string, unknown>;
  /** Client timestamp (ms epoch). */
  ts?: number;
}
