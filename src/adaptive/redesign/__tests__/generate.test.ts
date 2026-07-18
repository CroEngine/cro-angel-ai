import { describe, it, expect } from "vitest";

import { buildRedesignContext, type RedesignContext } from "../context";
import { parseOpsResponse, validateOps, generateRedesign, MAX_OPS } from "../generate";

const ctx: RedesignContext = buildRedesignContext({
  site: "demo",
  goal: { text: "Start now", kind: "subscribe", selector: "#start" },
  page: {
    url: "https://demo.example/",
    frozenHtmlPath: "p/page.mhtml",
    screenshotPath: "p/screenshot.jpg",
    viewport: { width: 390, height: 844 },
  },
  content: {
    sections: [
      {
        id: "sec-hero",
        type: "hero",
        position: 1,
        heading: "H",
        aboveFold: true,
        visualWeight: 80,
      },
      {
        id: "sec-testi",
        type: "testimonials",
        position: 4,
        heading: "T",
        aboveFold: false,
        visualWeight: 40,
      },
    ],
    trustSignals: [
      { type: "social_proof_count", text: "10k", aboveFold: false, section: "testimonials" },
    ],
    ctas: [{ text: "Start now", intent: "conversion", aboveFold: true }],
    hero: { headline: "H" },
  },
  segment: {
    key: "instagram·mobile·SE",
    label: "instagram · mobile · SE",
    visitsLifetime: 1680,
    conversionRateLifetime: 0.062,
    conversionRateRecent: 0.089,
    trend: "rising",
    adequate: true,
    rageRefs: [],
    formAbandonRate: null,
    observations: [],
  },
});

describe("parseOpsResponse", () => {
  it("reads a bare array, an {ops,note} object, and fenced json", () => {
    expect(parseOpsResponse('[{"op":"move_up","targetId":"sec-testi"}]').ops).toHaveLength(1);
    const withNote = parseOpsResponse('{"ops":[],"note":"too thin"}');
    expect(withNote.ops).toEqual([]);
    expect(withNote.note).toBe("too thin");
    expect(
      parseOpsResponse('```json\n[{"op":"reveal","targetId":"sec-testi"}]\n```').ops,
    ).toHaveLength(1);
  });

  it("never throws on malformed text", () => {
    expect(parseOpsResponse("not json at all").ops).toEqual([]);
    expect(parseOpsResponse("").ops).toEqual([]);
  });
});

describe("validateOps — the LLM is never trusted", () => {
  it("keeps a valid op targeting an existing section", () => {
    const plan = validateOps(
      [{ op: "move_up", targetId: "sec-testi", detail: "social proof up", why: "warm traffic" }],
      ctx,
    );
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({ op: "move_up", targetId: "sec-testi" });
    expect(plan.rejected).toHaveLength(0);
  });

  it("allows the synthetic 'hero' target when the page has a hero", () => {
    expect(validateOps([{ op: "condense", targetId: "hero" }], ctx).ops).toHaveLength(1);
  });

  it("rejects an op whose verb is not in the allowed vocabulary", () => {
    const plan = validateOps([{ op: "add_banner", targetId: "sec-hero" }], ctx);
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/not in allowed vocabulary/);
  });

  it("rejects an INVENTED target that isn't a real section (the 'never invent' guard)", () => {
    const plan = validateOps([{ op: "move_up", targetId: "sec-fake-testimonial" }], ctx);
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/not an existing section|invented/);
  });

  it("caps at MAX_OPS (keep changes minimal)", () => {
    const many = Array.from({ length: MAX_OPS + 3 }, () => ({
      op: "reveal",
      targetId: "sec-testi",
    }));
    const plan = validateOps(many, ctx);
    expect(plan.ops).toHaveLength(MAX_OPS);
    expect(plan.rejected.some((r) => /MAX_OPS/.test(r.reason))).toBe(true);
  });
});

describe("validateOps — semantic guard on set_text/condense (no new claims)", () => {
  // The ctx corpus publishes the number "10k" and the CTA "Start now" — nothing else.
  it("keeps a set_text that only re-tightens grounded copy", () => {
    const plan = validateOps(
      [
        {
          op: "set_text",
          targetId: "sec-hero",
          detail: "Start now — trusted by 10k",
          why: "focus",
        },
      ],
      ctx,
    );
    expect(plan.ops).toHaveLength(1);
    expect(plan.rejected).toHaveLength(0);
  });

  it("rejects a set_text that fabricates a NEW number", () => {
    const plan = validateOps(
      [{ op: "set_text", targetId: "sec-hero", detail: "Trusted by 50k users", why: "inflate" }],
      ctx,
    );
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/introduces claim.*50k.*number/i);
  });

  it("rejects a condense that fabricates a superlative", () => {
    const plan = validateOps(
      [{ op: "condense", targetId: "hero", detail: "The best analytics", why: "hype" }],
      ctx,
    );
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/introduces claim.*best.*superlative/i);
  });

  it("does NOT apply the claims guard to move_up / reveal (they don't rewrite copy)", () => {
    const plan = validateOps(
      [{ op: "move_up", targetId: "sec-testi", detail: "put the 999 award section up", why: "x" }],
      ctx,
    );
    expect(plan.ops).toHaveLength(1); // detail text on a move op is not a claim rewrite
  });
});

describe("generateRedesign — brief → ops → validated plan", () => {
  it("runs the injected model, parses + validates its output", async () => {
    // Simulated Claude response for the stripe/instagram case.
    const stub = async () =>
      JSON.stringify([
        {
          op: "move_up",
          targetId: "sec-testi",
          detail: "social proof above the fold",
          why: "IG traffic arrives warm on it",
        },
        { op: "add_popup", targetId: "sec-hero", detail: "nope", why: "should be rejected" },
        { op: "move_up", targetId: "sec-ghost", detail: "invented", why: "should be rejected" },
      ]);
    const plan = await generateRedesign(ctx, stub);
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0].targetId).toBe("sec-testi");
    expect(plan.rejected).toHaveLength(2); // bad verb + invented target
  });

  it("degrades to an empty plan when the model is unavailable (null)", async () => {
    const plan = await generateRedesign(ctx, async () => null);
    expect(plan.ops).toEqual([]);
    expect(plan.note).toMatch(/unavailable/);
  });
});

describe("validateOps — insert_snippet (korssid-lyftet: ordagrant · hjälten · en per plan)", () => {
  const srcCtx = buildRedesignContext({
    site: "demo",
    goal: { text: "Start now", kind: "subscribe", selector: "#start" },
    page: {
      url: "https://demo.example/",
      frozenHtmlPath: "p/page.mhtml",
      screenshotPath: "p/screenshot.jpg",
      viewport: { width: 390, height: 844 },
    },
    content: ctx.content,
    segment: ctx.segment,
    sourcePages: [
      {
        path: "/priser",
        snippets: [{ text: "Från 99 kr/mån — alla funktioner ingår.", tag: "p" }],
      },
    ],
  });
  const QUOTE = "Från 99 kr/mån — alla funktioner ingår.";

  it("adds insert_snippet to the vocabulary ONLY when source pages exist", () => {
    expect(srcCtx.guardrails.ops).toContain("insert_snippet");
    expect(ctx.guardrails.ops).not.toContain("insert_snippet");
  });

  it("keeps a VERBATIM quote targeting hero from an offered source page", () => {
    const plan = validateOps(
      [{ op: "insert_snippet", targetId: "hero", sourcePath: "/priser", detail: QUOTE, why: "w" }],
      srcCtx,
    );
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      op: "insert_snippet",
      sourcePath: "/priser",
      detail: QUOTE,
    });
  });

  it("tolerates whitespace differences but rejects any PARAPHRASE", () => {
    const spaced = validateOps(
      [
        {
          op: "insert_snippet",
          targetId: "hero",
          sourcePath: "/priser",
          detail: "  Från 99 kr/mån   — alla funktioner ingår. ",
          why: "w",
        },
      ],
      srcCtx,
    );
    expect(spaced.ops).toHaveLength(1);
    const para = validateOps(
      [
        {
          op: "insert_snippet",
          targetId: "hero",
          sourcePath: "/priser",
          detail: "Endast 99 kr per månad!",
          why: "w",
        },
      ],
      srcCtx,
    );
    expect(para.ops).toHaveLength(0);
    expect(para.rejected[0].reason).toMatch(/VERBATIM/);
  });

  it("rejects a sourcePath that was never offered", () => {
    const plan = validateOps(
      [{ op: "insert_snippet", targetId: "hero", sourcePath: "/hemlig", detail: QUOTE, why: "w" }],
      srcCtx,
    );
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/not an offered source page/);
  });

  it("rejects a second insert (one per plan) and a non-hero target", () => {
    const two = validateOps(
      [
        { op: "insert_snippet", targetId: "hero", sourcePath: "/priser", detail: QUOTE, why: "w" },
        { op: "insert_snippet", targetId: "hero", sourcePath: "/priser", detail: QUOTE, why: "w" },
      ],
      srcCtx,
    );
    expect(two.ops).toHaveLength(1);
    expect(two.rejected[0].reason).toMatch(/only ONE/);
    const wrongTarget = validateOps(
      [
        {
          op: "insert_snippet",
          targetId: "sec-testi",
          sourcePath: "/priser",
          detail: QUOTE,
          why: "w",
        },
      ],
      srcCtx,
    );
    expect(wrongTarget.ops).toHaveLength(0);
  });

  it("rejects the verb entirely in a single-page context (vocabulary gate)", () => {
    const plan = validateOps(
      [{ op: "insert_snippet", targetId: "hero", sourcePath: "/priser", detail: QUOTE, why: "w" }],
      ctx,
    );
    expect(plan.ops).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/not in allowed vocabulary/);
  });
});
