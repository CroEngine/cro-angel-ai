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

  it("injects at most ONE added element per page (sticky beats secondary by priority)", () => {
    const d = decide(
      "t",
      ctx({ device: "mobile", isReturning: false, visitCount: 0, pageType: "content" }),
      richInventory(),
      {},
      goal,
    );
    const injects = d.adaptations.filter((a) =>
      ["inject_sticky", "inject_secondary", "inject_badge"].includes(a.op),
    );
    expect(injects.length).toBe(1);
    expect(injects[0].pattern).toBe("sticky_goal_cta"); // highest-priority injection wins
  });

  it("desktop cold visitors get the secondary link as their single injection", () => {
    const d = decide(
      "t",
      ctx({ device: "desktop", isReturning: false, visitCount: 0, pageType: "home" }),
      richInventory(),
      {},
      goal,
    );
    const injects = d.adaptations.filter((a) =>
      ["inject_sticky", "inject_secondary", "inject_badge"].includes(a.op),
    );
    expect(injects.map((a) => a.pattern)).toEqual(["show_secondary_cta"]);
  });
});

describe("clarify_cta — goal-kind-aware label preference (one goal vocabulary)", () => {
  it("a confirmed contact/lead goal steers clarify_cta to the sales label, not demo", () => {
    // Lead-gen site: the judge ranked "contact" as the goal kind and the owner
    // confirmed it. The engine must not undo that by assuming SaaS demo/trial.
    const d = decide(
      "leadgen",
      ctx({ trafficSource: "linkedin" }),
      demo,
      {},
      { selector: "#goal", text: "Kontakta oss", kind: "contact" },
    );
    const cta = d.adaptations.find((a) => a.pattern === "clarify_cta");
    expect(cta?.value).toBe("Contact Sales");
    expect(cta?.reason).toContain("sales");
  });

  it("sales-only inventories are reachable via the preference chain (no dead inventory)", () => {
    // Before: ctaIntent() only ever asked for demo|trial, so a site whose only
    // published variants are the sales motion never clarified anything.
    const inv = emptyInventory("salesled");
    inv.slots.cta = [
      {
        id: "c-1",
        slot: "cta",
        text: "Kontakta säljteamet",
        selector: "#cta",
        meta: { role: "acquisition", intent: "sales" },
      },
      {
        id: "c-2",
        slot: "cta",
        text: "Prata med oss",
        selector: "#cta",
        meta: { role: "acquisition", intent: "sales" },
      },
    ];
    const d = decide("salesled", ctx({ trafficSource: "google_ads" }), inv);
    const cta = d.adaptations.find((a) => a.pattern === "clarify_cta");
    expect(cta?.value).toBe("Kontakta säljteamet");
    expect(cta?.reason).toContain("sales"); // strict match — never misreported
  });

  it("no wrong-intent fallback: unstamped multi-label CTAs stay untouched", () => {
    // Two labels on the same element but NO intent stamps: the old first-item
    // fallback would have retexted this to "Läs mer" and reported
    // "(intent: trial)". Strict matching declines instead.
    const inv = emptyInventory("plain");
    inv.slots.cta = [
      {
        id: "c-a",
        slot: "cta",
        text: "Läs mer",
        selector: "#only",
        meta: { role: "acquisition" }, // no intent stamped at all
      },
      {
        id: "c-b",
        slot: "cta",
        text: "Utforska mer",
        selector: "#only",
        meta: { role: "acquisition" },
      },
    ];
    const d = decide("plain", ctx({ trafficSource: "google_ads" }), inv);
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("clarify_cta");
  });

  it("the goal kind is a real engine input: it changes the decisionId", () => {
    const base = { selector: "#goal", text: "Boka möte" };
    const a = decide("t", ctx(), demo, {}, { ...base, kind: "contact" });
    const b = decide("t", ctx(), demo, {}, { ...base, kind: "trial" });
    expect(a.decisionId).not.toBe(b.decisionId);
  });
});

describe("decide — auth pages are not conversion pages (A3)", () => {
  const goal = { selector: "#signup", text: "Skapa konto" };

  it("keeps goal decoration on auth pages — the mis-clicked visitor needs it most", () => {
    const d = decide(
      "t",
      ctx({ pageType: "auth", url: "https://example.com/logga-in" }),
      emptyInventory("t"),
      {},
      goal,
    );
    expect(d.adaptations.map((a) => a.pattern)).toContain("emphasize_goal");
  });

  it("still suppresses goal decoration on real conversion pages", () => {
    const d = decide(
      "t",
      ctx({ pageType: "conversion", url: "https://example.com/skapa-konto" }),
      emptyInventory("t"),
      {},
      goal,
    );
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("emphasize_goal");
  });
});

describe("decide — decline reasons (C3) and the micro-nudge floor (D3)", () => {
  const goal = { selector: "#signup", text: "Skapa konto" };

  it("says WHY nothing was decided on a conversion page", () => {
    const d = decide(
      "t",
      ctx({ pageType: "conversion", device: "mobile", url: "https://x.se/skapa-konto" }),
      emptyInventory("t"),
      {},
      goal,
    );
    expect(d.adaptations).toEqual([]);
    const reasons = new Set((d.declined ?? []).map((x) => x.reason));
    expect(reasons.has("conversion_page")).toBe(true); // goal patterns stepped aside
    expect(reasons.has("no_inventory_for_slot")).toBe(true); // rest lacked content
  });

  it("thin inventories decline with inventory reasons, not silence", () => {
    const d = decide("t", ctx(), emptyInventory("t"));
    expect(d.adaptations).toEqual([]);
    expect((d.declined ?? []).length).toBeGreaterThan(0);
    expect((d.declined ?? []).some((x) => x.reason === "no_goal_configured")).toBe(true);
  });

  it("a micro nudge can demote but never zero out the baseline pattern (D3)", () => {
    // Inventory with ONLY setup_time microcopy: show_2min_setup is the sole
    // injectable nominee (no_credit_card/continuity decline for lack of
    // content), so the injection budget can't mask the floor under test.
    // A -10 engagement nudge used to hit the priority>0 filter and silently
    // kill the priority-10 baseline site-wide; now it floors at 1 and fires.
    const inv = emptyInventory("lowvol");
    inv.slots.microcopy = [
      { id: "mc-setup", slot: "microcopy", text: "2 minute setup", meta: { kind: "setup_time" } },
    ];
    const c = ctx();
    const base = decide("lowvol", c, inv).adaptations.map((a) => a.pattern);
    expect(base).toContain("show_2min_setup");
    const nudged = decide("lowvol", c, inv, { show_2min_setup: -10 });
    expect(nudged.adaptations.map((a) => a.pattern)).toContain("show_2min_setup");
    expect(
      nudged.adaptations.find((a) => a.pattern === "show_2min_setup")!.priority,
    ).toBe(1);
    // Only a significant-conversion verdict may remove it.
    const suppressed = decide("lowvol", c, inv, { show_2min_setup: PERF_SUPPRESS });
    expect(suppressed.adaptations.map((a) => a.pattern)).not.toContain("show_2min_setup");
  });
});

describe("decide — goal-conditioned pattern eligibility (target arch step 4)", () => {
  // An inventory with the SaaS microcopy + a testimonial + guarantee, so the
  // SaaS/vertical patterns WOULD fire on content grounds — goal-kind gating is
  // the only thing that can stop them.
  const richInv = () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "mc-setup", slot: "microcopy", text: "2 minute setup", meta: { kind: "setup_time" } },
      { id: "mc-nocc", slot: "microcopy", text: "No credit card required", meta: { kind: "no_credit_card" } },
    ];
    inv.slots.testimonial = [
      { id: "t1", slot: "testimonial", selector: '[data-angel-slot="testimonial"]' },
    ];
    inv.slots.guarantee = [
      { id: "g1", slot: "guarantee", selector: '[data-angel-slot="guarantee"]' },
    ];
    return inv;
  };

  it("a confirmed donate goal suppresses the SaaS 'setup'/'no credit card' badges", () => {
    const inv = richInv();
    const donate = decide("t", ctx(), inv, {}, { selector: "#g", text: "Ge en gåva", kind: "donate" });
    const patterns = donate.adaptations.map((a) => a.pattern);
    expect(patterns).not.toContain("show_2min_setup");
    expect(patterns).not.toContain("show_no_credit_card");
    // ...and the decline is explained (C3), not silent.
    const reasons = (donate.declined ?? []).filter((d) => d.reason === "goal_kind_mismatch");
    expect(reasons.map((d) => d.pattern)).toContain("show_2min_setup");
  });

  it("a confirmed purchase goal suppresses show_enterprise_testimonial (the load-bearing case)", () => {
    // resolve() reveals ANY testimonial, so ONLY goal-kind gating stops a
    // webshop's LinkedIn visitor from getting a testimonial under 'enterprise'.
    const inv = richInv();
    const buyer = decide(
      "t",
      ctx({ trafficSource: "linkedin", device: "desktop" }),
      inv,
      {},
      { selector: "#buy", text: "Köp nu", kind: "purchase" },
    );
    expect(buyer.adaptations.map((a) => a.pattern)).not.toContain("show_enterprise_testimonial");
  });

  it("the same SaaS patterns DO fire for a confirmed trial goal (positive control)", () => {
    // Isolate the injection budget: ONLY setup_time microcopy, so
    // show_2min_setup (baseline, inject_badge) is the sole inject candidate and
    // isn't out-competed by a higher-priority inject (e.g. show_no_credit_card).
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "mc-setup", slot: "microcopy", text: "2 minute setup", meta: { kind: "setup_time" } },
    ];
    const trial = decide("t", ctx(), inv, {}, { selector: "#t", text: "Prova gratis", kind: "trial" });
    // trial is in show_2min_setup.appliesTo → eligible, so it fires.
    expect(trial.adaptations.map((a) => a.pattern)).toContain("show_2min_setup");
    // ...and it is NOT recorded as a goal-kind decline.
    expect((trial.declined ?? []).some((d) => d.pattern === "show_2min_setup")).toBe(false);
  });

  it("no confirmed kind → no gating (backward compatible with every prior test)", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "mc-setup", slot: "microcopy", text: "2 minute setup", meta: { kind: "setup_time" } },
    ];
    const withKind = decide("t", ctx(), inv, {}, { selector: "#g", text: "x", kind: "donate" });
    const noKind = decide("t", ctx(), inv, {}, { selector: "#g", text: "x" }); // kind undefined
    // The donate site loses the SaaS badge (gated); the no-kind site keeps it.
    expect(withKind.adaptations.map((a) => a.pattern)).not.toContain("show_2min_setup");
    expect((withKind.declined ?? []).some(
      (d) => d.pattern === "show_2min_setup" && d.reason === "goal_kind_mismatch",
    )).toBe(true);
    expect(noKind.adaptations.map((a) => a.pattern)).toContain("show_2min_setup");
  });

  it("agnostic patterns (emphasize_goal) fire regardless of goal kind", () => {
    for (const kind of ["donate", "purchase", "subscribe", "booking"] as const) {
      const d = decide("t", ctx(), emptyInventory("t"), {}, { selector: "#g", text: "x", kind });
      expect(d.adaptations.map((a) => a.pattern)).toContain("emphasize_goal");
    }
  });
});

describe("decide — våg 8: vertikala mönster mot arketypformade inventorier", () => {
  // Varje inventory speglar den frusna arketypens VERKLIGA innehåll
  // (docs/wave8-pattern-spec.md testplaner) så enhetstesterna pinnar samma
  // beteende som robustness-körningarna verifierar mot capturen.

  it("S4 donate (cancerfonden): månadsgivar-CTA:n injiceras bredvid gåvomålet", () => {
    const inv = emptyInventory("t");
    inv.slots.cta = [
      { id: "c1", slot: "cta", text: "Bli månadsgivare", selector: "#m",
        meta: { href: "/stod-oss/bli-manadsgivare" } },
      { id: "c2", slot: "cta", text: "Företag", selector: "#f", meta: { href: "/foretag" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#gava", text: "Ge en gåva", kind: "donate" });
    const monthly = d.adaptations.find((a) => a.pattern === "show_monthly_giving_option");
    expect(monthly?.op).toBe("inject_secondary");
    expect(monthly?.value).toBe("Bli månadsgivare");
    expect(monthly?.href).toBe("/stod-oss/bli-manadsgivare");
    expect(monthly?.target).toBe("#gava");
    // Den specialiserade motionen (56) vinner injektionsbudgeten över den
    // generiska show_secondary_cta (55).
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_secondary_cta");
  });

  it("S4 declinar utan publicerad månadsgivar-CTA — hittar aldrig på en", () => {
    const inv = emptyInventory("t");
    inv.slots.cta = [
      { id: "c1", slot: "cta", text: "Swisha", selector: "#s", meta: { href: "/swish" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#gava", text: "Ge en gåva", kind: "donate" });
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_monthly_giving_option");
    expect((d.declined ?? []).some(
      (x) => x.pattern === "show_monthly_giving_option" && x.reason === "no_secondary_alternative",
    )).toBe(true);
  });

  it("S5 lead/quote (sector-alarm): callback-CTA:n injiceras bredvid prismålet", () => {
    const inv = emptyInventory("t");
    inv.slots.cta = [
      { id: "c1", slot: "cta", text: "Låt oss kontakta dig!", selector: "#cb",
        meta: { href: "/kontakta-oss" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#pris", text: "Få pris på larm", kind: "quote" });
    const cb = d.adaptations.find((a) => a.pattern === "show_callback_option");
    expect(cb?.value).toBe("Låt oss kontakta dig!");
    expect(cb?.href).toBe("/kontakta-oss");
  });

  it("S2 booking (bokadirekt-service): sajtens eget betyg blir badge vid målet", () => {
    const inv = emptyInventory("t");
    inv.slots.trust_badge = [
      { id: "r1", slot: "trust_badge", text: "2138 betyg", selector: "#rating",
        meta: { trustType: "review_rating" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#boka", text: "Boka", kind: "booking" });
    const badge = d.adaptations.find((a) => a.pattern === "show_rating_near_goal");
    expect(badge?.op).toBe("inject_badge");
    expect(badge?.value).toBe("2138 betyg");
    // W8-E1: målankrad, inte demo-slot-konventionen.
    expect(badge?.target).toBe("#boka");
    expect(badge?.anchorText).toBe("Boka");
  });

  it("S2: en certifiering får ALDRIG rendera under betygsetiketten (predikat + form)", () => {
    const inv = emptyInventory("t");
    inv.slots.trust_badge = [
      { id: "cert", slot: "trust_badge", text: "GDPR-certifierad", selector: "#c",
        meta: { trustType: "certification" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#boka", text: "Boka", kind: "booking" });
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_rating_near_goal");
    expect((d.declined ?? []).some(
      (x) => x.pattern === "show_rating_near_goal" && x.reason === "no_inventory_for_slot",
    )).toBe(true);
  });

  it("S3 purchase (cdon): publicerad betaltrygghet blir badge; declinar ärligt utan", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "ps", slot: "microcopy", text: "Säker betalning", meta: { kind: "payment_security" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#kop", text: "Köp nu", kind: "purchase" });
    const badge = d.adaptations.find((a) => a.pattern === "show_payment_security");
    expect(badge?.value).toBe("Säker betalning");
    expect(badge?.target).toBe("#kop");

    const bare = decide("t", ctx(), emptyInventory("t"), {}, { selector: "#kop", text: "Köp nu", kind: "purchase" });
    expect((bare.declined ?? []).some(
      (x) => x.pattern === "show_payment_security" && x.reason === "no_microcopy",
    )).toBe(true);
  });

  it("S3/S6 gate:as på fel måltyp (signup/lead får ingen betal-/avsluta-badge)", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "ps", slot: "microcopy", text: "Säker betalning", meta: { kind: "payment_security" } },
      { id: "g", slot: "microcopy", text: "Avsluta när du vill", meta: { kind: "guarantee" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#s", text: "Skapa konto", kind: "signup" });
    const declinedKinds = (d.declined ?? []).filter((x) => x.reason === "goal_kind_mismatch");
    expect(declinedKinds.map((x) => x.pattern)).toContain("show_payment_security");
    expect(declinedKinds.map((x) => x.pattern)).toContain("show_cancel_anytime");
  });

  it("S6 subscribe (nextory): 'Avsluta när du vill' blir badge när betaltrygghet saknas", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "g", slot: "microcopy", text: "Avsluta när du vill", meta: { kind: "guarantee" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#prova", text: "Prova gratis nu", kind: "subscribe" });
    const badge = d.adaptations.find((a) => a.pattern === "show_cancel_anytime");
    expect(badge?.value).toBe("Avsluta när du vill");
    expect(badge?.target).toBe("#prova");
  });

  it("S1 (alla köptunga vertikaler): recensionssektionen flyttas upp för förstagångare", () => {
    const inv = emptyInventory("t");
    inv.slots.testimonial = [
      { id: "t1", slot: "testimonial", selector: "#reviews", text: "Omdömen" },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#kop", text: "Köp nu", kind: "purchase" });
    const mv = d.adaptations.find((a) => a.pattern === "move_reviews_up");
    expect(mv?.op).toBe("move_up");
    expect(mv?.target).toBe("#reviews");
    // ...men inte för en donate-sajt (gåvan har ingen produktrecension-motion).
    const donate = decide("t", ctx(), inv, {}, { selector: "#g", text: "Ge en gåva", kind: "donate" });
    expect((donate.declined ?? []).some(
      (x) => x.pattern === "move_reviews_up" && x.reason === "goal_kind_mismatch",
    )).toBe(true);
  });

  it("W8-E1-regression: befintliga badges målankras när mål finns, demo-slot annars", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "mc", slot: "microcopy", text: "No credit card required", meta: { kind: "no_credit_card" } },
    ];
    const withGoal = decide(
      "t", ctx({ trafficSource: "google_ads" }), inv, {},
      { selector: "#trial", text: "Prova gratis", kind: "trial" },
    );
    const anchored = withGoal.adaptations.find((a) => a.pattern === "show_no_credit_card");
    expect(anchored?.target).toBe("#trial");
    expect(anchored?.anchorText).toBe("Prova gratis");

    const noGoal = decide("t", ctx({ trafficSource: "google_ads" }), inv);
    const fallback = noGoal.adaptations.find((a) => a.pattern === "show_no_credit_card");
    expect(fallback?.target).toBe('[data-angel-slot="cta"]');
  });
});
