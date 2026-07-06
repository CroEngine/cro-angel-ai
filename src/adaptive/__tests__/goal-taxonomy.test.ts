import { describe, it, expect } from "vitest";

import { classifyGoalKind, rankGoalCandidates, MAX_GOAL_CANDIDATES } from "../crawler-inventory";
import { ctaSetHash, judgeSiteGoals, JUDGE_VERSION } from "../goal-judge.server";
import type { ContentInventory } from "../types";

const DOMAIN = "www.compricer.se";

describe("classifyGoalKind — a goal is not always a signup", () => {
  it("reads an off-domain link as an affiliate/partner outbound conversion", () => {
    expect(classifyGoalKind("Till leverantören", "https://partner.example/deal", DOMAIN)).toBe(
      "outbound",
    );
    // Same-site absolute href is NOT outbound.
    expect(classifyGoalKind("Bilförsäkring", "https://www.compricer.se/bilforsakring", DOMAIN)).toBe(
      "start_flow",
    );
  });

  it("reads a same-site category/funnel entry with no verb as start_flow", () => {
    expect(classifyGoalKind("Bilförsäkring", "/bilforsakring", DOMAIN)).toBe("start_flow");
  });

  it("detects lead intent from a form wrapper, tel:, or callback wording", () => {
    expect(classifyGoalKind("Skicka", undefined, DOMAIN, /* inForm */ true)).toBe("lead");
    expect(classifyGoalKind("Ring oss", "tel:+46812345", DOMAIN)).toBe("lead");
    expect(classifyGoalKind("Vi ringer upp dig", "/callback", DOMAIN)).toBe("lead");
  });

  it("classifies the classic verbs (EN+SV) by text and path", () => {
    expect(classifyGoalKind("Skapa konto", undefined, DOMAIN)).toBe("signup");
    expect(classifyGoalKind("Köp nu", undefined, DOMAIN)).toBe("purchase");
    expect(classifyGoalKind("Add to basket", undefined, DOMAIN)).toBe("purchase");
    expect(classifyGoalKind("Boka tid", undefined, DOMAIN)).toBe("booking");
    expect(classifyGoalKind("Prova gratis", undefined, DOMAIN)).toBe("trial");
    expect(classifyGoalKind("Få en offert", undefined, DOMAIN)).toBe("quote");
    expect(classifyGoalKind("Prenumerera", undefined, DOMAIN)).toBe("subscribe");
    expect(classifyGoalKind("Kontakta oss", "mailto:a@b.se", DOMAIN)).toBe("contact");
    expect(classifyGoalKind("Hämta appen", "https://apps.apple.com/app/x", DOMAIN)).toBe("download");
    // href path beats generic text
    expect(classifyGoalKind("Fortsätt", "/checkout", DOMAIN)).toBe("purchase");
  });

  it("defaults a bare button with no signal to signup", () => {
    expect(classifyGoalKind("Kom igång nu med oss", undefined, DOMAIN)).toBe("trial"); // "kom igång"
    expect(classifyGoalKind("Klicka här", undefined, DOMAIN)).toBe("signup");
  });

  it("classifies donations as donate, not signup/start_flow (nonprofit goal)", () => {
    expect(classifyGoalKind("Donera nu", undefined, DOMAIN)).toBe("donate");
    expect(classifyGoalKind("Ge en gåva", undefined, DOMAIN)).toBe("donate");
    expect(classifyGoalKind("Give now", undefined, DOMAIN)).toBe("donate");
    // href path signal, even with a verb-less label
    expect(classifyGoalKind("Stöd oss", "/donera", DOMAIN)).toBe("donate");
    expect(classifyGoalKind("Support us", "/donate", DOMAIN)).toBe("donate");
  });

  it("covers the 107-site harvest vocabulary (corpus/vocab-harvest-2026-07-06.json)", () => {
    // Nonprofit money actions
    expect(classifyGoalKind("Bli månadsgivare", undefined, DOMAIN)).toBe("donate");
    expect(classifyGoalKind("Swisha en gåva", undefined, DOMAIN)).toBe("donate");
    expect(classifyGoalKind("Skänk pengar", undefined, DOMAIN)).toBe("donate");
    // Insurance/utility/telecom contract signing = that vertical's purchase
    expect(classifyGoalKind("Teckna elavtal", undefined, DOMAIN)).toBe("purchase");
    expect(classifyGoalKind("Lägg i varukorgen", undefined, DOMAIN)).toBe("purchase");
    expect(classifyGoalKind("Shoppa kollektionen", undefined, DOMAIN)).toBe("purchase");
    // Banks: open account / apply / price calculators
    expect(classifyGoalKind("Bli kund", undefined, DOMAIN)).toBe("signup");
    expect(classifyGoalKind("Öppna konto", undefined, DOMAIN)).toBe("signup");
    expect(classifyGoalKind("Ansök om bolån", undefined, DOMAIN)).toBe("lead");
    expect(classifyGoalKind("Räkna på bolån", undefined, DOMAIN)).toBe("quote");
    // Comparison portals: the funnel entry IS the goal
    expect(classifyGoalKind("Jämför och byt elavtal", undefined, DOMAIN)).toBe("start_flow");
    // News paywalls
    expect(classifyGoalKind("Bli prenumerant", undefined, DOMAIN)).toBe("subscribe");
    // "Ladda ned" spelling variant
    expect(classifyGoalKind("Ladda ned appen", undefined, DOMAIN)).toBe("download");
    // Harvest falsification: "Följ oss" is a social link, never a subscribe goal
    expect(classifyGoalKind("Följ oss", undefined, DOMAIN)).not.toBe("subscribe");
    // "Tecknade serier" (comics category) must not read as contract signing
    expect(classifyGoalKind("Tecknade serier", undefined, DOMAIN)).not.toBe("purchase");
  });
});

describe("rankGoalCandidates — deterministic no-LLM floor", () => {
  const inv = (
    ctas: { text: string; href?: string; role?: string }[],
  ): ContentInventory =>
    ({
      site: "t",
      slots: {
        cta: ctas.map((c, i) => ({
          id: `cta-${i}`,
          slot: "cta" as const,
          text: c.text,
          selector: `#cta-${i}`,
          meta: {
            aboveFold: i === 0 ? "true" : "false",
            ...(c.href ? { href: c.href } : {}),
            ...(c.role ? { role: c.role } : {}),
          },
        })),
      },
    }) as unknown as ContentInventory;

  it("ranks acquisition CTAs and tags each with a kind, capped and stable", () => {
    const out = rankGoalCandidates(
      inv([
        { text: "Skapa konto", href: "/signup" },
        { text: "Köp nu", href: "/checkout" },
        { text: "Läs mer", role: "nav" }, // excluded (nav role)
      ]),
      DOMAIN,
    );
    const texts = out.map((g) => g.text);
    expect(texts).toContain("Skapa konto");
    expect(texts).toContain("Köp nu");
    expect(texts).not.toContain("Läs mer");
    expect(out.find((g) => g.text === "Köp nu")?.kind).toBe("purchase");
    expect(out.every((g) => g.source === "rule")).toBe(true);
    expect(out.map((g) => g.rank)).toEqual(out.map((_, i) => i + 1)); // dense 1..N
  });

  it("never exceeds MAX_GOAL_CANDIDATES", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `Skapa konto ${i}` }));
    expect(rankGoalCandidates(inv(many), DOMAIN).length).toBeLessThanOrEqual(MAX_GOAL_CANDIDATES);
  });
});

describe("judgeSiteGoals — cache + deterministic fallback (no network)", () => {
  const emptyInv = { site: "t", slots: {} } as unknown as ContentInventory;

  it("returns the previous judgment unchanged when version + CTA-set hash match", async () => {
    const inv = {
      site: "t",
      slots: { cta: [{ id: "c0", slot: "cta", text: "Köp", selector: "#c0", meta: {} }] },
    } as unknown as ContentInventory;
    const prev = {
      businessType: "ecommerce",
      version: JUDGE_VERSION,
      ctaHash: ctaSetHash(inv),
      goals: [{ selector: "#c0", text: "Köp", kind: "purchase" as const, rank: 1, confidence: 0.9, source: "llm" as const }],
    };
    const out = await judgeSiteGoals(inv, DOMAIN, prev);
    expect(out).toBe(prev); // identity — no re-judge
  });

  it("falls back deterministically to the rule ranker on empty inventory", async () => {
    const out = await judgeSiteGoals(emptyInv, DOMAIN, null);
    expect(out.version).toBe(JUDGE_VERSION);
    expect(out.businessType).toBe("other");
    expect(out.goals).toEqual([]);
  });
});

describe("auth taxonomy drift guard — pageType and CTA role must agree (A3)", () => {
  // Two sides of one taxonomy: context.ts AUTH_PATH_RX (page classification)
  // and ROLE_RULES auth href (CTA-role classification). They anchor
  // differently (path fragment vs segment), so this guard pins the canonical
  // login paths both MUST classify as auth — if either side drifts, this
  // fails before the audit has to rediscover finding A3.
  const CANONICAL_AUTH_PATHS = [
    "/login",
    "/log-in",
    "/logga-in",
    "/sign-in",
    "/inloggning",
    "/mina-sidor",
  ];

  it("classifyPageType calls them auth", async () => {
    const { classifyPageType } = await import("../context");
    for (const p of CANONICAL_AUTH_PATHS) {
      expect(classifyPageType(`https://x.se${p}`), p).toBe("auth");
    }
  });

  it("classifyCtaRole calls hrefs to them auth", async () => {
    const { classifyCtaRole } = await import("../crawler-inventory");
    for (const p of CANONICAL_AUTH_PATHS) {
      expect(classifyCtaRole("Fortsätt", p), p).toBe("auth");
    }
  });
});
