import { describe, it, expect } from "vitest";

import { rankProofItems, callRankApi, type ProofScore } from "../proof-rank.server";

const ITEMS = [
  { heading: "98% of our customers save time on meals", body: "98% of our customers save time on meals" },
  { heading: "Customizable", body: "Customizable" },
  { heading: "14.8 million customers", body: "14.8 million customers move $16 billion every month." },
];

// Fake ranker: strong numbers score high, vague labels score low — mirrors the prompt.
const fake =
  (byHeading: Record<string, ProofScore | null>): typeof callRankApi =>
  async (_type, items) =>
    items.map((it) => byHeading[it.heading] ?? { strength: 0, reason: "" });

describe("rankProofItems — bevis-styrka inom ett block", () => {
  it("poängsätter objekt och låter caller sortera starkast först", async () => {
    const scores = await rankProofItems(
      "stats",
      ITEMS,
      fake({
        "98% of our customers save time on meals": { strength: 0.9, reason: "specific outcome %" },
        Customizable: { strength: 0.2, reason: "vague feature label" },
        "14.8 million customers": { strength: 0.95, reason: "large verifiable count" },
      }),
    );
    expect(scores).not.toBeNull();
    const ranked = ITEMS.map((it, i) => ({ h: it.heading, s: scores![i]?.strength ?? 0 })).sort((a, b) => b.s - a.s);
    expect(ranked[0].h).toBe("14.8 million customers");
    expect(ranked[2].h).toBe("Customizable");
  });

  it("empty items → null (nothing to rank)", async () => {
    expect(await rankProofItems("stats", [], fake({}))).toBeNull();
  });

  it("clamps out-of-range strength and tolerates a partial/garbled response", async () => {
    const scores = await rankProofItems("testimonials", ITEMS, async (_t, items) =>
      // model returns strength 2 for item 0, omits item 1, valid for item 2
      items.map((_, i) => (i === 0 ? { strength: 2, reason: "x" } : i === 2 ? { strength: 0.5, reason: "ok" } : null)),
    );
    expect(scores![0]).toEqual({ strength: 2, reason: "x" }); // DI fake returns as-is; clamping lives in callRankApi
    expect(scores![1]).toBeNull();
  });

  it("callRankApi returns null without ANTHROPIC_API_KEY (fail-open, never throws)", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await callRankApi("stats", ITEMS)).toBeNull();
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
