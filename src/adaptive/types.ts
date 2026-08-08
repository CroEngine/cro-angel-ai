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

// Type-only import — GoalKind is defined in crawler-inventory.ts (which
// type-imports from here). A pure type-only cycle: erased at compile, no
// runtime dependency. Used to declare each Pattern's goal-kind applicability.
import type { GoalKind } from "./crawler-inventory";

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
  /** Övriga sökmotorer (DuckDuckGo, Ecosia, Yahoo, Yandex …) — riktig sök-
   *  trafik ska inte drunkna i "other". */
  | "search"
  | "partner"
  | "newsletter"
  | "direct"
  | "other";

export type DeviceType = "desktop" | "mobile" | "tablet";

/** What kind of page is being adapted, derived from its URL path. Different
 *  pages want different things: a conversion page (signup/checkout) is the
 *  goal itself, so goal-decoration patterns step aside there. 'auth' =
 *  login/account pages — NOT conversion pages (auth is never a conversion in
 *  the role taxonomy), so goal decoration stays active: a visitor who landed
 *  on /logga-in by mistake is exactly who needs the shortcut to the goal. */
export type PageType = "home" | "conversion" | "auth" | "content" | "other";

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
  /** Page classification derived from the URL (home | conversion | content | other). */
  pageType: PageType;
}

/**
 * Content categories the crawler extracts from a site (blueprint Step 2).
 * A pattern that needs published content names the slot it draws from.
 */
export type InventorySlot =
  | "headline"
  | "hero"
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
  | "set_text" // replace a target's text with published inventory text
  | "condense" // collapse a slot to its essentials (e.g. shorten hero)
  | "inject_badge" // insert published microcopy near a target
  | "inject_secondary"; // published lower-commitment CTA link beside the goal
// BORTTAGNA ops (ägarregeln 2026-07-20 — "Angel flyttar aldrig målknappen och
// ändrar aldrig dess utseende"): "emphasize" (ringen runt målet) och
// "inject_sticky" (flytande målgenväg) — bägge fanns FÖR att röra målet.

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
  /** Published content used by the op (set_text / inject_badge / inject_*). */
  value?: string;
  /** Destination for injected links (inject_secondary) — always a href the
   *  site itself published on the source element. */
  href?: string;
  /** Human-readable rationale — surfaced in the dashboard and event log. */
  reason: string;
  /** Higher runs first; also used to cap how many adaptations apply. */
  priority: number;
}

/** The engine's answer for one visitor on one page load. */
/** Why a nominated pattern resolved to nothing (C3). The engine's honesty
 *  gates make "zero adaptations" CORRECT on many pages — these reasons let
 *  the robustness harness (and debugging) tell "declined by design" from
 *  "the inventory is empty", instead of warning on both. */
export type DeclineReason =
  | "no_goal_configured"
  | "conversion_page"
  | "no_secondary_alternative"
  | "no_intent_variant"
  | "single_label_cta"
  | "no_microcopy"
  | "no_inventory_for_slot"
  | "reveal_would_noop"
  /** The pattern's declared goal-kind applicability (Pattern.appliesTo) does
   *  not include the site's confirmed conversion goal kind — e.g. a "2 minute
   *  setup" SaaS badge nominated for a donate site. Only fires when a goal
   *  kind is confirmed; unconfigured sites are never gated this way. */
  | "goal_kind_mismatch"
  /** The pattern is cohort-gated (owner-approved rule scoped to a visitor
   *  cohort, lab vocabulary ch:/src:/ret:/seen:) and this visitor's derived
   *  cohorts do not include every required key. Off by default — only fires
   *  when the site's options declare cohort gates. */
  | "cohort_mismatch"
  /** Mönstrets avoidPageTypes exkluderar sidans typ — t.ex. ett flytt-mönster
   *  på en artikel-/bloggsida (content). Se Pattern.avoidPageTypes. */
  | "page_type_mismatch"
  /** Nivå 3-mönster (layout) på en sajt som inte aktiverat layoutingrepp —
   *  v1-produkten är nivå 1–2; nivå 3 kräver opt-in efter pre-flight +
   *  ägargodkännande (angel_sites.layout_patterns_enabled). */
  | "layout_level_disabled"
  /** Ägarregeln (2026-07-20): sajtens egen målknapp är orörbar — en op som
   *  muterar sitt målelement (text/flytt/kollaps/reveal) får aldrig träffa
   *  det deklarerade målet. Injektioner ankrar bredvid utan att röra det. */
  | "goal_element_untouchable"
  /** Ägarregeln (2026-07-28): "vi ska endast skicka runt färdiga stycken" —
   *  hela dag-1-vokabulären är OMFLYTT av sajtens egna färdiga stycken.
   *  Dekorationsklassen (badges/chips vid knappar, extra länkar bredvid
   *  målet, knapptext-byten, reveal/condense) nomineras aldrig. */
  | "op_not_in_owner_vocabulary";

export interface Decision {
  /** Deterministic hash of (site + normalized context). Stable for replay. */
  decisionId: string;
  site: string;
  adaptations: Adaptation[];
  /** Nominated patterns that resolved to nothing, with WHY (C3). Only the
   *  highest-priority attempt per pattern is kept. Transparency data — the
   *  snippet ignores it. */
  declined?: { pattern: PatternId; reason: DeclineReason }[];
  /** True when this visitor is in the measurement control bucket — the snippet
   *  withholds the adaptations so their lift can be measured. */
  holdout?: boolean;
  /** Echoed back for transparency / logging. */
  context: VisitorContext;
}

/** Identifiers for the safe-pattern catalog (blueprint Step 6). */
export type PatternId =
  | "show_secondary_cta"
  | "show_customer_logos_early"
  | "show_enterprise_testimonial"
  | "show_trust_badge"
  | "clarify_cta"
  | "show_guarantee"
  | "move_faq_up"
  | "shorten_hero"
  | "show_case_study"
  | "show_no_credit_card"
  | "show_2min_setup"
  | "surface_pricing"
  | "continue_where_left_off"
  // Våg 8 — vertikal täckning för icke-SaaS-måltyper (docs/wave8-pattern-spec.md):
  | "move_reviews_up"
  | "show_rating_near_goal"
  | "show_payment_security"
  | "show_monthly_giving_option"
  | "show_callback_option"
  | "show_cancel_anytime";

/** A catalog entry describing one safe transformation. */
export interface Pattern {
  id: PatternId;
  label: string;
  description: string;
  op: AdaptationOp;
  /** The slot this pattern operates on. */
  slot: InventorySlot;
  /** The conversion goal kinds this pattern is appropriate for. Omitted =
   *  goal-agnostic (eligible for any goal). When a site has a CONFIRMED goal
   *  kind, decide() drops patterns whose appliesTo is set and excludes it —
   *  e.g. a "No credit card required" badge (trial/signup) is not nominated on
   *  a donate/purchase/booking site, where a card is the point. Sites with no
   *  confirmed kind are never gated (backward compatible). Most patterns are
   *  content-gated in resolve() already; the load-bearing case is
   *  show_enterprise_testimonial, which reveals ANY testimonial regardless of
   *  whether it's enterprise. */
  appliesTo?: GoalKind[];
  /** Sidtyper där mönstret ALDRIG nomineras. Flytt-/omordningsmönster är
   *  designade för landningsytor (hero → sektioner → FAQ) — på en artikel-/
   *  bloggsida är "FAQ först" alltid fel (glutenforum-incidenten: FAQ ovanför
   *  inlägget). Gating i decide() med typad decline (page_type_mismatch) —
   *  skönhetsgrindarna i pre-flighten är sista försvarslinjen, inte första. */
  avoidPageTypes?: PageType[];
  /** Ingreppsnivå (v1-produktdefinitionen, docs/v1-testdefinition.md):
   *    1 = emphasis  — paint-only/liten badge vid målet; ändrar aldrig layout.
   *    2 = guidance  — additiv guidning (chip, sticky, reveal, textvariant).
   *    3 = layout    — flyttar/omstrukturerar sektioner.
   *  Nivå 3 är AV som standard (angel_sites.layout_patterns_enabled krävs) —
   *  evidensgenomgången och glutenforum-incidenten pekar åt samma håll:
   *  produkten är relevans med minsta möjliga ingrepp, inte ombyggnad. Nivån
   *  är också tie-break i decide(): vid lika prioritet vinner det mindre
   *  ingreppet. */
  level: 1 | 2 | 3;
}

/** Client-collected signals POSTed to /api/adaptive/decide. */
export interface ClientSignals {
  site: string;
  url: string;
  /** Per-site write key (data-key on the snippet tag). Gates the ingest
   *  endpoints for keyed sites; absent/empty for unkeyed (legacy) sites. */
  key?: string;
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
  /** True när holdoutPct kommer från tag-attributet data-holdout (den
   *  EXPLICITA per-install-overriden, inkl. "0" som avstängning). Utan
   *  markören är dashboard-värdet auktoritativt på servern — en config-
   *  timeout i snippetet får inte bucketa om besökare mitt i mätningen. */
  holdoutOverride?: boolean;
  /** Consent basis the snippet resolved (anonymous_default | gpc_dnt | tcf |
   *  cookiebot | site_signal | …). Stamped on the decision for auditability. */
  consent?: string;
  /** Variant-id från ?angel_variant= i sid-URL:en — sandbox-spegelns "se live"-
   *  förhandsvisning av EN specifik variant. Servern honorerar den bara för
   *  sandbox-slugs och bara när variantens sajt äger den speglade domänen;
   *  på riktiga sajter är fältet inert. */
  forceVariant?: string;
}

/** A single analytics event POSTed to /api/adaptive/events. */
export interface AngelEvent {
  type:
    | "pageview"
    | "adaptation_shown"
    | "adaptation_withheld"
    | "cta_click"
    | "scroll_depth"
    | "conversion"
    | "page_perf"
    | "page_structure"
    | "element_click"
    | "form_start"
    | "form_submit"
    | "form_abandon"
    | "page_leave"
    | "rage_click"
    | "site_search"
    | "video_watch"
    // Per-sektion-synlighet (steg 9, CRO-planen): {sections: [{h, n, d}]} —
    // rubrik, instansantal, sedd-ms. Opt-in per install; saneras hårt i
    // buildEventRows.
    | "section_engagement";
  decisionId?: string;
  payload?: Record<string, unknown>;
  /** Client timestamp (ms epoch). */
  ts?: number;
}
