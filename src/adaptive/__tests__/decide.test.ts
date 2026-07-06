import { describe, it, expect } from "vitest";

import { decide, MAX_ADAPTATIONS, PERF_MAX_BOOST, PERF_SUPPRESS } from "../decide";
import { emptyInventory, getDemoInventory } from "../inventory";
import type { PatternId, VisitorContext } from "../types";

const demo = getDemoInventory();

function ctx(overrides: Partial<VisitorContext> = {}): VisitorContext {
  return {
    trafficSource: "direct",
    device: "desktop",
    browser: "chrome",
    os: "macos",
    language: "en",
    country: null,
    campaign: null,
    isReturning: false,
    visitCount: 0,
    viewedPricing: false,
    lastPath: null,
    hourOfDay: 12,
    url: "https://example.com/",
    pageType: "home",
    ...overrides,
  };
}

const patternsOf = (c: VisitorContext): PatternId[] =>
  decide("demo", c, demo).adaptations.map((a) => a.pattern);

describe("decide — blueprint scenarios", () => {
  it("Visitor 1: LinkedIn, desktop, first visit → top-3 B2B patterns within the design cap", () => {
    const d = decide(
      "demo",
      ctx({ trafficSource: "linkedin", device: "desktop", isReturning: false }),
      demo,
    );
    const patterns = d.adaptations.map((a) => a.pattern);
    // MAX_ADAPTATIONS (3) is a design-integrity contract: the page must stay
    // the customer's. Equal-priority LinkedIn patterns tie-break by name.
    expect(patterns.length).toBeLessThanOrEqual(3);
    expect(patterns).toContain("show_customer_logos_early");
    expect(patterns).toContain("show_case_study");

    const cta = d.adaptations.find((a) => a.pattern === "clarify_cta");
    expect(cta?.op).toBe("set_text");
    expect(cta?.value).toBe("Book a demo");
  });

  it("Visitor 2: Google, mobile → shorten hero, FAQ up, Start Free Trial", () => {
    const d = decide("demo", ctx({ trafficSource: "google", device: "mobile" }), demo);
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).toContain("shorten_hero");
    expect(patterns).toContain("move_faq_up");

    const cta = d.adaptations.find((a) => a.pattern === "clarify_cta");
    expect(cta?.value).toBe("Start Free Trial");
  });

  it("Visitor 3: returning, viewed pricing → surface pricing + case study (non-invasive only)", () => {
    const patterns = patternsOf(ctx({ isReturning: true, visitCount: 2, viewedPricing: true }));
    expect(patterns).toContain("surface_pricing");
    expect(patterns).toContain("show_case_study");
    // The old injected "continue where you left off" badge is gone — non-invasive.
    expect(patterns).not.toContain("continue_where_left_off");
  });
});

describe("decide — safety and invariants", () => {
  it("never invents content: content-required patterns are skipped without inventory", () => {
    const empty = emptyInventory("unknown-site");
    const d = decide("unknown-site", ctx({ trafficSource: "google_ads" }), empty);
    // clarify_cta + show_no_credit_card require published content → must be absent.
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).not.toContain("clarify_cta");
    expect(patterns).not.toContain("show_no_credit_card");
    // Content-free patterns may still apply.
    for (const a of d.adaptations) {
      expect(a.value).toBeUndefined();
    }
  });

  it("refuses reveal on harvest-sourced items — visible content cannot be 'revealed'", () => {
    // A harvested trust row (visible on the page, often selector-less like the
    // synthetic stars-aggregate) must never produce a show_trust_badge: the
    // reveal would be a visual no-op logged as a real exposure.
    const inv = emptyInventory("harvested-site");
    inv.slots.trust_badge = [
      {
        id: "trust_badge-0",
        slot: "trust_badge",
        text: "20 star ratings (avg 5)",
        meta: { source: "harvest", trustType: "stars_aggregate" },
      },
    ];
    const d = decide("harvested-site", ctx({ isReturning: false }), inv);
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_trust_badge");
  });

  it("skips content-free ops too when the slot has no inventory (no no-op churn)", () => {
    // Empty inventory → nothing to reveal/move/emphasize/condense either, so the
    // engine emits nothing rather than no-ops that would burn adaptation slots.
    const empty = emptyInventory("bare-site");
    const d = decide("bare-site", ctx({ trafficSource: "linkedin", device: "mobile" }), empty);
    expect(d.adaptations).toEqual([]);
  });

  it("still applies content-free ops when the slot has inventory (demo)", () => {
    const d = decide("demo", ctx({ trafficSource: "linkedin", device: "desktop" }), demo);
    // demo has customer_logos / testimonial / case_study items → these fire.
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).toContain("show_customer_logos_early");
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("caps the number of adaptations", () => {
    // A context that triggers many rules at once.
    const d = decide(
      "demo",
      ctx({ trafficSource: "linkedin", device: "mobile", isReturning: true, viewedPricing: true }),
      demo,
    );
    expect(d.adaptations.length).toBeLessThanOrEqual(MAX_ADAPTATIONS);
  });

  it("is deterministic: same context → identical decision id and ordering", () => {
    const c = ctx({ trafficSource: "linkedin", device: "desktop" });
    const a = decide("demo", c, demo);
    const b = decide("demo", c, demo);
    expect(a.decisionId).toBe(b.decisionId);
    expect(a.adaptations.map((x) => x.pattern)).toEqual(b.adaptations.map((x) => x.pattern));
  });

  it("orders adaptations by descending priority", () => {
    const d = decide("demo", ctx({ trafficSource: "linkedin", device: "mobile" }), demo);
    const priorities = d.adaptations.map((a) => a.priority);
    const sorted = [...priorities].sort((x, y) => y - x);
    expect(priorities).toEqual(sorted);
  });

  it("every adaptation carries a non-empty reason", () => {
    const d = decide("demo", ctx({ trafficSource: "linkedin" }), demo);
    expect(d.adaptations.length).toBeGreaterThan(0);
    for (const a of d.adaptations) expect(a.reason.length).toBeGreaterThan(0);
  });
});

describe("decide — performance feedback (bandit)", () => {
  it("with no boosts, behaves exactly as before (backwards compatible)", () => {
    const c = ctx({ trafficSource: "linkedin", device: "mobile" });
    const withArg = decide("demo", c, demo, {});
    const without = decide("demo", c, demo);
    expect(withArg.adaptations.map((a) => a.pattern)).toEqual(
      without.adaptations.map((a) => a.pattern),
    );
  });

  it("suppresses a proven loser so it no longer applies", () => {
    const c = ctx({ trafficSource: "linkedin", device: "desktop" });
    const base = decide("demo", c, demo).adaptations.map((a) => a.pattern);
    expect(base).toContain("show_case_study");

    const d = decide("demo", c, demo, { show_case_study: PERF_SUPPRESS });
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_case_study");
  });

  it("adds the boost to a winning pattern's effective priority", () => {
    // clarify_cta comes from the linkedin_b2b rule at priority 80; the boost
    // must lift its reported priority by exactly PERF_MAX_BOOST.
    const c = ctx({ trafficSource: "linkedin", device: "desktop" });
    const cta = decide("demo", c, demo, { clarify_cta: PERF_MAX_BOOST }).adaptations.find(
      (a) => a.pattern === "clarify_cta",
    );
    expect(cta).toBeDefined();
    expect(cta!.priority).toBe(80 + PERF_MAX_BOOST);
  });

  it("keeps ordering by descending (boosted) priority", () => {
    const c = ctx({ trafficSource: "linkedin", device: "mobile" });
    const d = decide("demo", c, demo, { clarify_cta: PERF_MAX_BOOST });
    const priorities = d.adaptations.map((a) => a.priority);
    expect(priorities).toEqual([...priorities].sort((x, y) => y - x));
  });
});

describe("decide — goal-first (emphasize_goal)", () => {
  const goal = { selector: "#register-btn", url: null };

  it("emphasizes the owner's declared conversion goal, even with EMPTY inventory", () => {
    const d = decide("forum", ctx(), emptyInventory("forum"), {}, goal);
    const g = d.adaptations.find((a) => a.pattern === "emphasize_goal");
    expect(g).toBeDefined();
    expect(g!.op).toBe("emphasize");
    expect(g!.target).toBe("#register-btn");
  });

  it("does nothing when no goal is configured (unconfigured sites unaffected)", () => {
    const d = decide("forum", ctx(), emptyInventory("forum"));
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("emphasize_goal");
  });

  it("fires for every visitor context (goal-first, not playbook-gated)", () => {
    for (const c of [
      ctx({ trafficSource: "google_ads", device: "mobile" }),
      ctx({ isReturning: true }),
      ctx({ trafficSource: "linkedin" }),
    ]) {
      const d = decide("forum", c, emptyInventory("forum"), {}, goal);
      expect(d.adaptations.map((a) => a.pattern)).toContain("emphasize_goal");
    }
  });

  it("goal presence changes the decisionId (id reflects engine inputs)", () => {
    const withGoal = decide("forum", ctx(), emptyInventory("forum"), {}, goal);
    const without = decide("forum", ctx(), emptyInventory("forum"));
    expect(withGoal.decisionId).not.toBe(without.decisionId);
  });
});

describe("decide — page-aware goal", () => {
  const goal = { selector: "#register-btn", url: null };

  it("suppresses emphasize_goal on a conversion page (visitor is already there)", () => {
    const d = decide(
      "forum",
      ctx({ pageType: "conversion", url: "https://example.com/skapa-konto" }),
      emptyInventory("forum"),
      {},
      goal,
    );
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("emphasize_goal");
  });

  it("keeps emphasize_goal on home and content pages", () => {
    for (const pageType of ["home", "content"] as const) {
      const d = decide("forum", ctx({ pageType }), emptyInventory("forum"), {}, goal);
      expect(d.adaptations.map((a) => a.pattern)).toContain("emphasize_goal");
    }
  });

  it("pageType changes the decisionId", () => {
    const a = decide("forum", ctx({ pageType: "home" }), emptyInventory("forum"), {}, goal);
    const b = decide("forum", ctx({ pageType: "content" }), emptyInventory("forum"), {}, goal);
    expect(a.decisionId).not.toBe(b.decisionId);
  });
});

describe("emphasize_goal — label rides along as cross-page locator", () => {
  it("sets anchorText from the goal text so subpages resolve by label", () => {
    const d = decide(
      "t",
      ctx({ trafficSource: "google", device: "mobile", pageType: "content" }),
      emptyInventory("t"),
      {},
      { selector: "a:nth-of-type(2) > button", text: "Skapa konto" },
    );
    const emph = d.adaptations.find((a) => a.pattern === "emphasize_goal");
    expect(emph?.target).toBe("a:nth-of-type(2) > button");
    expect(emph?.anchorText).toBe("Skapa konto");
  });
});

describe("levers — sticky goal shortcut and softer secondary CTA", () => {
  const goal = { selector: "#signup", text: "Skapa konto" };
  const invWithAlt = (): ReturnType<typeof emptyInventory> => ({
    site: "t",
    slots: {
      cta: [
        {
          id: "c-goal",
          slot: "cta" as const,
          text: "Skapa konto",
          selector: "#signup",
          meta: { role: "acquisition", href: "/skapa-konto" },
        },
        {
          id: "c-alt",
          slot: "cta" as const,
          text: "Se hur det fungerar",
          selector: "#how",
          meta: { role: "acquisition", href: "/sa-funkar-det" },
        },
      ],
    },
  });

  it("never injects a floating sticky pill — mobile or desktop (non-invasive policy)", () => {
    for (const device of ["mobile", "desktop"] as const) {
      const d = decide("t", ctx({ device, pageType: "content" }), emptyInventory("t"), {}, goal);
      expect(d.adaptations.find((a) => a.pattern === "sticky_goal_cta")).toBeUndefined();
      expect(d.adaptations.some((a) => a.op === "inject_sticky")).toBe(false);
    }
  });

  it("never injects a secondary CTA link — cold or warm visitors", () => {
    const cold = decide("t", ctx({ isReturning: false, visitCount: 0, pageType: "home" }), invWithAlt(), {}, goal);
    expect(cold.adaptations.find((a) => a.pattern === "show_secondary_cta")).toBeUndefined();
    expect(cold.adaptations.some((a) => a.op === "inject_secondary")).toBe(false);
  });
});

describe("design integrity — the page stays the customer's", () => {
  const goal = { selector: "#signup", text: "Skapa konto" };
  const richInventory = () => ({
    site: "t",
    slots: {
      cta: [
        { id: "c0", slot: "cta" as const, text: "Skapa konto", selector: "#signup", meta: { role: "acquisition", href: "/s" } },
        { id: "c1", slot: "cta" as const, text: "Se hur det fungerar", selector: "#how", meta: { role: "acquisition", href: "#how" } },
      ],
      microcopy: [
        { id: "m0", slot: "microcopy" as const, text: "Inget kort krävs", meta: { kind: "no_credit_card" } },
      ],
    },
  });

  it("never applies more than MAX_ADAPTATIONS (3)", () => {
    // Mobile + cold + google: many rules fire, the cap must hold.
    const d = decide(
      "t",
      ctx({ device: "mobile", trafficSource: "google", isReturning: false, visitCount: 0, pageType: "content" }),
      richInventory(),
      {},
      goal,
    );
    expect(d.adaptations.length).toBeLessThanOrEqual(3);
  });

  it("NEVER adds an element to the page — zero injections, any visitor", () => {
    // Sweep the visitor space that used to trigger sticky / secondary / badge.
    const contexts = [
      ctx({ device: "mobile", isReturning: false, visitCount: 0, pageType: "content" }),
      ctx({ device: "desktop", isReturning: false, visitCount: 0, pageType: "home" }),
      ctx({ trafficSource: "google_ads", isReturning: false }),
      ctx({ isReturning: true, viewedPricing: true }),
      ctx({ device: "mobile", trafficSource: "google" }),
    ];
    for (const c of contexts) {
      const d = decide("t", c, richInventory(), {}, goal);
      const injects = d.adaptations.filter((a) =>
        ["inject_sticky", "inject_secondary", "inject_badge"].includes(a.op),
      );
      expect(injects).toEqual([]);
    }
  });
});
