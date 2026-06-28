// Angel Adaptive — the Adaptive Decision Engine (blueprint Step 5).
//
// Given a visitor's context and a site's content inventory, decide which safe
// patterns to apply *for this specific visitor*. The engine is:
//   - rule-based and deterministic: same input -> same output (debuggable, and
//     the AI/learning layer can be layered on later, exactly as the vision says);
//   - safe-by-construction: it can only choose catalog patterns, and any pattern
//     that needs published content is dropped when the inventory lacks it, so
//     Angel never invents copy;
//   - transparent: every adaptation carries a human-readable reason, and the
//     whole decision hashes to a stable id for logging and replay.

import { getPattern } from "./patterns";
import { pickItem } from "./inventory";
import type { Adaptation, ContentInventory, Decision, PatternId, VisitorContext } from "./types";

/** Most adaptations to apply on a single page load — keep the page coherent. */
export const MAX_ADAPTATIONS = 6;

interface Rule {
  id: string;
  priority: number;
  when: (c: VisitorContext) => boolean;
  patterns: PatternId[];
}

/**
 * The rule set. Order doesn't matter — priority does. When two rules pick the
 * same pattern, the higher priority wins (see dedup in `decide`). These rules
 * encode the three worked examples from the blueprint plus sensible defaults.
 */
const RULES: Rule[] = [
  {
    id: "returning_evaluated_pricing",
    priority: 90,
    when: (c) => c.isReturning && c.viewedPricing,
    patterns: ["surface_pricing", "continue_where_left_off", "show_case_study"],
  },
  {
    id: "linkedin_b2b",
    priority: 80,
    when: (c) => c.trafficSource === "linkedin" || c.trafficSource === "partner",
    patterns: [
      "show_customer_logos_early",
      "show_enterprise_testimonial",
      "clarify_cta",
      "show_case_study",
    ],
  },
  {
    id: "paid_high_intent",
    priority: 75,
    when: (c) => c.trafficSource === "google_ads",
    patterns: ["clarify_cta", "show_no_credit_card", "show_guarantee", "show_trust_badge"],
  },
  {
    id: "mobile_simplify",
    priority: 70,
    when: (c) => c.device === "mobile",
    patterns: ["shorten_hero", "move_faq_up", "clarify_cta"],
  },
  {
    id: "google_organic",
    priority: 60,
    when: (c) => c.trafficSource === "google",
    patterns: ["shorten_hero", "move_faq_up"],
  },
  {
    id: "first_time_trust",
    priority: 50,
    when: (c) => !c.isReturning,
    patterns: ["show_trust_badge", "show_no_credit_card"],
  },
  {
    id: "returning_generic",
    priority: 40,
    when: (c) => c.isReturning,
    patterns: ["continue_where_left_off"],
  },
  {
    id: "baseline",
    priority: 10,
    when: () => true,
    patterns: ["show_2min_setup"],
  },
];

/** Which published CTA label fits this visitor. */
function ctaIntent(c: VisitorContext): string {
  if (c.trafficSource === "linkedin" || c.trafficSource === "partner") return "demo";
  return "trial";
}

const CTA_LABEL: Record<string, string> = {
  demo: "Book a demo",
  trial: "Start Free Trial",
  sales: "Contact Sales",
};

/** Microcopy meta.kind a given inject pattern wants. */
const MICROCOPY_KIND: Partial<Record<PatternId, string>> = {
  show_no_credit_card: "no_credit_card",
  show_2min_setup: "setup_time",
  continue_where_left_off: "continuity",
};

/**
 * Turn a chosen pattern into a concrete Adaptation, drawing any text strictly
 * from the inventory. Returns null when the pattern needs published content the
 * site doesn't have — the safety valve that prevents invented copy.
 */
function resolve(
  id: PatternId,
  priority: number,
  context: VisitorContext,
  inventory: ContentInventory,
): Adaptation | null {
  const pattern = getPattern(id);
  const slotSelector = `[data-angel-slot="${pattern.slot}"]`;

  if (pattern.op === "set_text") {
    // clarify_cta — pick the published CTA label matching the visitor's intent.
    const intent = ctaIntent(context);
    const item = pickItem(inventory, "cta", (i) => i.meta?.intent === intent);
    if (!item?.text) return null;
    return {
      pattern: id,
      op: "set_text",
      target: item.selector ?? slotSelector,
      value: item.text,
      reason: `CTA set to "${item.text}" for ${context.trafficSource} visitor (intent: ${intent}).`,
      priority,
    };
  }

  if (pattern.op === "inject_badge") {
    const kind = MICROCOPY_KIND[id];
    const item = pickItem(inventory, "microcopy", kind ? (i) => i.meta?.kind === kind : undefined);
    if (!item?.text) return null;
    return {
      pattern: id,
      op: "inject_badge",
      target: '[data-angel-slot="cta"]',
      value: item.text,
      reason: `Showing "${item.text}" (${pattern.label}).`,
      priority,
    };
  }

  // reveal / move_up / emphasize / condense — operate on existing DOM only.
  const item = pickItem(inventory, pattern.slot);
  const target = item?.selector ?? slotSelector;
  return {
    pattern: id,
    op: pattern.op,
    target,
    reason: `${pattern.label} for ${context.trafficSource} / ${context.device} visitor.`,
    priority,
  };
}

/** FNV-1a 32-bit hash → 8-char hex. Deterministic, dependency-free. */
function hashHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable id for a decision — the engine inputs that affect the outcome. */
export function decisionIdFor(site: string, c: VisitorContext): string {
  const key = [
    site,
    c.trafficSource,
    c.device,
    c.isReturning ? "ret" : "new",
    c.viewedPricing ? "px" : "-",
    c.language,
  ].join("|");
  return hashHex(key);
}

/**
 * The decision engine. Pure: no IO, no clock, no randomness — so it is trivially
 * testable and the same visitor context always yields the same adaptations.
 */
export function decide(
  site: string,
  context: VisitorContext,
  inventory: ContentInventory,
): Decision {
  // Collect pattern -> best priority across all matching rules.
  const best = new Map<PatternId, number>();
  for (const rule of RULES) {
    if (!rule.when(context)) continue;
    for (const id of rule.patterns) {
      const prev = best.get(id);
      if (prev === undefined || rule.priority > prev) best.set(id, rule.priority);
    }
  }

  const adaptations = [...best.entries()]
    .map(([id, priority]) => resolve(id, priority, context, inventory))
    .filter((a): a is Adaptation => a !== null)
    .sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern))
    .slice(0, MAX_ADAPTATIONS);

  return {
    decisionId: decisionIdFor(site, context),
    site,
    adaptations,
    context,
  };
}
