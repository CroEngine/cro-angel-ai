// Steg 10-grinden: HELA beteende-röret som EN deterministisk kedja —
//   snippet-payloads (steg 9) → aggregering (steg 10) → rollup (steg 8)
//   → sätet i katalogen (steg 7) → golvets val + väljar-menyns mätrad.
// Ren aritmetik utan db/chromium/LLM — exakt "CI-grindar på den
// deterministiska vägen (inte LLM)" som planens steg 10 kräver.
import { describe, expect, it } from "vitest";

import { generateCandidates } from "../candidates";
import { rollupEngagement } from "../engagement-rollup";
import { aggregateSectionObservations } from "../section-events";
import { applyProbe, buildSelectionPrompt, floorSelection } from "../select";

import type { RedesignContentModel } from "../context";

// En sida där typ-priorn säger testimonials — men besökarna säger pricing.
const CONTENT: RedesignContentModel = {
  sections: [
    { id: "sec-1-hero", type: "hero", position: 1, heading: "Build faster", aboveFold: true, visualWeight: 85 },
    {
      id: "sec-2-testimonials",
      type: "testimonials",
      position: 2,
      heading: "Loved by teams everywhere",
      aboveFold: false,
      visualWeight: 56,
    },
    {
      id: "sec-3-pricing",
      type: "pricing",
      position: 3,
      heading: "Simple honest pricing",
      aboveFold: false,
      visualWeight: 52,
    },
  ],
  trustSignals: [],
  ctas: [{ text: "Start free", aboveFold: true }],
  hero: { headline: "Build faster" },
};

/** 1200 sidladdningar: pris-sektionen ses av 90 %, testimonials av 15 %. */
function loads(): { sections: { h: string; n: number; d: number }[]; path: string }[] {
  const out: { sections: { h: string; n: number; d: number }[]; path: string }[] = [];
  for (let i = 0; i < 1200; i++) {
    out.push({
      path: "/",
      sections: [
        { h: "Loved by teams everywhere", n: 1, d: i % 100 < 15 ? 2000 : 0 },
        { h: "Simple honest pricing", n: 1, d: i % 10 < 9 ? 3000 : 100 },
      ],
    });
  }
  return out;
}

describe("beteende-röret ände-till-ände (steg 9 → 10 → 8 → 7)", () => {
  it("besökarnas signal vänder typ-priorns rangordning och syns i menyraden", () => {
    const observations = aggregateSectionObservations(loads());
    const rollup = rollupEngagement(
      CONTENT.sections.map((s) => ({ id: s.id, type: s.type, heading: s.heading })),
      observations,
    );
    expect(rollup).not.toBeNull();
    expect(rollup!.totalVisits).toBe(2400); // 1200 laddningar × 2 sektioner
    expect(rollup!.sectionWeight["sec-3-pricing"]).toBeCloseTo(0.9, 10);
    expect(rollup!.sectionWeight["sec-2-testimonials"]).toBeCloseTo(0.15, 10);

    // Utan beteende: typ-priorn väljer testimonials. Med: pricing vinner.
    const plain = generateCandidates(CONTENT);
    const behaved = generateCandidates(CONTENT, { sectionWeight: rollup!.sectionWeight });
    const top = (cs: typeof plain) =>
      floorSelection(applyProbe(cs, cs.map((c) => ({ id: c.id, applicable: true }))))!.ordered.find(
        (c) => c.kind === "move_up",
      )!.targetId;
    expect(top(plain)).toBe("sec-2-testimonials");
    expect(top(behaved)).toBe("sec-3-pricing");

    // Menyraden bär den UPPMÄTTA andelen — synlig för väljaren, aldrig bara
    // inbakad i poängen. Bara sektioner med data får en rad.
    const menu = applyProbe(behaved, behaved.map((c) => ({ id: c.id, applicable: true })));
    const prompt = buildSelectionPrompt({
      heroHeadline: "Build faster",
      segmentLabel: "google · mobile",
      observations: [],
      menu,
      engagementBySection: rollup!.sectionWeight,
    });
    expect(prompt).toContain("seen ≥1s by 90% of visitors");
    expect(prompt).toContain("seen ≥1s by 15% of visitors");
  });

  it("null-vägen: för lite data ⇒ rollup null ⇒ katalogen byte-identisk (sätet matas aldrig)", () => {
    const thin = aggregateSectionObservations(loads().slice(0, 100)); // 200 besök < golvet
    const rollup = rollupEngagement(
      CONTENT.sections.map((s) => ({ id: s.id, type: s.type, heading: s.heading })),
      thin,
    );
    expect(rollup).toBeNull();
    // Anropar-mönstret (candidate-plan): null ⇒ behavior utelämnas helt.
    expect(generateCandidates(CONTENT, undefined)).toEqual(generateCandidates(CONTENT));
  });

  it("menyraden utan beteendedata är exakt dagens (ingen påhittad siffra)", () => {
    const plain = generateCandidates(CONTENT);
    const menu = applyProbe(plain, plain.map((c) => ({ id: c.id, applicable: true })));
    const prompt = buildSelectionPrompt({
      heroHeadline: "Build faster",
      segmentLabel: "google · mobile",
      observations: [],
      menu,
    });
    expect(prompt).not.toContain("measured:");
    expect(prompt).not.toContain("seen ≥1s");
  });
});
