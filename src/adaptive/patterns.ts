// Angel Adaptive — the Pattern Library (blueprint Step 6).
//
// The decision engine may ONLY choose from this fixed catalog. Each entry maps
// a pattern to (a) the DOM op the snippet performs and (b) the inventory slot
// it draws from. Patterns marked `requiresContent` are skipped when the site's
// inventory has no matching content — that is the mechanism that guarantees
// Angel never fabricates copy, only re-surfaces what the customer published.

import type { Pattern, PatternId } from "./types";

export const PATTERNS: Record<PatternId, Pattern> = {
  show_customer_logos_early: {
    id: "show_customer_logos_early",
    label: "Show customer logos earlier",
    description: "Move the customer-logo wall higher up the page.",
    op: "move_up",
    slot: "customer_logos",
    requiresContent: false,
  },
  show_testimonial: {
    id: "show_testimonial",
    label: "Show a testimonial",
    description: "Reveal a published testimonial.",
    op: "reveal",
    slot: "testimonial",
    requiresContent: false,
  },
  show_enterprise_testimonial: {
    id: "show_enterprise_testimonial",
    label: "Show an enterprise testimonial",
    description: "Surface an enterprise-flavoured testimonial for high-intent B2B visitors.",
    op: "reveal",
    slot: "testimonial",
    requiresContent: false,
  },
  show_trust_badge: {
    id: "show_trust_badge",
    label: "Show trust badges",
    description: "Reveal compliance / trust badges (GDPR, ISO, SOC2).",
    op: "reveal",
    slot: "trust_badge",
    requiresContent: false,
  },
  clarify_cta: {
    id: "clarify_cta",
    label: "Clarify the call to action",
    description: "Set the primary CTA label to the published variant that best fits the visitor.",
    op: "set_text",
    slot: "cta",
    requiresContent: true,
  },
  show_guarantee: {
    id: "show_guarantee",
    label: "Show the guarantee",
    description: "Reveal a published guarantee (money-back, cancel anytime).",
    op: "reveal",
    slot: "guarantee",
    requiresContent: false,
  },
  move_faq_up: {
    id: "move_faq_up",
    label: "Move FAQ up",
    description: "Surface the FAQ earlier for visitors likely to have objections.",
    op: "move_up",
    slot: "faq",
    requiresContent: false,
  },
  shorten_hero: {
    id: "shorten_hero",
    label: "Shorten the hero",
    description: "Condense the hero to its essentials (helpful on mobile).",
    op: "condense",
    slot: "hero",
    requiresContent: false,
  },
  highlight_popular_plan: {
    id: "highlight_popular_plan",
    label: "Highlight the most popular plan",
    description: "Emphasize the most-popular pricing tier.",
    op: "emphasize",
    slot: "pricing",
    requiresContent: false,
  },
  show_security_info: {
    id: "show_security_info",
    label: "Show security information",
    description: "Reveal published security / compliance information.",
    op: "reveal",
    slot: "security",
    requiresContent: false,
  },
  show_case_study: {
    id: "show_case_study",
    label: "Show a case study",
    description: "Reveal a published case study with results.",
    op: "reveal",
    slot: "case_study",
    requiresContent: false,
  },
  add_microcopy: {
    id: "add_microcopy",
    label: "Add reassuring microcopy",
    description: "Inject a published microcopy line near the CTA.",
    op: "inject_badge",
    slot: "microcopy",
    requiresContent: true,
  },
  show_no_credit_card: {
    id: "show_no_credit_card",
    label: 'Show "No credit card required"',
    description: 'Inject the published "No credit card required" reassurance near the CTA.',
    op: "inject_badge",
    slot: "microcopy",
    requiresContent: true,
  },
  show_2min_setup: {
    id: "show_2min_setup",
    label: 'Show "2 minute setup"',
    description: 'Inject the published "2 minute setup" reassurance near the CTA.',
    op: "inject_badge",
    slot: "microcopy",
    requiresContent: true,
  },
  surface_pricing: {
    id: "surface_pricing",
    label: "Surface pricing",
    description: "Move pricing higher for returning visitors who already evaluated it.",
    op: "move_up",
    slot: "pricing",
    requiresContent: false,
  },
  continue_where_left_off: {
    id: "continue_where_left_off",
    label: 'Show "Continue where you left off"',
    description: "Inject a published continuity prompt for returning visitors.",
    op: "inject_badge",
    slot: "microcopy",
    requiresContent: true,
  },
};

export function getPattern(id: PatternId): Pattern {
  return PATTERNS[id];
}

/** All patterns as an array — handy for the dashboard's pattern overview. */
export const ALL_PATTERNS: Pattern[] = Object.values(PATTERNS);
