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
  it("Visitor 1: LinkedIn, desktop, first visit → logos early, enterprise testimonial, Book a demo, case study", () => {
    const d = decide(
      "demo",
      ctx({ trafficSource: "linkedin", device: "desktop", isReturning: false }),
      demo,
    );
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).toContain("show_customer_logos_early");
    expect(patterns).toContain("show_enterprise_testimonial");
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

  it("Visitor 3: returning, viewed pricing → surface pricing + continue where left off", () => {
    const patterns = patternsOf(ctx({ isReturning: true, visitCount: 2, viewedPricing: true }));
    expect(patterns).toContain("surface_pricing");
    expect(patterns).toContain("continue_where_left_off");
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

  it("mobile visitors get the sticky goal shortcut, desktop does not", () => {
    const mobile = decide("t", ctx({ device: "mobile", pageType: "content" }), emptyInventory("t"), {}, goal);
    const sticky = mobile.adaptations.find((a) => a.pattern === "sticky_goal_cta");
    expect(sticky?.op).toBe("inject_sticky");
    expect(sticky?.value).toBe("Skapa konto");
    expect(sticky?.anchorText).toBe("Skapa konto");

    const desktop = decide("t", ctx({ device: "desktop", pageType: "content" }), emptyInventory("t"), {}, goal);
    expect(desktop.adaptations.find((a) => a.pattern === "sticky_goal_cta")).toBeUndefined();
  });

  it("sticky requires a labelled goal and steps aside on conversion pages", () => {
    const noText = decide("t", ctx({ device: "mobile" }), emptyInventory("t"), {}, { selector: "#x" });
    expect(noText.adaptations.find((a) => a.pattern === "sticky_goal_cta")).toBeUndefined();

    const convPage = decide("t", ctx({ device: "mobile", pageType: "conversion" }), emptyInventory("t"), {}, goal);
    expect(convPage.adaptations.find((a) => a.pattern === "sticky_goal_cta")).toBeUndefined();
  });

  it("cold first-time visitors get a published softer option with its own href", () => {
    const cold = decide(
      "t",
      ctx({ isReturning: false, visitCount: 0, pageType: "home" }),
      invWithAlt(),
      {},
      goal,
    );
    const alt = cold.adaptations.find((a) => a.pattern === "show_secondary_cta");
    expect(alt?.op).toBe("inject_secondary");
    expect(alt?.value).toBe("Se hur det fungerar");
    expect(alt?.href).toBe("/sa-funkar-det");

    const warm = decide(
      "t",
      ctx({ isReturning: true, visitCount: 3, pageType: "home" }),
      invWithAlt(),
      {},
      goal,
    );
    expect(warm.adaptations.find((a) => a.pattern === "show_secondary_cta")).toBeUndefined();
  });

  it("secondary never fires without a distinct published alternative or with a javascript: href", () => {
    const onlyGoal = decide(
      "t",
      ctx({ isReturning: false, visitCount: 0 }),
      {
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
          ],
        },
      },
      {},
      goal,
    );
    expect(onlyGoal.adaptations.find((a) => a.pattern === "show_secondary_cta")).toBeUndefined();

    const evil = decide(
      "t",
      ctx({ isReturning: false, visitCount: 0 }),
      {
        site: "t",
        slots: {
          cta: [
            {
              id: "c-evil",
              slot: "cta" as const,
              text: "Se mer",
              selector: "#e",
              meta: { role: "acquisition", href: "javascript:alert(1)" },
            },
          ],
        },
      },
      {},
      goal,
    );
    expect(evil.adaptations.find((a) => a.pattern === "show_secondary_cta")).toBeUndefined();
  });
});
