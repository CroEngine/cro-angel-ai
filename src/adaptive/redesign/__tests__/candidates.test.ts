// Kandidatkatalogens kontrakt: lagliga drag ur modellen, deterministisk
// ordning, ordagranna texter, aldrig hjälten som flyttmål, dedup.
import { describe, it, expect } from "vitest";

import { generateCandidates, candidateToOp, floorWhy, tidySignalText } from "../candidates";
import type { RedesignContentModel } from "../context";

const model = (over: Partial<RedesignContentModel> = {}): RedesignContentModel => ({
  sections: [
    {
      id: "sec-1-hero",
      type: "hero",
      position: 1,
      heading: "Describe who you want to hire",
      aboveFold: true,
      visualWeight: 5,
    },
    {
      id: "sec-2-features",
      type: "features",
      position: 2,
      heading: "Everything you need",
      aboveFold: false,
      visualWeight: 3,
    },
    {
      id: "sec-3-testimonials",
      type: "testimonials",
      position: 3,
      heading: "Don't just take our word for it",
      aboveFold: false,
      visualWeight: 3,
      containsTrustSignals: true,
    },
    {
      id: "sec-4-logos",
      type: "logos",
      position: 4,
      heading: "Trusted by teams",
      aboveFold: false,
      visualWeight: 2,
    },
  ],
  trustSignals: [
    { type: "trusted_by", text: "Trusted by the world's best", aboveFold: false, section: "body" },
    { type: "compliance", text: "GDPR compliant", aboveFold: false, section: "body" },
    // Dubblett-text — ska dedupas bort.
    { type: "trusted_by", text: "Trusted by the world's best", aboveFold: false, section: "body" },
    // För kort — ska filtreras.
    { type: "guarantee", text: "Garanti", aboveFold: false, section: "body" },
  ],
  ctas: [],
  hero: { headline: "Describe who you want to hire" },
  ...over,
});

describe("generateCandidates", () => {
  it("genererar flytt för bevissektioner men aldrig hjälten eller features utan proof", () => {
    const c = generateCandidates(model());
    const moves = c.filter((x) => x.kind === "move_up").map((x) => x.targetId);
    expect(moves).toContain("sec-3-testimonials");
    expect(moves).toContain("sec-4-logos");
    expect(moves).not.toContain("sec-1-hero");
    expect(moves).not.toContain("sec-2-features");
  });

  it("testimonials med proof rankas över logos; trusted_by över compliance", () => {
    const c = generateCandidates(model());
    const idx = (id: string) => c.findIndex((x) => x.id === id);
    expect(idx("mv-sec-3-testimonials")).toBeLessThan(idx("mv-sec-4-logos"));
    const tb = c.find((x) => x.id.startsWith("ins-trusted_by"))!;
    const comp = c.find((x) => x.id.startsWith("ins-compliance"))!;
    expect(tb.score).toBeGreaterThan(comp.score);
  });

  it("dedupar identiska texter och filtrerar för korta signaler", () => {
    const c = generateCandidates(model());
    const trustedBy = c.filter((x) => x.detail === "Trusted by the world's best");
    expect(trustedBy).toHaveLength(1);
    expect(c.some((x) => x.detail === "Garanti")).toBe(false);
  });

  it("ordningen är deterministisk (score, sedan id) — golvets val är stabilt", () => {
    const a = generateCandidates(model()).map((x) => x.id);
    const b = generateCandidates(model()).map((x) => x.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("tom sida ⇒ tom katalog (ärligt thin-page-nej, aldrig ett hittat drag)", () => {
    const c = generateCandidates(model({ sections: [], trustSignals: [] }));
    expect(c).toEqual([]);
  });

  it("candidateToOp översätter till verify-språket med väljarens why", () => {
    const c = generateCandidates(model());
    const move = c.find((x) => x.kind === "move_up")!;
    const ins = c.find((x) => x.kind === "insert_snippet")!;
    expect(candidateToOp(move, "därför")).toEqual({
      op: "move_up",
      targetId: move.targetId,
      detail: "Lyft bevissektionen högre på sidan",
      why: "därför",
    });
    const insOp = candidateToOp(ins, floorWhy(ins));
    expect(insOp.op).toBe("insert_snippet");
    expect(insOp.targetId).toBe("hero");
    expect(insOp.detail).toBe(ins.detail);
    expect(insOp.why).toContain("Regelvald toppkandidat");
  });

  // Framer-klassen (ägarfynd fikajobs 2026-07-28): SSR renderar samma element
  // per brytpunkt — den platta signaltexten dubblerar sig själv i skarven.
  it("tidySignalText klipper SSR-dubbletten och behåller ordagrant prefix", () => {
    expect(
      tidySignalText(
        "Trusted by leading startups and companies in Sweden Trusted by leading startups",
      ),
    ).toBe("Trusted by leading startups and companies in Sweden");
    // Utan upprepning: orörd.
    expect(tidySignalText("Trusted by 4,000+ teams worldwide")).toBe(
      "Trusted by 4,000+ teams worldwide",
    );
    // UI-brus-klippet fungerar fortfarande ihop med upprepnings-klippet.
    expect(tidySignalText("Trusted by the world's best 0:30 Play video")).toBe(
      "Trusted by the world's best",
    );
  });

  it("menyns insert-detail bär den städade texten (inte SSR-skarven)", () => {
    const cands = generateCandidates(
      model({
        trustSignals: [
          {
            type: "trusted_by",
            text: "Trusted by leading startups and companies in Sweden Trusted by leading startups and",
            aboveFold: false,
            section: "body",
          },
        ],
      }),
    );
    const ins = cands.find((c) => c.kind === "insert_snippet")!;
    expect(ins.detail).toBe("Trusted by leading startups and companies in Sweden");
  });
});
