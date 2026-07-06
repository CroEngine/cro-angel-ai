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

import { isAcquisition, type GoalKind } from "./crawler-inventory";
import { getPattern } from "./patterns";
import { pickItem } from "./inventory";
import type {
  Adaptation,
  ContentInventory,
  Decision,
  DeclineReason,
  PatternId,
  VisitorContext,
} from "./types";

/** Most adaptations on a single page load. Three is deliberate: one visual
 *  emphasis, at most one added element, one structural tweak — a page that
 *  keeps its own design. More reads as clutter and erodes the customer's
 *  brand (and our credibility). */
export const MAX_ADAPTATIONS = 3;

/**
 * Measured performance fed back into the engine (increment 2). A signed priority
 * delta per pattern, derived from conversion lift vs the holdout control group:
 *   - proven winner  → small positive boost (rises in the ranking / cap);
 *   - proven loser   → strong negative delta (suppressed, see PERF_SUPPRESS);
 *   - not yet significant → absent (0, unchanged default behaviour).
 * Exploration is not random: the holdout bucket keeps measuring the
 * counterfactual, so the engine can stay pure and deterministic.
 */
export type PatternBoost = Partial<Record<PatternId, number>>;

/** Ops that ADD an element to the page. Design-integrity rule: at most ONE
 *  of these per decision — floating pills, extra links and badges stack into
 *  visual noise fast, and the customer's design must stay theirs. */
const INJECT_OPS = new Set(["inject_sticky", "inject_secondary", "inject_badge"]);

/** Largest positive nudge a proven winner can earn (keeps rules meaningful). */
export const PERF_MAX_BOOST = 30;
/** Delta assigned to a proven loser — drives its effective priority ≤ 0 so the
 *  engine drops it (stop showing adaptations that measurably hurt). */
export const PERF_SUPPRESS = -1000;

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
    // Goal-first: whenever the owner has declared a conversion goal in the
    // dashboard, highlight it. Resolves to nothing when no goal is configured,
    // so it costs unconfigured sites zero adaptation slots.
    id: "goal_focus",
    priority: 65,
    when: () => true,
    patterns: ["emphasize_goal"],
  },
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
    // Mobile: the goal is often buried behind a hamburger — keep it one
    // thumb-tap away. Fixed-position, so it can never shift layout.
    id: "mobile_sticky_goal",
    priority: 72,
    when: (c) => c.device === "mobile",
    patterns: ["sticky_goal_cta"],
  },
  {
    // Cold first-time visitors: the primary goal can be too big a first step —
    // surface a published lower-commitment path beside it.
    id: "cold_soft_path",
    priority: 55,
    when: (c) => !c.isReturning && c.visitCount === 0,
    patterns: ["show_secondary_cta"],
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

/**
 * Which published CTA labels fit this visitor, best-first. The confirmed
 * goal's KIND anchors what "clarifying the CTA" means for THIS business —
 * the judge ranks goals per business type, and the runtime must not undo that
 * by assuming SaaS: a lead-gen/quote site's clarification is the sales
 * motion, not a free trial. The list is a fallback chain over the PUBLISHED
 * label variants (harvest stamps demo/trial/sales), so every published
 * variant is reachable — a sales-only inventory no longer dead-ends.
 */
function ctaIntentPreferences(c: VisitorContext, goal?: SiteGoal): string[] {
  const b2b = c.trafficSource === "linkedin" || c.trafficSource === "partner";
  switch (goal?.kind) {
    case "contact":
    case "lead":
    case "quote":
      return ["sales", "demo", "trial"];
    case "booking":
      return ["demo", "sales", "trial"];
    default:
      return b2b ? ["demo", "sales", "trial"] : ["trial", "demo", "sales"];
  }
}

/**
 * Is this pattern eligible for the site's confirmed goal kind? A pattern with
 * no `appliesTo` is goal-agnostic (always eligible). A pattern WITH an
 * appliesTo is dropped only when the site has a CONFIRMED goal kind that the
 * list excludes — so a "2 minute setup" SaaS badge is not nominated on a
 * donate site. Backward compatible: no confirmed kind (or an unrecognized
 * one) → every pattern stays eligible, exactly as before goal kinds existed.
 */
function patternFitsGoalKind(id: PatternId, kind?: string | null): boolean {
  if (!kind) return true;
  const applies = getPattern(id).appliesTo;
  if (!applies) return true; // agnostic pattern
  return (applies as string[]).includes(kind);
}

/** Microcopy meta.kind a given inject pattern wants. */
const MICROCOPY_KIND: Partial<Record<PatternId, string>> = {
  show_no_credit_card: "no_credit_card",
  show_2min_setup: "setup_time",
  continue_where_left_off: "continuity",
};

/** The owner's declared conversion goal (Measurement card), if configured. */
export interface SiteGoal {
  selector?: string | null;
  url?: string | null;
  /** The goal's visible label — target-resolution fallback on pages where the
   *  CSS selector doesn't resolve (structures differ across pages). */
  text?: string | null;
  /** WHAT converting means (judge taxonomy), persisted when the owner confirms
   *  a proposed candidate. Conditions goal-aware rules — e.g. which published
   *  CTA label variant clarify_cta prefers. Absent on raw owner overrides. */
  kind?: GoalKind | string | null;
}

/**
 * Turn a chosen pattern into a concrete Adaptation, drawing any text strictly
 * from the inventory. Returns a DeclineReason (string) when the pattern must
 * not fire — the safety valve that prevents invented copy, now with WHY (C3)
 * so zero-adaptation decisions are explainable instead of warn-noise.
 */
function resolve(
  id: PatternId,
  priority: number,
  context: VisitorContext,
  inventory: ContentInventory,
  goal?: SiteGoal,
): Adaptation | DeclineReason {
  const pattern = getPattern(id);
  const slotSelector = `[data-angel-slot="${pattern.slot}"]`;

  if (id === "emphasize_goal") {
    // Goal-first: the target is the owner's declared conversion element, not an
    // inventory item. Emphasize is paint-only (no layout, no content), so the
    // "never invent content" rule is trivially satisfied.
    if (!goal?.selector) return "no_goal_configured";
    // Page-aware: on a conversion page the visitor is already AT the goal —
    // decorating it there is noise, not a nudge.
    if (context.pageType === "conversion") return "conversion_page";
    return {
      pattern: id,
      op: "emphasize",
      target: goal.selector,
      // The label is the cross-page locator: selectors like
      // "a:nth-of-type(2) > button" are structure-dependent and miss on pages
      // whose markup differs — the snippet then falls back to finding the
      // button by its visible text (seen live: "emphasized" logged with
      // nothing visible on the page).
      anchorText: goal.text ?? undefined,
      reason: "Highlighting the site's declared conversion goal.",
      priority,
    };
  }

  if (id === "sticky_goal_cta") {
    // Needs a labelled goal: the pill shows the goal's own text and clicks the
    // real element, so both navigation and conversion tracking stay the site's.
    if (!goal?.text || (!goal.selector && !goal.text)) return "no_goal_configured";
    if (context.pageType === "conversion") return "conversion_page";
    return {
      pattern: id,
      op: "inject_sticky",
      target: goal.selector ?? "",
      anchorText: goal.text,
      value: goal.text,
      reason: "Keeping the goal one thumb-tap away on mobile.",
      priority,
    };
  }

  if (id === "show_secondary_cta") {
    if (!goal?.selector && !goal?.text) return "no_goal_configured";
    if (context.pageType === "conversion") return "conversion_page";
    // A published, lower-commitment alternative: an acquisition CTA with its
    // own destination whose label differs from the goal. pickItem falls back
    // to the first item when the match misses, so re-guard after.
    const alt = pickItem(
      inventory,
      "cta",
      (i) =>
        isAcquisition(i) &&
        Boolean(i.text) &&
        Boolean(i.meta?.href) &&
        i.text !== goal.text &&
        !/^javascript:/i.test(i.meta?.href ?? ""),
    );
    if (
      !alt?.text ||
      !alt.meta?.href ||
      alt.text === goal.text ||
      !isAcquisition(alt) ||
      /^javascript:/i.test(alt.meta.href)
    ) {
      return "no_secondary_alternative";
    }
    return {
      pattern: id,
      op: "inject_secondary",
      target: goal.selector ?? "",
      anchorText: goal.text ?? undefined,
      value: alt.text,
      href: alt.meta.href,
      reason: `Published lower-commitment path "${alt.text}" beside the goal for a first-time visitor.`,
      priority,
    };
  }

  if (pattern.op === "set_text") {
    // clarify_cta — pick the published CTA label matching the visitor's intent,
    // walking the goal-aware preference chain until a variant actually exists.
    // Only acquisition CTAs qualify: "Hjälp"/"Logga in"/"Läs mer" are labelled
    // by role at harvest and must never become conversion copy. STRICT match
    // only — pickItem's first-item fallback would grab an arbitrary CTA and
    // misreport its intent in the reason string.
    const prefs = ctaIntentPreferences(context, goal);
    let item: ReturnType<typeof pickItem> = null;
    let intent = prefs[0];
    for (const wanted of prefs) {
      const hit = (inventory.slots.cta ?? []).find(
        (i) => isAcquisition(i) && i.meta?.intent === wanted && Boolean(i.text),
      );
      if (hit) {
        item = hit;
        intent = wanted;
        break;
      }
    }
    if (!item?.text || !isAcquisition(item)) return "no_intent_variant";
    // Never retext an element with the only label we know for it — that's a
    // guaranteed no-op ("Skapa konto" → "Skapa konto", seen live on the pilot,
    // where the crawler harvests each CTA's own text). The change is real only
    // when the inventory holds ANOTHER label for the same element (multi-label
    // demo slots) or we're falling back to the generic instrumented slot.
    if (item.selector) {
      const otherLabel = (inventory.slots.cta ?? []).some(
        (i) => i !== item && i.selector === item.selector && i.text && i.text !== item.text,
      );
      if (!otherLabel) return "single_label_cta";
    }
    return {
      pattern: id,
      op: "set_text",
      target: item.selector ?? slotSelector,
      slot: pattern.slot,
      // The published label doubles as a text locator if the selector drifts —
      // the same resilience the reveal/move ops already had (audit gap).
      anchorText: item.text,
      tag: item.meta?.tag,
      value: item.text,
      reason: `CTA set to "${item.text}" for ${context.trafficSource} visitor (intent: ${intent}).`,
      priority,
    };
  }

  if (pattern.op === "inject_badge") {
    const kind = MICROCOPY_KIND[id];
    const item = pickItem(inventory, "microcopy", kind ? (i) => i.meta?.kind === kind : undefined);
    // STRICT kind match — pickItem's first-item fallback would otherwise
    // inject some OTHER published reassurance under this pattern's name
    // ("No credit card required" badge showing the setup-time copy). Same
    // no-arbitrary-fallback rule as clarify_cta's intent match.
    if (!item?.text || (kind && item.meta?.kind !== kind)) return "no_microcopy";
    return {
      pattern: id,
      op: "inject_badge",
      target: '[data-angel-slot="cta"]',
      slot: "cta",
      value: item.text,
      reason: `Showing "${item.text}" (${pattern.label}).`,
      priority,
    };
  }

  // reveal / move_up / emphasize / condense — operate on an EXISTING element.
  // If we harvested nothing for this slot we have no real locator (only the
  // [data-angel-slot] convention, which un-instrumented sites lack), so the op
  // would silently no-op AND consume one of the MAX_ADAPTATIONS slots, crowding
  // out an adaptation that could actually fire. Skip it — same "never act on
  // content we don't have" rule that governs the set_text / inject_badge paths.
  const item = pickItem(inventory, pattern.slot);
  if (!item) return "no_inventory_for_slot";
  const target = item.selector ?? slotSelector;
  // reveal only un-hides [data-angel-hidden] and condense only hides
  // [data-angel-secondary] children — markers that exist solely on
  // slot-instrumented pages. On a crawled site (raw CSS selector, element
  // harvested visible) both are guaranteed visual no-ops that would still be
  // logged as exposures and pollute measurement (seen live: shorten_hero on
  // the pilot's un-instrumented <main>). Same honesty rule as set_text.
  // Two ways to be dishonest here: a raw harvested selector as the target, or
  // a harvest-sourced item with NO selector (e.g. the synthetic stars-aggregate
  // trust row) falling back to the slot-convention target — its anchorText then
  // text-matches the already-visible element on an un-instrumented page.
  if (
    (pattern.op === "reveal" || pattern.op === "condense") &&
    (!target.startsWith("[data-angel-slot") || item.meta?.source === "harvest")
  ) {
    return "reveal_would_noop";
  }
  return {
    pattern: id,
    op: pattern.op,
    target,
    slot: pattern.slot,
    // These ops act on an existing element by its content, so its published
    // text is a safe last-resort locator if the selector drifts.
    anchorText: item.text,
    tag: item.meta?.tag,
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
export function decisionIdFor(site: string, c: VisitorContext, goal?: SiteGoal): string {
  const key = [
    site,
    c.trafficSource,
    c.device,
    c.isReturning ? "ret" : "new",
    c.viewedPricing ? "px" : "-",
    c.language,
    c.pageType,
    goal?.selector ? "g" : "-",
    // The goal KIND steers clarify_cta's label choice, so it is a real engine
    // input — same visitor + re-judged kind must yield a new decisionId.
    goal?.kind ?? "-",
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
  boosts: PatternBoost = {},
  goal?: SiteGoal,
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

  // Why nominated patterns resolved to nothing (C3) — the honesty gates make
  // zero adaptations CORRECT on many pages, and this is how downstream
  // consumers (the robustness harness above all) can tell that apart from an
  // empty inventory. Highest-priority attempt per pattern wins.
  const declined: { pattern: PatternId; reason: DeclineReason }[] = [];

  const adaptations = [...best.entries()]
    // Apply the measured performance delta to each pattern's priority. Only a
    // SIGNIFICANT conversion verdict (PERF_SUPPRESS) may remove a pattern;
    // milder negatives (micro/engagement nudges) demote in the ranking but
    // floor at priority 1 (D3) — an engagement proxy that never met the
    // significance bar must not zero out e.g. the priority-10 baseline rule.
    .map(([id, priority]) => {
      const boost = boosts[id] ?? 0;
      const effective =
        boost <= PERF_SUPPRESS ? priority + boost : Math.max(1, priority + boost);
      return { id, priority: effective };
    })
    .filter((e) => e.priority > 0)
    .map((e) => {
      // Goal-kind eligibility (target architecture step 4): drop patterns the
      // site's CONFIRMED goal kind excludes BEFORE resolving them, so a
      // SaaS-flavored pattern never fires on a donate/purchase site even when
      // matching inventory happens to exist (the load-bearing case is
      // show_enterprise_testimonial, which reveals ANY testimonial). No
      // confirmed kind → no gating, so unconfigured sites are unaffected.
      if (!patternFitsGoalKind(e.id, goal?.kind)) {
        declined.push({ pattern: e.id, reason: "goal_kind_mismatch" });
        return null;
      }
      const result = resolve(e.id, e.priority, context, inventory, goal);
      if (typeof result === "string") {
        declined.push({ pattern: e.id, reason: result });
        return null;
      }
      return result;
    })
    .filter((a): a is Adaptation => a !== null)
    .sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern))
    // Injection budget: keep only the highest-priority element-adding op so a
    // visitor never sees more than one thing Angel added to the page.
    .filter(
      (
        () => {
          let injected = false;
          return (a: Adaptation) => {
            if (!INJECT_OPS.has(a.op)) return true;
            if (injected) return false;
            injected = true;
            return true;
          };
        }
      )(),
    )
    .slice(0, MAX_ADAPTATIONS);

  return {
    decisionId: decisionIdFor(site, context, goal),
    site,
    adaptations,
    ...(declined.length > 0 ? { declined } : {}),
    context,
  };
}
