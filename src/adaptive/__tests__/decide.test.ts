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

describe("decide — blueprint scenarios (v1: nivå 1–2 som standard)", () => {
  it("Visitor 1: LinkedIn, desktop, first visit → B2B-guidning utan layoutingrepp", () => {
    const d = decide(
      "demo",
      ctx({ trafficSource: "linkedin", device: "desktop", isReturning: false }),
      demo,
    );
    const patterns = d.adaptations.map((a) => a.pattern);
    // MAX_ADAPTATIONS (3) is a design-integrity contract: the page must stay
    // the customer's.
    expect(patterns.length).toBeLessThanOrEqual(3);
    // v1: logo-flytten är nivå 3 → declined med typat skäl; case study (reveal,
    // nivå 2) och clarify tar dess plats.
    expect(patterns).not.toContain("show_customer_logos_early");
    expect((d.declined ?? []).some(
      (x) => x.pattern === "show_customer_logos_early" && x.reason === "layout_level_disabled",
    )).toBe(true);
    expect(patterns).toContain("show_case_study");

    const cta = d.adaptations.find((a) => a.pattern === "clarify_cta");
    expect(cta?.op).toBe("set_text");
    expect(cta?.value).toBe("Book a demo");
  });

  it("Visitor 2: Google, mobile → guidning (clarify) — flyttarna kräver opt-in", () => {
    const d = decide("demo", ctx({ trafficSource: "google", device: "mobile" }), demo);
    const patterns = d.adaptations.map((a) => a.pattern);
    // v1: shorten_hero/move_faq_up är nivå 3 → declined som standard.
    expect(patterns).not.toContain("shorten_hero");
    expect(patterns).not.toContain("move_faq_up");
    const levelDeclines = (d.declined ?? []).filter((x) => x.reason === "layout_level_disabled");
    expect(levelDeclines.map((x) => x.pattern)).toEqual(
      expect.arrayContaining(["shorten_hero", "move_faq_up"]),
    );

    const cta = d.adaptations.find((a) => a.pattern === "clarify_cta");
    expect(cta?.value).toBe("Start Free Trial");
  });

  it("Visitor 3: returning + pricing → continue; pris-flytten kräver opt-in men funkar då", () => {
    // continue_where_left_off är en badge och badges ankras vid målet sedan
    // granskningen (utan mål = ärlig decline) — scenariot behöver sajtens goal.
    const goal = { selector: "#cta", text: "Start Free Trial" };
    const c = ctx({ isReturning: true, visitCount: 2, viewedPricing: true });
    const narrow = decide("demo", c, demo, {}, goal);
    expect(narrow.adaptations.map((a) => a.pattern)).toContain("continue_where_left_off");
    expect(narrow.adaptations.map((a) => a.pattern)).not.toContain("surface_pricing");
    // Opt-in (angel_sites.layout_patterns_enabled) återställer nivå 3 exakt
    // som förr — layouten är ett per-sajt-beslut, inte borttagen förmåga.
    const optIn = decide("demo", c, demo, {}, goal, { allowLayoutPatterns: true });
    expect(optIn.adaptations.map((a) => a.pattern)).toContain("surface_pricing");
    expect(optIn.adaptations.map((a) => a.pattern)).toContain("continue_where_left_off");
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

  it("still applies content-free ops when the slot has inventory (isolerad logo-slot)", () => {
    // v1: logo-flytten (nivå 3) kräver opt-in, och minsta-ingrepps-tiebreaken
    // rankar den under lättare mönster vid lika prioritet — så för att testa
    // att slot-inventeringen bär content-fria ops isoleras inventoriet till
    // ENBART customer_logos (konkurrenterna declinar på no_inventory).
    const inv = emptyInventory("t");
    inv.slots.customer_logos = [
      { id: "logos", slot: "customer_logos", selector: "#logos" },
    ];
    const d = decide("t", ctx({ trafficSource: "linkedin", device: "desktop" }), inv, {}, undefined, {
      allowLayoutPatterns: true,
    });
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).toContain("show_customer_logos_early");
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("minsta-ingrepps-tiebreak: vid lika prioritet vinner lättare op över flytt", () => {
    // linkedin_b2b nominerar fyra mönster på prio 80. Med layout-opt-in OCH
    // fullt inventory ska top-3 vara de tre LÄTTASTE (set_text/reveal) — logo-
    // FLYTTEN (nivå 3, move_up) rankas sist och cap:as ut. "Hur lite behöver
    // vi förändra sidan?" är kod, inte smak.
    const d = decide("demo", ctx({ trafficSource: "linkedin", device: "desktop" }), demo, {}, undefined, {
      allowLayoutPatterns: true,
    });
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).toContain("clarify_cta");
    expect(patterns).toContain("show_case_study");
    expect(patterns).not.toContain("show_customer_logos_early");
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

describe("decide — ägarregeln: målknappen är orörbar (2026-07-20)", () => {
  const goal = { selector: "#register-btn", text: "Skapa konto", url: null };

  it("emitterar ALDRIG borttagna mål-ops (emphasize/inject_sticky), oavsett kontext", () => {
    for (const c of [
      ctx(),
      ctx({ trafficSource: "google_ads", device: "mobile" }),
      ctx({ isReturning: true, viewedPricing: true }),
      ctx({ trafficSource: "linkedin", pageType: "content" }),
      ctx({ device: "mobile", pageType: "home" }),
    ]) {
      const d = decide("forum", c, demo, {}, goal);
      for (const a of d.adaptations) {
        expect(["emphasize", "inject_sticky"]).not.toContain(a.op);
      }
    }
  });

  it("en muterande op som resolvar till målet grindas bort (goal_element_untouchable)", () => {
    // move_faq_up resolvar till faq-slottens selector — pekar ägarens mål på
    // SAMMA element ska flytten vägras, inte flytta målknappens sektion.
    const inv: ReturnType<typeof emptyInventory> = {
      site: "t",
      slots: {
        faq: [{ id: "f1", slot: "faq" as const, text: "Vanliga frågor", selector: "#faq" }],
      },
    };
    const d = decide(
      "t",
      ctx({ trafficSource: "google", device: "mobile", pageType: "home" }),
      inv,
      {},
      { selector: "#faq", text: "Vanliga frågor" },
      // Nivå 3 på — annars stannar mönstret redan i layout_level_disabled
      // och grinden vi vill bevisa nås aldrig.
      { allowLayoutPatterns: true },
    );
    expect(d.adaptations.find((a) => a.target === "#faq")).toBeUndefined();
    expect(d.declined).toContainEqual({
      pattern: "move_faq_up",
      reason: "goal_element_untouchable",
    });
  });

  it("injektioner får fortfarande ANKRA vid målet (badge/secondary rör det inte)", () => {
    const d = decide("t", ctx({ isReturning: false, visitCount: 0, pageType: "home" }), demo, {}, goal);
    for (const a of d.adaptations) {
      if (a.target === goal.selector) {
        expect(["inject_badge", "inject_secondary"]).toContain(a.op);
      }
    }
  });

  it("goal presence changes the decisionId (id reflects engine inputs)", () => {
    const withGoal = decide("forum", ctx(), emptyInventory("forum"), {}, goal);
    const without = decide("forum", ctx(), emptyInventory("forum"));
    expect(withGoal.decisionId).not.toBe(without.decisionId);
  });

  it("pageType changes the decisionId", () => {
    const a = decide("forum", ctx({ pageType: "home" }), emptyInventory("forum"), {}, goal);
    const b = decide("forum", ctx({ pageType: "content" }), emptyInventory("forum"), {}, goal);
    expect(a.decisionId).not.toBe(b.decisionId);
  });
});

describe("levers — softer secondary CTA", () => {
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

  it("injects at most ONE added element per page", () => {
    const d = decide(
      "t",
      ctx({ device: "mobile", isReturning: false, visitCount: 0, pageType: "content" }),
      richInventory(),
      {},
      goal,
    );
    const injects = d.adaptations.filter((a) =>
      ["inject_secondary", "inject_badge"].includes(a.op),
    );
    expect(injects.length).toBe(1);
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

  it("auth grindas INTE blankt: mönster nomineras fortfarande (bara flyttar utesluts via avoidPageTypes)", () => {
    // Med ägarregeln finns ingen måldekoration längre — men A3-beslutet står:
    // /login är inte en konverteringssida, så auth får inga conversion_page-
    // declines (den blanketten är reserverad för riktiga målsidor).
    const d = decide(
      "t",
      ctx({ pageType: "auth", url: "https://example.com/logga-in" }),
      emptyInventory("t"),
      {},
      goal,
    );
    expect((d.declined ?? []).some((x) => x.reason === "conversion_page")).toBe(false);
  });

  it("real conversion pages blanket-decline every nominated pattern", () => {
    const d = decide(
      "t",
      ctx({ pageType: "conversion", url: "https://example.com/skapa-konto" }),
      emptyInventory("t"),
      {},
      goal,
    );
    expect(d.adaptations).toEqual([]);
    expect((d.declined ?? []).length).toBeGreaterThan(0);
    expect((d.declined ?? []).every((x) => x.reason === "conversion_page")).toBe(true);
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
    // v1: konverteringssidan är fredad för ALLA mönster (checkout-ingrepp ur
    // do-not-build-listan) — varje nominerat mönster avböjer med samma typade
    // skäl, inte en blandning av innehållsskäl.
    expect((d.declined ?? []).length).toBeGreaterThan(0);
    for (const x of d.declined ?? []) {
      expect(x.reason).toBe("conversion_page");
    }
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
    // (Badges är målankrade sedan granskningen — utan mål avböjer de, så
    // scenariot behöver sajtens goal.)
    const inv = emptyInventory("lowvol");
    inv.slots.microcopy = [
      { id: "mc-setup", slot: "microcopy", text: "2 minute setup", meta: { kind: "setup_time" } },
    ];
    const c = ctx();
    const base = decide("lowvol", c, inv, {}, goal).adaptations.map((a) => a.pattern);
    expect(base).toContain("show_2min_setup");
    const nudged = decide("lowvol", c, inv, { show_2min_setup: -10 }, goal);
    expect(nudged.adaptations.map((a) => a.pattern)).toContain("show_2min_setup");
    expect(
      nudged.adaptations.find((a) => a.pattern === "show_2min_setup")!.priority,
    ).toBe(1);
    // Only a significant-conversion verdict may remove it.
    const suppressed = decide("lowvol", c, inv, { show_2min_setup: PERF_SUPPRESS }, goal);
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

  it("agnostiska mönster grindas ALDRIG på goal-kind, oavsett kind", () => {
    // (emphasize_goal var förr testets vittne — borttaget av ägarregeln.
    // Samma invariant bevisas nu via declines: inga goal_kind_mismatch för
    // mönster utan appliesTo, t.ex. show_secondary_cta/clarify_cta.)
    const AGNOSTIC = ["show_secondary_cta", "clarify_cta", "move_faq_up", "shorten_hero"];
    for (const kind of ["donate", "purchase", "subscribe", "booking"] as const) {
      const d = decide("t", ctx(), emptyInventory("t"), {}, { selector: "#g", text: "x", kind });
      const kindDeclines = (d.declined ?? []).filter((x) => x.reason === "goal_kind_mismatch");
      for (const p of AGNOSTIC) {
        expect(kindDeclines.some((x) => x.pattern === p)).toBe(false);
      }
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
      { id: "g", slot: "microcopy", text: "Avsluta när du vill", meta: { kind: "cancel_anytime" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#s", text: "Skapa konto", kind: "signup" });
    const declinedKinds = (d.declined ?? []).filter((x) => x.reason === "goal_kind_mismatch");
    expect(declinedKinds.map((x) => x.pattern)).toContain("show_payment_security");
    expect(declinedKinds.map((x) => x.pattern)).toContain("show_cancel_anytime");
  });

  it("S6 subscribe (nextory): 'Avsluta när du vill' blir badge när betaltrygghet saknas", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "g", slot: "microcopy", text: "Avsluta när du vill", meta: { kind: "cancel_anytime" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#prova", text: "Prova gratis nu", kind: "subscribe" });
    const badge = d.adaptations.find((a) => a.pattern === "show_cancel_anytime");
    expect(badge?.value).toBe("Avsluta när du vill");
    expect(badge?.target).toBe("#prova");
  });

  it("S6: ett refund-löfte får ALDRIG rendera under avsluta-etiketten (kind-split)", () => {
    // Granskningsfynd: med delad guarantee-kind ockuperade "30 dagar pengarna
    // tillbaka" platsen och blev cancel-anytime-badgens text.
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "mb", slot: "microcopy", text: "30 dagar pengarna tillbaka", meta: { kind: "guarantee" } },
    ];
    const d = decide("t", ctx(), inv, {}, { selector: "#prova", text: "Prova gratis", kind: "subscribe" });
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_cancel_anytime");
    expect((d.declined ?? []).some(
      (x) => x.pattern === "show_cancel_anytime" && x.reason === "no_microcopy",
    )).toBe(true);
  });

  it("S4/S5: när den specialiserade CTA:n ÄR målet declinas — målet dubbleras aldrig", () => {
    // Granskningsfynd (verifierat via körning): utan destination-guard
    // injicerades målet bredvid sig självt när goal.url == CTA:ns href,
    // och en skiftlägesvariant av måltexten kringgick textjämförelsen.
    const inv = emptyInventory("t");
    inv.slots.cta = [
      { id: "c1", slot: "cta", text: "Bli månadsgivare", selector: "#m",
        meta: { href: "https://x.se/stod-oss/bli-manadsgivare/" } },
    ];
    const sameDest = decide("t", ctx(), inv, {}, {
      selector: "#m", text: "BLI MÅNADSGIVARE", kind: "donate",
      url: "/stod-oss/bli-manadsgivare",
    });
    expect(sameDest.adaptations.map((a) => a.pattern)).not.toContain("show_monthly_giving_option");
    expect((sameDest.declined ?? []).some(
      (x) => x.pattern === "show_monthly_giving_option" && x.reason === "no_secondary_alternative",
    )).toBe(true);
  });

  it("S5 pinnar vokabulär + gating: icke-callback-CTA duger inte, fel måltyp gate:as", () => {
    const inv = emptyInventory("t");
    inv.slots.cta = [
      { id: "c1", slot: "cta", text: "Läs mer om larm", selector: "#l", meta: { href: "/larm" } },
    ];
    // Vokabulären: en icke-callback-CTA matchar inte SECONDARY_TEXT → decline.
    const d = decide("t", ctx(), inv, {}, { selector: "#pris", text: "Få pris", kind: "quote" });
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_callback_option");
    expect((d.declined ?? []).some(
      (x) => x.pattern === "show_callback_option" && x.reason === "no_secondary_alternative",
    )).toBe(true);
    // Gatingen: en purchase-sajt får aldrig callback-mönstret nominerat skarpt.
    const inv2 = emptyInventory("t");
    inv2.slots.cta = [
      { id: "cb", slot: "cta", text: "Vi ringer upp dig", selector: "#cb", meta: { href: "/callback" } },
    ];
    const buyer = decide("t", ctx(), inv2, {}, { selector: "#k", text: "Köp nu", kind: "purchase" });
    expect(buyer.adaptations.map((a) => a.pattern)).not.toContain("show_callback_option");
    expect((buyer.declined ?? []).some(
      (x) => x.pattern === "show_callback_option" && x.reason === "goal_kind_mismatch",
    )).toBe(true);
  });

  it("S2 pinnar sifferformen: rätt trustType men pratig text declinar; interpunkt-formen eldar", () => {
    const talky = emptyInventory("t");
    talky.slots.trust_badge = [
      { id: "t", slot: "trust_badge", text: "Våra kunder älskar oss", selector: "#t",
        meta: { trustType: "stars" } },
    ];
    const d1 = decide("t", ctx(), talky, {}, { selector: "#boka", text: "Boka", kind: "booking" });
    expect(d1.adaptations.map((a) => a.pattern)).not.toContain("show_rating_near_goal");

    // Dokumenterad spec-avvikelse: interpunkt (·) ingår i sifferklassen —
    // "4.8 · 2138 betyg" är standardformen på ratingsammanfattningar.
    const dotted = emptyInventory("t");
    dotted.slots.trust_badge = [
      { id: "r", slot: "trust_badge", text: "4.8 · 2138 betyg", selector: "#r",
        meta: { trustType: "stars_aggregate" } },
    ];
    const d2 = decide("t", ctx(), dotted, {}, { selector: "#boka", text: "Boka", kind: "booking" });
    expect(d2.adaptations.find((a) => a.pattern === "show_rating_near_goal")?.value)
      .toBe("4.8 · 2138 betyg");
  });

  it("S1 (alla köptunga vertikaler): recensionsflytten kräver layout-opt-in (nivå 3)", () => {
    const inv = emptyInventory("t");
    inv.slots.testimonial = [
      { id: "t1", slot: "testimonial", selector: "#reviews", text: "Omdömen" },
    ];
    // v1-default: declined med typat skäl.
    const narrow = decide("t", ctx(), inv, {}, { selector: "#kop", text: "Köp nu", kind: "purchase" });
    expect((narrow.declined ?? []).some(
      (x) => x.pattern === "move_reviews_up" && x.reason === "layout_level_disabled",
    )).toBe(true);
    // Med opt-in: fungerar som designat.
    const d = decide("t", ctx(), inv, {}, { selector: "#kop", text: "Köp nu", kind: "purchase" }, {
      allowLayoutPatterns: true,
    });
    const mv = d.adaptations.find((a) => a.pattern === "move_reviews_up");
    expect(mv?.op).toBe("move_up");
    expect(mv?.target).toBe("#reviews");
    // ...men inte för en donate-sajt (gåvan har ingen produktrecension-motion).
    const donate = decide("t", ctx(), inv, {}, { selector: "#g", text: "Ge en gåva", kind: "donate" }, {
      allowLayoutPatterns: true,
    });
    expect((donate.declined ?? []).some(
      (x) => x.pattern === "move_reviews_up" && x.reason === "goal_kind_mismatch",
    )).toBe(true);
  });

  it("sidtyps-gating: flytt-mönster nomineras aldrig på content-sidor (blogg-incidenten)", () => {
    // glutenforum: move_faq_up flyttade FAQ:n ovanför blogginlägget — flytt-/
    // omordningsmönster är landningsyte-verktyg och gate:as bort på content.
    const inv = emptyInventory("t");
    inv.slots.faq = [{ id: "f", slot: "faq", selector: "#faq", text: "Vanliga frågor" }];
    // (layout-opt-in påslagen: det som testas här är SIDTYPS-grinden, som
    // gäller ÄVEN för sajter som aktiverat layoutmönster.)
    const onBlog = decide(
      "t",
      ctx({ trafficSource: "google", pageType: "content" }),
      inv,
      {},
      { selector: "#g", text: "Skapa konto", kind: "signup" },
      { allowLayoutPatterns: true },
    );
    expect(onBlog.adaptations.map((a) => a.pattern)).not.toContain("move_faq_up");
    expect((onBlog.declined ?? []).some(
      (d) => d.pattern === "move_faq_up" && d.reason === "page_type_mismatch",
    )).toBe(true);
    // …men på en landningssida (home) nomineras flytten precis som förr.
    const onHome = decide(
      "t",
      ctx({ trafficSource: "google", pageType: "home" }),
      inv,
      {},
      { selector: "#g", text: "Skapa konto", kind: "signup" },
      { allowLayoutPatterns: true },
    );
    expect(onHome.adaptations.map((a) => a.pattern)).toContain("move_faq_up");
  });

  it("W8-E1-regression: badges målankras när mål finns — utan mål ärlig decline", () => {
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

    // Demo-slot-fallbacken är borta med /demo: utan mål finns inget ankare på
    // en riktig sida — badgen no-op:ade tyst men loggades som exposure
    // (mätförorening). Nu typad decline i stället.
    const noGoal = decide("t", ctx({ trafficSource: "google_ads" }), inv);
    expect(noGoal.adaptations.map((a) => a.pattern)).not.toContain("show_no_credit_card");
    expect(
      (noGoal.declined ?? []).some(
        (d) => d.pattern === "show_no_credit_card" && d.reason === "no_goal_configured",
      ),
    ).toBe(true);
  });
});
