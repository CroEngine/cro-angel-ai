import { describe, it, expect } from "vitest";

import { classifySectionsLlm, refineSectionTypesLlm, type SectionLabel } from "../section-llm.server";

import type { RedesignContentModel } from "../context";

// "Our community" is the HelloFresh class: a real testimonial whose body is an
// IMAGE (copy in alt), under a slogan heading the deterministic floor can't type.
// "Everything at once" is a features grid the floor typed approximately.
const HTML = `<main>
  <h1>Welcome</h1><p>Intro.</p>
  <h2>Our community</h2><div><img alt="Best tool I've used — Jane, CTO at Acme"></div>
  <h2>Everything at once</h2><div><h3>Fast</h3><h3>Safe</h3><h3>Open</h3></div>
  <h2>Simple pricing</h2><p>$9/mo</p>
</main>`;

const model = (): RedesignContentModel => ({
  sections: [
    { id: "sec-1-hero", type: "hero", position: 1, heading: "Welcome", aboveFold: true, visualWeight: 85 },
    { id: "sec-2-section", type: "section", position: 2, heading: "Our community", aboveFold: false, visualWeight: 56 },
    { id: "sec-3-features", type: "features", position: 3, heading: "Everything at once", aboveFold: false, visualWeight: 52 },
    {
      id: "sec-4-pricing",
      type: "pricing",
      position: 4,
      heading: "Simple pricing",
      aboveFold: false,
      visualWeight: 48,
      containsTrustSignals: false,
    },
  ],
  trustSignals: [],
  ctas: [],
  hero: { headline: "Welcome" },
});

const fake =
  (byHeading: Record<string, SectionLabel | null>, capture?: { items: { heading: string; body: string }[] }): typeof classifySectionsLlm =>
  async (items) => {
    if (capture) capture.items = items;
    return items.map((it) => byHeading[it.heading] ?? null);
  };

describe("refineSectionTypesLlm — LLM-taket ovanpå det deterministiska typnings-golvet", () => {
  it("befordrar en generisk sektion till en bevistyp, stämplar [proof] + håller id konsekvent", async () => {
    const content = model();
    const cap = { items: [] as { heading: string; body: string }[] };
    const promoted = await refineSectionTypesLlm(
      content,
      HTML,
      fake(
        {
          "Our community": { type: "testimonials", confidence: 0.95 },
          "Everything at once": { type: "section", confidence: 0.9 }, // LLM håller med: generisk → lämna
          "Simple pricing": { type: "logos", confidence: 0.99 }, // skickas ALDRIG (golvets bevistyp)
        },
        cap,
      ),
    );
    expect(promoted).toBe(1);
    const comm = content.sections.find((s) => s.heading === "Our community")!;
    expect(comm.type).toBe("testimonials");
    expect(comm.id).toBe("sec-2-testimonials"); // id kodar typen — måste följa med
    expect(comm.containsTrustSignals).toBe(true);

    // BARA generiska sektioner skickas — hjälten och golvets pricing aldrig.
    const sent = cap.items.map((i) => i.heading);
    expect(sent).toContain("Our community");
    expect(sent).toContain("Everything at once");
    expect(sent).not.toContain("Welcome");
    expect(sent).not.toContain("Simple pricing");
    // Golvets pricing står orörd (taket kan aldrig sänka den).
    expect(content.sections.find((s) => s.heading === "Simple pricing")!.type).toBe("pricing");
    // Bild-buren copy nådde prompten via <img alt>.
    expect(cap.items.find((i) => i.heading === "Our community")!.body).toContain("Jane");
  });

  it("rättar en approximativ 'features'-grid till testimonials när kroppen bär citat", async () => {
    const content = model();
    const promoted = await refineSectionTypesLlm(
      content,
      HTML,
      fake({ "Everything at once": { type: "testimonials", confidence: 0.9 } }),
    );
    expect(promoted).toBe(1);
    const sec = content.sections.find((s) => s.heading === "Everything at once")!;
    expect(sec.type).toBe("testimonials");
    expect(sec.id).toBe("sec-3-testimonials");
    expect(sec.containsTrustSignals).toBe(true);
  });

  it("respekterar konfidensgolvet — osäkra omdömen befordrar aldrig", async () => {
    const content = model();
    const promoted = await refineSectionTypesLlm(
      content,
      HTML,
      fake({ "Our community": { type: "testimonials", confidence: 0.6 } }),
    );
    expect(promoted).toBe(0);
    expect(content.sections.find((s) => s.heading === "Our community")!.type).toBe("section");
  });

  it("ignorerar icke-befordringsbara + hallucinerade typer ('section'/'other'/skräp)", async () => {
    const content = model();
    const promoted = await refineSectionTypesLlm(
      content,
      HTML,
      fake({
        "Our community": { type: "banana", confidence: 0.99 },
        "Everything at once": { type: "other", confidence: 0.99 },
      }),
    );
    expect(promoted).toBe(0);
    expect(content.sections.map((s) => s.type)).toEqual(["hero", "section", "features", "pricing"]);
  });

  it("utan nyckel/API (klassaren → null) står golvet ensamt — inga gissningar", async () => {
    const content = model();
    const promoted = await refineSectionTypesLlm(content, HTML, async () => null);
    expect(promoted).toBe(0);
    expect(content.sections.map((s) => s.type)).toEqual(["hero", "section", "features", "pricing"]);
  });
});

describe("classifySectionsLlm — nätverkskontraktet", () => {
  it("returnerar null utan ANTHROPIC_API_KEY (fail-open, aldrig kast)", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await classifySectionsLlm([{ heading: "x", body: "y" }])).toBeNull();
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
