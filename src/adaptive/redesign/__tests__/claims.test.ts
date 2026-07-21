import { describe, it, expect } from "vitest";

import { extractClaims, introducedClaims, retextIsGrounded } from "../claims";

describe("extractClaims", () => {
  it("pulls numbers in varied formats", () => {
    const kinds = extractClaims("19,000 customers · 99.99% uptime · 260B events · $49/mo · 10x faster");
    const nums = kinds.filter((c) => c.kind === "number").map((c) => c.norm);
    expect(nums).toContain("19000");
    expect(nums).toContain("99.99%");
    expect(nums).toContain("260b");
    expect(nums.some((n) => n.startsWith("$49") || n.startsWith("49"))).toBe(true);
    expect(nums).toContain("10x");
  });

  it("pulls superlatives and promises by lexicon", () => {
    const c = extractClaims("The best analytics with a money-back guarantee and no credit card");
    expect(c.some((x) => x.kind === "superlative" && x.norm === "best")).toBe(true);
    expect(c.some((x) => x.kind === "promise" && x.norm === "money-back")).toBe(true);
    expect(c.some((x) => x.kind === "promise" && x.norm === "no credit card")).toBe(true);
  });

  it("does not treat ordinary words as claims", () => {
    expect(extractClaims("Simple, privacy-friendly analytics for your website")).toEqual([]);
  });
});

describe("introducedClaims — grounding a rewrite against the page", () => {
  const corpus = "Trusted by 19,000 paying customers. Simple, privacy-friendly analytics. GDPR-ready.";

  it("passes a faithful tightening that keeps the same numbers", () => {
    expect(introducedClaims("Privacy-friendly analytics, trusted by 19,000 customers", corpus)).toEqual(
      [],
    );
    expect(retextIsGrounded("Loved by 19,000 customers", corpus)).toBe(true);
  });

  it("flags a changed number as a fabricated claim", () => {
    const got = introducedClaims("Trusted by 50,000 paying customers", corpus);
    expect(got.map((c) => c.norm)).toContain("50000");
    expect(got.every((c) => c.kind === "number")).toBe(true);
  });

  it("flags an invented superlative", () => {
    const got = introducedClaims("The #1 privacy-friendly analytics", corpus);
    expect(got.some((c) => c.kind === "superlative")).toBe(true);
  });

  it("flags an invented promise", () => {
    const got = introducedClaims("Privacy-friendly analytics with a money-back guarantee", corpus);
    expect(got.some((c) => c.kind === "promise" && c.norm === "money-back")).toBe(true);
  });

  it("grounds a claim that IS already on the page (superlative reused)", () => {
    const withSup = "We are the best privacy tool. 19,000 customers.";
    expect(retextIsGrounded("Simply the best analytics", withSup)).toBe(true);
  });

  it("does not double-report the same introduced claim", () => {
    const got = introducedClaims("50,000 customers and 50,000 fans", corpus);
    expect(got.filter((c) => c.norm === "50000")).toHaveLength(1);
  });
});
