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

// Ägarregeln (2026-07-28): "vi behöver inte hålla på att highlighta knappar
// osv heller — vi ska endast skicka runt färdiga stycken." Dag-1-vokabulären
// är OMFLYTT: dekorationsklassen (badges/chips, sekundärlänkar, knapptext-
// byten, reveal/condense) declinar alltid med op_not_in_owner_vocabulary.
// Flytt-mönstren (nivå 3) behåller sitt opt-in-krav — utan opt-in är golvet
// TYST tills ägaren aktiverat layout eller godkänt en variant.
describe("decide — blueprint scenarios (ägarregeln: endast omflytt)", () => {
  it("Visitor 1: LinkedIn, desktop → TYST utan opt-in; dekorationerna declinar typat", () => {
    const d = decide(
      "demo",
      ctx({ trafficSource: "linkedin", device: "desktop", isReturning: false }),
      demo,
    );
    expect(d.adaptations).toEqual([]);
    // Flytten: kvar bakom layout-opt-in (befintlig regel, oförändrad).
    expect((d.declined ?? []).some(
      (x) => x.pattern === "show_customer_logos_early" && x.reason === "layout_level_disabled",
    )).toBe(true);
    // Dekorationsklassen: vokabulär-decline, aldrig inventory-skäl.
    for (const p of ["show_case_study", "clarify_cta"] as const) {
      expect((d.declined ?? []).some(
        (x) => x.pattern === p && x.reason === "op_not_in_owner_vocabulary",
      )).toBe(true);
    }
    // Med opt-in: flytten är HELA leveransen.
    const optIn = decide("demo", ctx({ trafficSource: "linkedin", device: "desktop" }), demo, {}, undefined, {
      allowLayoutPatterns: true,
    });
    expect(optIn.adaptations.map((a) => a.pattern)).toContain("show_customer_logos_early");
    expect(optIn.adaptations.every((a) => a.op === "move_up")).toBe(true);
  });

  it("Visitor 2: Google, mobile → condense/set_text ur vokabulären även MED opt-in", () => {
    const optIn = decide("demo", ctx({ trafficSource: "google", device: "mobile" }), demo, {}, undefined, {
      allowLayoutPatterns: true,
    });
    const patterns = optIn.adaptations.map((a) => a.pattern);
    // shorten_hero är nivå 3 och passerar nivågrinden med opt-in — men op:en
    // är condense, inte omflytt ⇒ vokabulär-decline. clarify (set_text) samma.
    expect(patterns).not.toContain("shorten_hero");
    expect(patterns).not.toContain("clarify_cta");
    expect((optIn.declined ?? []).some(
      (x) => x.pattern === "shorten_hero" && x.reason === "op_not_in_owner_vocabulary",
    )).toBe(true);
    // Flytten lever: move_faq_up är omflytt av ett färdigt stycke.
    expect(patterns).toContain("move_faq_up");
  });

  it("Visitor 3: returning + pricing → pris-FLYTTEN med opt-in; continue-badgen aldrig", () => {
    const goal = { selector: "#cta", text: "Start Free Trial" };
    const c = ctx({ isReturning: true, visitCount: 2, viewedPricing: true });
    const narrow = decide("demo", c, demo, {}, goal);
    expect(narrow.adaptations).toEqual([]);
    expect((narrow.declined ?? []).some(
      (x) => x.pattern === "continue_where_left_off" && x.reason === "op_not_in_owner_vocabulary",
    )).toBe(true);
    const optIn = decide("demo", c, demo, {}, goal, { allowLayoutPatterns: true });
    expect(optIn.adaptations.map((a) => a.pattern)).toContain("surface_pricing");
    expect(optIn.adaptations.map((a) => a.pattern)).not.toContain("continue_where_left_off");
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

  it("ägarregeln: dekorationsklassen kan ALDRIG vinna en plats — flytten är vokabulären", () => {
    // Före 2026-07-28 vann de lättaste opsen (set_text/reveal) platserna via
    // minsta-ingrepps-tiebreaken och flytten cap:ades ut. Med ägarregeln är
    // dekorationsklassen aldrig nominerbar: flytten tar platsen, resten
    // declinar typat.
    const d = decide("demo", ctx({ trafficSource: "linkedin", device: "desktop" }), demo, {}, undefined, {
      allowLayoutPatterns: true,
    });
    const patterns = d.adaptations.map((a) => a.pattern);
    expect(patterns).toContain("show_customer_logos_early");
    expect(patterns).not.toContain("clarify_cta");
    expect(patterns).not.toContain("show_case_study");
    expect(d.adaptations.every((a) => a.op === "move_up")).toBe(true);
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
    // Opt-in krävs sedan ägarregeln — utan den är golvet tomt by design.
    const d = decide("demo", ctx({ trafficSource: "linkedin" }), demo, {}, undefined, {
      allowLayoutPatterns: true,
    });
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
    // Flytt-subjekt sedan ägarregeln (dekorationsklassen nomineras aldrig).
    const c = ctx({ trafficSource: "linkedin", device: "desktop" });
    const opts = { allowLayoutPatterns: true };
    const base = decide("demo", c, demo, {}, undefined, opts).adaptations.map((a) => a.pattern);
    expect(base).toContain("show_customer_logos_early");

    const d = decide("demo", c, demo, { show_customer_logos_early: PERF_SUPPRESS }, undefined, opts);
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("show_customer_logos_early");
  });

  it("adds the boost to a winning pattern's effective priority", () => {
    // Logo-flytten kommer ur linkedin_b2b-regeln på prioritet 80; boosten ska
    // lyfta rapporterad prioritet med exakt PERF_MAX_BOOST.
    const c = ctx({ trafficSource: "linkedin", device: "desktop" });
    const mv = decide(
      "demo", c, demo, { show_customer_logos_early: PERF_MAX_BOOST }, undefined,
      { allowLayoutPatterns: true },
    ).adaptations.find((a) => a.pattern === "show_customer_logos_early");
    expect(mv).toBeDefined();
    expect(mv!.priority).toBe(80 + PERF_MAX_BOOST);
  });

  it("keeps ordering by descending (boosted) priority", () => {
    const c = ctx({ trafficSource: "linkedin", device: "mobile", isReturning: true, viewedPricing: true });
    const d = decide("demo", c, demo, { move_faq_up: PERF_MAX_BOOST }, undefined, {
      allowLayoutPatterns: true,
    });
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

  it("injektioner vid målet finns inte längre — dekorationsklassen declinar (ägarregeln 2026-07-28)", () => {
    const d = decide("t", ctx({ isReturning: false, visitCount: 0, pageType: "home" }), demo, {}, goal);
    // INGET får ankra vid målet: badges/secondary är ur vokabulären helt.
    expect(d.adaptations.find((a) => a.target === goal.selector)).toBeUndefined();
    expect(d.adaptations.every((a) => a.op === "move_up")).toBe(true);
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

  it("secondary declinar ALLTID med vokabulärskälet — även med perfekt publicerat alternativ (ägarregeln 2026-07-28)", () => {
    // Före ägarregeln var det här mönstrets rika interna vakter (distinkt
    // alternativ, href-hygien, mål-dubblettskydd) i drift — nu nomineras
    // op-klassen aldrig, så vakterna är vilande och kontraktet är declinen.
    const cold = decide(
      "t",
      ctx({ isReturning: false, visitCount: 0, pageType: "home" }),
      invWithAlt(),
      {},
      goal,
    );
    expect(cold.adaptations.find((a) => a.pattern === "show_secondary_cta")).toBeUndefined();
    expect((cold.declined ?? []).some(
      (x) => x.pattern === "show_secondary_cta" && x.reason === "op_not_in_owner_vocabulary",
    )).toBe(true);
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
    // Skärpt av ägarregeln 2026-07-28: injektionsbudgeten var "max EN" —
    // nu är den NOLL. Angel lägger aldrig till element på sidan.
    expect(injects.length).toBe(0);
  });

  it("desktop cold visitors: ingen injektion alls — endast omflytt (ägarregeln)", () => {
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
    expect(injects).toEqual([]);
    expect(d.adaptations.every((a) => a.op === "move_up")).toBe(true);
  });
});

describe("clarify_cta — ur vokabulären (ägarregeln 2026-07-28)", () => {
  it("knapptext-byten nomineras aldrig — även perfekt intent-stämplat inventory declinar typat", () => {
    // Den goal-kind-medvetna etikettpreferensen (sales/demo/trial-kedjan)
    // ligger vilande bakom vokabulärgrinden — knappens text är kundens.
    const d = decide(
      "leadgen",
      ctx({ trafficSource: "linkedin" }),
      demo,
      {},
      { selector: "#goal", text: "Kontakta oss", kind: "contact" },
    );
    expect(d.adaptations.map((a) => a.pattern)).not.toContain("clarify_cta");
    expect((d.declined ?? []).some(
      (x) => x.pattern === "clarify_cta" && x.reason === "op_not_in_owner_vocabulary",
    )).toBe(true);
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
    // Flytt-subjekt sedan ägarregeln: med opt-in når flytt-mönstren
    // inventeringsgrinden — tom slot ⇒ typat inventory-skäl, aldrig tystnad.
    const d = decide(
      "t",
      ctx({ trafficSource: "google", device: "mobile" }),
      emptyInventory("t"),
      {},
      undefined,
      { allowLayoutPatterns: true },
    );
    expect(d.adaptations).toEqual([]);
    expect((d.declined ?? []).some(
      (x) => x.pattern === "move_faq_up" && x.reason === "no_inventory_for_slot",
    )).toBe(true);
  });

  it("en mikro-nudge demoterar men nollar aldrig — bara PERF_SUPPRESS tar bort (D3)", () => {
    // D3-golvet på flytt-subjekt sedan ägarregeln (baseline-badgen som förr
    // bevisade ===1-golvet ligger bakom vokabulärgrinden och kan inte eldas).
    const inv = emptyInventory("lowvol");
    inv.slots.faq = [{ id: "f", slot: "faq", selector: "#faq", text: "Vanliga frågor" }];
    const c = ctx({ trafficSource: "google", device: "mobile" });
    const opts = { allowLayoutPatterns: true };
    const base = decide("lowvol", c, inv, {}, goal, opts);
    const basePrio = base.adaptations.find((a) => a.pattern === "move_faq_up")?.priority;
    expect(basePrio).toBeDefined();
    const nudged = decide("lowvol", c, inv, { move_faq_up: -10 }, goal, opts);
    const nudgedMv = nudged.adaptations.find((a) => a.pattern === "move_faq_up");
    expect(nudgedMv).toBeDefined();
    expect(nudgedMv!.priority).toBe(basePrio! - 10);
    // Only a significant-conversion verdict may remove it.
    const suppressed = decide("lowvol", c, inv, { move_faq_up: PERF_SUPPRESS }, goal, opts);
    expect(suppressed.adaptations.map((a) => a.pattern)).not.toContain("move_faq_up");
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

  it("rätt måltyp FÅR flytten att elda (positiv kontroll, flytt-subjekt sedan ägarregeln)", () => {
    const inv = emptyInventory("t");
    inv.slots.customer_logos = [{ id: "l", slot: "customer_logos", selector: "#logos" }];
    const trial = decide(
      "t",
      ctx({ trafficSource: "linkedin", device: "desktop" }),
      inv,
      {},
      { selector: "#t", text: "Prova gratis", kind: "trial" },
      { allowLayoutPatterns: true },
    );
    // trial ∈ show_customer_logos_early.appliesTo → eldar.
    expect(trial.adaptations.map((a) => a.pattern)).toContain("show_customer_logos_early");
    expect((trial.declined ?? []).some((d) => d.pattern === "show_customer_logos_early")).toBe(false);
  });

  it("no confirmed kind → no gating (backward compatible), flytt-subjekt", () => {
    const inv = emptyInventory("t");
    inv.slots.customer_logos = [{ id: "l", slot: "customer_logos", selector: "#logos" }];
    const c = ctx({ trafficSource: "linkedin", device: "desktop" });
    const opts = { allowLayoutPatterns: true };
    const withKind = decide("t", c, inv, {}, { selector: "#g", text: "x", kind: "donate" }, opts);
    const noKind = decide("t", c, inv, {}, { selector: "#g", text: "x" }, opts);
    // Donate-sajten förlorar logo-flytten (gated); no-kind-sajten behåller den.
    expect(withKind.adaptations.map((a) => a.pattern)).not.toContain("show_customer_logos_early");
    expect((withKind.declined ?? []).some(
      (d) => d.pattern === "show_customer_logos_early" && d.reason === "goal_kind_mismatch",
    )).toBe(true);
    expect(noKind.adaptations.map((a) => a.pattern)).toContain("show_customer_logos_early");
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

  // Ägarregeln (2026-07-28): hela våg 8:s injektionsklass (S2–S6 — betyg,
  // betaltrygghet, månadsgivare, callback, avsluta-när-du-vill) ligger
  // vilande bakom vokabulärgrinden. De rika interna vakterna
  // (SECONDARY_TEXT-vokabulären, sifferformen, kind-spliten, mål-dubblett-
  // skyddet) testades här förr — de nås inte längre. Kontraktet är: typad
  // decline MED perfekt inventory och RÄTT måltyp, för varje mönster.
  it("våg 8-injektionerna declinar ALLTID på vokabulären — även med perfekt inventory", () => {
    const inv = emptyInventory("t");
    inv.slots.cta = [
      { id: "c1", slot: "cta", text: "Bli månadsgivare", selector: "#m", meta: { href: "/manad" } },
      { id: "c2", slot: "cta", text: "Vi ringer upp dig", selector: "#cb", meta: { href: "/cb" } },
    ];
    inv.slots.trust_badge = [
      { id: "r", slot: "trust_badge", text: "4.8 · 2138 betyg", selector: "#r",
        meta: { trustType: "stars_aggregate" } },
    ];
    inv.slots.microcopy = [
      { id: "ps", slot: "microcopy", text: "Säker betalning", meta: { kind: "payment_security" } },
      { id: "ca", slot: "microcopy", text: "Avsluta när du vill", meta: { kind: "cancel_anytime" } },
    ];
    const cases: [PatternId, string][] = [
      ["show_monthly_giving_option", "donate"],
      ["show_callback_option", "quote"],
      ["show_rating_near_goal", "booking"],
      ["show_payment_security", "purchase"],
      ["show_cancel_anytime", "subscribe"],
    ];
    for (const [pattern, kind] of cases) {
      const d = decide("t", ctx(), inv, {}, { selector: "#goal", text: "Gör det", kind });
      expect(d.adaptations.map((a) => a.pattern)).not.toContain(pattern);
      expect((d.declined ?? []).some(
        (x) => x.pattern === pattern && x.reason === "op_not_in_owner_vocabulary",
      )).toBe(true);
    }
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

  it("W8-E1 efter ägarregeln: badgen declinar på vokabulären — aldrig applicering, aldrig mätförorening", () => {
    const inv = emptyInventory("t");
    inv.slots.microcopy = [
      { id: "mc", slot: "microcopy", text: "No credit card required", meta: { kind: "no_credit_card" } },
    ];
    const withGoal = decide(
      "t", ctx({ trafficSource: "google_ads" }), inv, {},
      { selector: "#trial", text: "Prova gratis", kind: "trial" },
    );
    expect(withGoal.adaptations.map((a) => a.pattern)).not.toContain("show_no_credit_card");
    expect((withGoal.declined ?? []).some(
      (d) => d.pattern === "show_no_credit_card" && d.reason === "op_not_in_owner_vocabulary",
    )).toBe(true);
  });
});
