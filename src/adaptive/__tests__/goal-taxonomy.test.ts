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
