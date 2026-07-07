// Angel Adaptive — the Pattern Library (blueprint Step 6).
//
// The decision engine may ONLY choose from this fixed catalog. Each entry maps
// a pattern to (a) the DOM op the snippet performs and (b) the inventory slot
// it draws from. resolve() in decide.ts drops ANY pattern whose slot has no
// harvested inventory item (emphasize_goal excepted — its target is the
// owner's declared goal) — that uniform rule is what guarantees Angel never
// fabricates copy, only re-surfaces what the customer published.

import type { Pattern, PatternId } from "./types";

// Goal-kind applicability lives per-pattern (Pattern.appliesTo). Patterns
// WITHOUT appliesTo are goal-agnostic. The lists below exclude the goal kinds
// a pattern would be wrong or irrelevant for; see docs/contradictions-audit.md
// "target architecture" step 4. Only set on the SaaS/vertical-flavored
// patterns — the goal-first patterns (emphasize/sticky/secondary/clarify) and
// universal UX patterns (faq/hero/continuity) stay agnostic.

export const PATTERNS: Record<PatternId, Pattern> = {
  emphasize_goal: {
    id: "emphasize_goal",
    level: 1,
    label: "Emphasize the conversion goal",
    description:
      "Visually highlight the element the site owner declared as their conversion goal " +
      "(the Measurement card's conversion selector). Site-type agnostic, language-free, " +
      "and paint-only (outline/shadow) so it can never shift layout.",
    op: "emphasize",
    // Nominal slot — the target comes from the owner's goal config, not the
    // inventory (see the emphasize_goal branch in resolve()).
    slot: "cta",
  },
  sticky_goal_cta: {
    id: "sticky_goal_cta",
    level: 2,
    label: "Sticky goal shortcut on mobile",
    description:
      "A fixed bottom button (no layout shift) that keeps the declared goal one thumb-tap " +
      "away on mobile. Clicking it triggers the real goal element, so navigation and " +
      "conversion tracking are the site's own.",
    op: "inject_sticky",
    slot: "cta",
  },
  show_secondary_cta: {
    id: "show_secondary_cta",
    level: 2,
    label: "Softer option beside the goal",
    description:
      "For first-time visitors the primary goal can be too big a step. Surfaces a published " +
      "lower-commitment CTA (text + destination from the site's own inventory) as a link " +
      "beside the goal.",
    op: "inject_secondary",
    slot: "cta",
  },
  show_customer_logos_early: {
    id: "show_customer_logos_early",
    level: 3,
    label: "Show customer logos earlier",
    description: "Move the customer-logo wall higher up the page.",
    op: "move_up",
    slot: "customer_logos",
    avoidPageTypes: ["content", "auth"],
    // "Customers" is a B2B/retail notion; a nonprofit's partner logos and a
    // subscription/download's absence of them are a different semantic.
    appliesTo: [
      "signup", "trial", "quote", "contact", "lead", "booking", "purchase", "outbound", "start_flow",
    ],
  },
  show_enterprise_testimonial: {
    id: "show_enterprise_testimonial",
    level: 2,
    label: "Show an enterprise testimonial",
    description: "Surface an enterprise-flavoured testimonial for high-intent B2B visitors.",
    op: "reveal",
    slot: "testimonial",
    // LOAD-BEARING (not belt-and-suspenders): resolve() reveals ANY published
    // testimonial, not an enterprise one, so without this a webshop/nonprofit
    // LinkedIn visitor gets a testimonial under false "enterprise" pretenses.
    appliesTo: ["lead", "quote", "contact", "trial", "signup", "booking"],
  },
  show_trust_badge: {
    id: "show_trust_badge",
    level: 2,
    label: "Show trust badges",
    description: "Reveal compliance / trust badges (GDPR, ISO, SOC2).",
    op: "reveal",
    slot: "trust_badge",
    // Broadly relevant (payment-security for purchase, secure-donation for
    // donate) — only irrelevant where there is no transaction/trust surface.
    appliesTo: [
      "signup", "trial", "quote", "contact", "lead", "booking", "purchase", "donate", "subscribe",
    ],
  },
  clarify_cta: {
    id: "clarify_cta",
    level: 2,
    label: "Clarify the call to action",
    description: "Set the primary CTA label to the published variant that best fits the visitor.",
    op: "set_text",
    slot: "cta",
  },
  show_guarantee: {
    id: "show_guarantee",
    level: 2,
    label: "Show the guarantee",
    description: "Reveal a published guarantee (money-back, cancel anytime).",
    op: "reveal",
    slot: "guarantee",
    // "Money-back" / "cancel anytime" presuppose a paid commitment — wrong for
    // donate, lead/quote/contact, outbound/start_flow, and free downloads.
    appliesTo: ["purchase", "trial", "subscribe", "booking", "signup"],
  },
  move_faq_up: {
    id: "move_faq_up",
    level: 3,
    label: "Move FAQ up",
    description: "Surface the FAQ earlier for visitors likely to have objections.",
    op: "move_up",
    slot: "faq",
    // Omordning är designad för landningsytor — på en artikel-/bloggsida är
    // "FAQ först" alltid fel (glutenforum: FAQ ovanför inlägget).
    avoidPageTypes: ["content", "auth"],
  },
  shorten_hero: {
    id: "shorten_hero",
    level: 3,
    label: "Shorten the hero",
    description: "Condense the hero to its essentials (helpful on mobile).",
    op: "condense",
    slot: "hero",
    // En artikel har ingen hero att komprimera — det som råkar matcha är
    // artikelns eget huvud.
    avoidPageTypes: ["content", "auth"],
  },
  show_case_study: {
    id: "show_case_study",
    level: 2,
    label: "Show a case study",
    description: "Reveal a published case study with results.",
    op: "reveal",
    slot: "case_study",
    // A "case study with results" is a B2B considered-purchase device — not a
    // webshop/nonprofit/subscription/download conversion aid.
    appliesTo: ["lead", "quote", "contact", "trial", "signup", "booking"],
  },
  show_no_credit_card: {
    id: "show_no_credit_card",
    level: 1,
    label: 'Show "No credit card required"',
    description: 'Inject the published "No credit card required" reassurance near the CTA.',
    op: "inject_badge",
    slot: "microcopy",
    // Sharpest contradiction: it negates the payment step that purchase,
    // donate, booking and subscribe REQUIRE. Only free SaaS entry wants it.
    appliesTo: ["trial", "signup"],
  },
  show_2min_setup: {
    id: "show_2min_setup",
    level: 1,
    label: 'Show "2 minute setup"',
    description: 'Inject the published "2 minute setup" reassurance near the CTA.',
    op: "inject_badge",
    slot: "microcopy",
    // "Setup" is a SaaS/app onboarding notion. This is nominated UNIVERSALLY
    // by the baseline rule (decide.ts baseline, when: ()=>true), so gating it
    // behind a confirmed kind is the single clearest SaaS-default removal.
    appliesTo: ["trial", "signup", "download"],
  },
  surface_pricing: {
    id: "surface_pricing",
    level: 3,
    label: "Surface pricing",
    description: "Move pricing higher for returning visitors who already evaluated it.",
    op: "move_up",
    slot: "pricing",
    avoidPageTypes: ["content", "auth"],
    // "Pricing" presupposes a price to evaluate — irrelevant for donate (a
    // gift has no price), lead/quote/contact (price comes after contact),
    // outbound/start_flow (no on-site price), and free downloads.
    appliesTo: ["purchase", "subscribe", "trial", "signup", "booking"],
  },
  continue_where_left_off: {
    id: "continue_where_left_off",
    level: 1,
    label: 'Show "Continue where you left off"',
    description: "Inject a published continuity prompt for returning visitors.",
    op: "inject_badge",
    slot: "microcopy",
  },
  // ---- Våg 8: vertikal täckning för icke-SaaS-måltyper --------------------
  // Design + domarpanel + testplaner: docs/wave8-pattern-spec.md. Varje
  // mönster återexponerar ENBART sajtens publicerade innehåll och declinar
  // med typad reason i stället för att no-op:a.
  move_reviews_up: {
    id: "move_reviews_up",
    level: 3,
    label: "Reviews earlier for first-time visitors",
    description:
      "Moves the site's own testimonial/review section up for first-time visitors — " +
      "social proof before the decision, not after it (S1).",
    op: "move_up",
    slot: "testimonial",
    appliesTo: ["booking", "purchase", "start_flow", "subscribe", "lead", "quote"],
    avoidPageTypes: ["content", "auth"],
  },
  show_rating_near_goal: {
    id: "show_rating_near_goal",
    level: 1,
    label: "Published rating beside the goal",
    description:
      "Injects the site's own harvested review rating (e.g. \"4.8 · 2138 betyg\") as a badge " +
      "beside the conversion goal on decision-heavy marketplaces (S2).",
    op: "inject_badge",
    // Textkälla = trust_badge-slotten (inte microcopy) — se BADGE_SLOT_ITEM i
    // decide.ts: strikt trustType-predikat + sifferformskrav, aldrig cert-texter.
    slot: "trust_badge",
    appliesTo: ["booking", "start_flow"],
  },
  show_payment_security: {
    id: "show_payment_security",
    level: 1,
    label: "Published payment-security copy near the goal",
    description:
      "Injects the site's own published payment-security phrase (\"Säker betalning\") beside " +
      "the goal where paying is the conversion (S3).",
    op: "inject_badge",
    slot: "microcopy",
    appliesTo: ["purchase", "subscribe", "booking", "donate"],
  },
  show_monthly_giving_option: {
    id: "show_monthly_giving_option",
    level: 2,
    label: "Monthly-giving path beside the gift goal",
    description:
      "Surfaces the nonprofit's own recurring-giving CTA (\"Bli månadsgivare\", its real href) " +
      "beside the one-off gift goal for cold first-time visitors (S4).",
    op: "inject_secondary",
    slot: "cta",
    appliesTo: ["donate"],
  },
  show_callback_option: {
    id: "show_callback_option",
    level: 2,
    label: "Callback path beside the goal",
    description:
      "Surfaces the site's own callback CTA (\"Vi ringer upp dig\", its real href) beside the " +
      "goal on high-consideration lead/quote sites (S5).",
    op: "inject_secondary",
    slot: "cta",
    appliesTo: ["lead", "quote", "contact"],
  },
  show_cancel_anytime: {
    id: "show_cancel_anytime",
    level: 1,
    label: "Published cancel-anytime reassurance",
    description:
      "Injects the site's own published no-lock-in phrase (\"Avsluta när du vill\") beside the " +
      "goal on subscription sites (S6). Signup deliberately excluded — nothing to cancel.",
    op: "inject_badge",
    slot: "microcopy",
    appliesTo: ["subscribe", "trial"],
  },
};

export function getPattern(id: PatternId): Pattern {
  return PATTERNS[id];
}

/** All patterns as an array — handy for the dashboard's pattern overview. */
export const ALL_PATTERNS: Pattern[] = Object.values(PATTERNS);
