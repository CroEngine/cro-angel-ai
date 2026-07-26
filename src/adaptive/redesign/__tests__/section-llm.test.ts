import { describe, it, expect } from "vitest";

import {
  callVerifyLogosApi,
  classifySectionsLlm,
  refineSectionTypesLlm,
  verifyLogosLlm,
  type SectionLabel,
} from "../section-llm.server";

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

  it("token-gate: rejects price-less 'pricing' and digit-less 'stats' (200-site scale fix)", async () => {
    // The exact FP shapes the scale test surfaced: coinbase/salesforce "pricing"
    // with no price; plaid/rust-lang "stats" with no number. The LLM proposes,
    // the deterministic token check disposes.
    const html = `<main>
      <h1>Welcome</h1><p>Intro.</p>
      <h2>Zero trading fees, more rewards</h2><div>Get more out of crypto with one membership and priority support.</div>
      <h2>Choose a membership</h2><div>Starts at $199/yr with a 14 day battery.</div>
      <h2>A network that makes products better</h2><div>Your products get smarter with every connection.</div>
      <h2>By the numbers</h2><div>Over 500,000 customers and 80 billion events.</div>
    </main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "Welcome", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Zero trading fees, more rewards", aboveFold: false, visualWeight: 56 },
        { id: "sec-3-section", type: "section", position: 3, heading: "Choose a membership", aboveFold: false, visualWeight: 52 },
        { id: "sec-4-section", type: "section", position: 4, heading: "A network that makes products better", aboveFold: false, visualWeight: 48 },
        { id: "sec-5-section", type: "section", position: 5, heading: "By the numbers", aboveFold: false, visualWeight: 44 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "Welcome" },
    };
    const promoted = await refineSectionTypesLlm(
      content,
      html,
      fake({
        "Zero trading fees, more rewards": { type: "pricing", confidence: 0.9 }, // no price token → REJECT
        "Choose a membership": { type: "pricing", confidence: 0.9 }, // "$199/yr" → keep
        "A network that makes products better": { type: "stats", confidence: 0.9 }, // no digit → REJECT
        "By the numbers": { type: "stats", confidence: 0.9 }, // "500,000" → keep
      }),
    );
    const t = (h: string) => content.sections.find((s) => s.heading === h)!.type;
    expect(t("Zero trading fees, more rewards")).toBe("section"); // gated out (no price)
    expect(t("Choose a membership")).toBe("pricing"); // has $199/yr
    expect(t("A network that makes products better")).toBe("section"); // gated out (no number)
    expect(t("By the numbers")).toBe("stats"); // has 500,000
    expect(promoted).toBe(2);
  });

  it("price gate: 'From 100+ Channels' is NOT pricing (currency required after 'from')", async () => {
    // Gate hole found in scale-test #2 (hulu): "From 100+" matched an optional-currency
    // 'from' pattern. Now 'from' requires a currency symbol.
    const html = `<main><h1>H</h1><p>i</p><h2>Watch Live TV From 100+ Channels</h2><div>Get top national and local channels plus live sports and news.</div></main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "H", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Watch Live TV From 100+ Channels", aboveFold: false, visualWeight: 56 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "H" },
    };
    const promoted = await refineSectionTypesLlm(content, html, fake({ "Watch Live TV From 100+ Channels": { type: "pricing", confidence: 0.9 } }));
    expect(content.sections[1].type).toBe("section"); // no currency → gated
    expect(promoted).toBe(0);
  });

  it("recognition: a Gartner/G2 badge section is accepted; a badge-less slogan is gated", async () => {
    const html = `<main><h1>H</h1><p>i</p>
      <h2>Recognized as a leader</h2><div>A Leader in the Gartner Magic Quadrant three years running. G2 Best Software.</div>
      <h2>We are simply the best</h2><div>Self-praise with no third-party source at all.</div></main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "H", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Recognized as a leader", aboveFold: false, visualWeight: 56 },
        { id: "sec-3-section", type: "section", position: 3, heading: "We are simply the best", aboveFold: false, visualWeight: 52 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "H" },
    };
    const promoted = await refineSectionTypesLlm(
      content,
      html,
      fake({
        "Recognized as a leader": { type: "recognition", confidence: 0.9 }, // has Gartner/G2 → keep
        "We are simply the best": { type: "recognition", confidence: 0.9 }, // no badge token → gated
      }),
    );
    expect(content.sections.find((s) => s.heading === "Recognized as a leader")!.type).toBe("recognition");
    expect(content.sections.find((s) => s.heading === "Recognized as a leader")!.containsTrustSignals).toBe(true);
    expect(content.sections.find((s) => s.heading === "We are simply the best")!.type).toBe("section");
    expect(promoted).toBe(1);
  });

  it("proof-number stats gate: incidental digits don't count; community-size-of-people isn't logos (re-verify #2)", async () => {
    const html = `<main><h1>H</h1><p>i</p>
      <h2>Region: Earth</h2><div>One smart network close to users in 2026. Reduces latency 24/7.</div>
      <h2>The backbone of global commerce</h2><div>135+ currencies and $1.9T processed, 99.999% uptime.</div>
      <h2>Join a community of millions</h2><div>Two million developers visit the docs every month.</div>
      <h2>Our customers</h2><div>American Airlines, Mercedes-Benz, Spotify, Ford, Vodafone.</div></main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "H", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Region: Earth", aboveFold: false, visualWeight: 56 },
        { id: "sec-3-section", type: "section", position: 3, heading: "The backbone of global commerce", aboveFold: false, visualWeight: 52 },
        { id: "sec-4-section", type: "section", position: 4, heading: "Join a community of millions", aboveFold: false, visualWeight: 48 },
        { id: "sec-5-section", type: "section", position: 5, heading: "Our customers", aboveFold: false, visualWeight: 44 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "H" },
    };
    const promoted = await refineSectionTypesLlm(
      content,
      html,
      fake({
        "Region: Earth": { type: "stats", confidence: 0.9 }, // only "2026"/"24/7" → NOT proof numbers → gated
        "The backbone of global commerce": { type: "stats", confidence: 0.9 }, // 135+/$1.9T/99.999% → keep
        "Join a community of millions": { type: "logos", confidence: 0.9 }, // "two million developers" → not logos
        "Our customers": { type: "logos", confidence: 0.9 }, // real company wall → keep
      }),
    );
    const t = (h: string) => content.sections.find((s) => s.heading === h)!.type;
    expect(t("Region: Earth")).toBe("section"); // gated: no proof-shaped number
    expect(t("The backbone of global commerce")).toBe("stats"); // 135+/$1.9T/%
    expect(t("Join a community of millions")).toBe("section"); // community-size-of-people, not logos
    expect(t("Our customers")).toBe("logos"); // real brand wall survives
    expect(promoted).toBe(2);
  });

  it("commerce-grid gate: product/listing grids aren't logos/testimonials, but sentiment-stats + real proof survive (typing precision 2026-07-26)", async () => {
    // Two FP classes the scale test surfaced: a listing grid (per-unit prices) mislabeled
    // testimonials, a product grid (cart actions) mislabeled logos. The controls prove NO
    // over-tightening — a %-only sentiment stat, a real brand wall, and a real quote all
    // survive, and pricing is untouched (a commerce grid IS correctly pricing). Guards
    // against repeating the earlier over-tighten that dropped real HelloFresh-class proof.
    const html = `<main>
      <h1>Welcome</h1><p>Intro.</p>
      <h2>Places to stay</h2><div>Cozy cabin in the woods $228 for 2 nights, superhost rated. Beachfront loft $340 for 2 nights.</div>
      <h2>Shop the collection</h2><div>Organic cotton tee. Regular price $22. Add to cart. Rental bike $61 /day. Quick view.</div>
      <h2>Trusted by teams everywhere</h2><div>GitHub, Stripe, Shopify, Airbnb and Netflix build on our platform.</div>
      <h2>What customers say</h2><div>"This changed how our whole team ships software." — Jane Doe, VP Engineering at Acme.</div>
      <h2>Loved by home cooks</h2><div>97% of customers feel healthier and save time every single week.</div>
      <h2>Flexible plans</h2><div>Starter $22/mo. Add to cart. Pro $61/mo for growing teams.</div>
    </main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "Welcome", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Places to stay", aboveFold: false, visualWeight: 60 },
        { id: "sec-3-section", type: "section", position: 3, heading: "Shop the collection", aboveFold: false, visualWeight: 56 },
        { id: "sec-4-section", type: "section", position: 4, heading: "Trusted by teams everywhere", aboveFold: false, visualWeight: 52 },
        { id: "sec-5-section", type: "section", position: 5, heading: "What customers say", aboveFold: false, visualWeight: 48 },
        { id: "sec-6-section", type: "section", position: 6, heading: "Loved by home cooks", aboveFold: false, visualWeight: 44 },
        { id: "sec-7-section", type: "section", position: 7, heading: "Flexible plans", aboveFold: false, visualWeight: 40 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "Welcome" },
    };
    const promoted = await refineSectionTypesLlm(
      content,
      html,
      fake({
        "Places to stay": { type: "testimonials", confidence: 0.9 }, // listing grid ($228 for 2 nights) → REJECT
        "Shop the collection": { type: "logos", confidence: 0.9 }, // product grid (Add to cart / Regular price / $61 /day) → REJECT
        "Trusted by teams everywhere": { type: "logos", confidence: 0.9 }, // real brand wall → keep
        "What customers say": { type: "testimonials", confidence: 0.9 }, // real quote + named source → keep
        "Loved by home cooks": { type: "testimonials", confidence: 0.9 }, // %-only sentiment, no $/cart → keep (no over-tighten)
        "Flexible plans": { type: "pricing", confidence: 0.9 }, // has "Add to cart" but pricing isn't commerce-gated → keep
      }),
    );
    const t = (h: string) => content.sections.find((s) => s.heading === h)!.type;
    expect(t("Places to stay")).toBe("section"); // gated: per-unit listing price
    expect(t("Shop the collection")).toBe("section"); // gated: cart actions + per-unit price
    expect(t("Trusted by teams everywhere")).toBe("logos"); // real brand wall survives
    expect(t("What customers say")).toBe("testimonials"); // real quote survives
    expect(t("Loved by home cooks")).toBe("testimonials"); // %-stat survives (COMMERCE_GRID doesn't fire without $/cart)
    expect(t("Flexible plans")).toBe("pricing"); // pricing untouched by the commerce gate
    expect(promoted).toBe(4);
  });

  it("logos cite-and-verify: a bio proposed as logos is rejected, a real brand wall is kept (2026-07-26)", async () => {
    // The token gate can't tell a single-person bio from a brand wall (both pass
    // !LOGOS_ANTI/!COMMERCE_GRID). The cite-and-verify second pass does: it keeps a
    // logos promotion only when >=3 cited brands are physically present. Testimonials
    // are NOT verified (LLM verdict flip-flops) — this test locks logos-only.
    const html = `<main>
      <h1>H</h1><p>i</p>
      <h2>Our customers</h2><div>American Airlines, Duolingo, Ford, Shopify, Spotify and Vodafone build on us.</div>
      <h2>Dr. Nitin Vaswani, MD MPH MBA</h2><div>Director, Clinical Strategy. General surgeon and clinical pathologist trainee.</div>
      <h2>What people say</h2><div>"This changed how our team ships." — Jane Doe, VP Engineering at Acme.</div>
    </main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "H", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Our customers", aboveFold: false, visualWeight: 56 },
        { id: "sec-3-section", type: "section", position: 3, heading: "Dr. Nitin Vaswani, MD MPH MBA", aboveFold: false, visualWeight: 52 },
        { id: "sec-4-section", type: "section", position: 4, heading: "What people say", aboveFold: false, visualWeight: 48 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "H" },
    };
    // Fake verify: cite from the item's own text so the deterministic ground-check runs
    // for real — the wall yields >=3 present brands, the bio yields 0.
    const fakeVerify: typeof verifyLogosLlm = (items) =>
      verifyLogosLlm(items, async (batch) =>
        batch.map((it) =>
          /Our customers/i.test(it.heading)
            ? ["American Airlines", "Duolingo", "Ford", "Shopify"]
            : ["Clinical Strategy", "Johns Hopkins", "Nonexistent Corp"], // none present in the bio body
        ),
      );
    const promoted = await refineSectionTypesLlm(
      content,
      html,
      fake({
        "Our customers": { type: "logos", confidence: 0.95 }, // real wall → verify keeps
        "Dr. Nitin Vaswani, MD MPH MBA": { type: "logos", confidence: 0.9 }, // bio → verify rejects
        "What people say": { type: "testimonials", confidence: 0.95 }, // NOT verified → keeps on floor+ceiling
      }),
      fakeVerify,
    );
    const t = (h: string) => content.sections.find((s) => s.heading === h)!.type;
    expect(t("Our customers")).toBe("logos"); // >=3 cited brands present → kept
    expect(t("Dr. Nitin Vaswani, MD MPH MBA")).toBe("section"); // 0 cited brands present → rejected, stays generic
    expect(t("What people say")).toBe("testimonials"); // testimonials bypass the logos verify
    expect(promoted).toBe(2);
  });

  it("logos verify is fail-open: no verifier result → logos promotion stands (floor behaviour preserved)", async () => {
    const html = `<main><h1>H</h1><p>i</p><h2>Trusted by teams</h2><div>Acme, Globex, Initech.</div></main>`;
    const content: RedesignContentModel = {
      sections: [
        { id: "sec-1-hero", type: "hero", position: 1, heading: "H", aboveFold: true, visualWeight: 85 },
        { id: "sec-2-section", type: "section", position: 2, heading: "Trusted by teams", aboveFold: false, visualWeight: 56 },
      ],
      trustSignals: [],
      ctas: [],
      hero: { headline: "H" },
    };
    const failOpen: typeof verifyLogosLlm = (items) => verifyLogosLlm(items, async () => null); // API failure
    const promoted = await refineSectionTypesLlm(
      content,
      html,
      fake({ "Trusted by teams": { type: "logos", confidence: 0.95 } }),
      failOpen,
    );
    expect(content.sections[1].type).toBe("logos"); // fail-open keeps it (existing gates stand)
    expect(promoted).toBe(1);
  });
});

describe("verifyLogosLlm — LLM citerar, golvet dömer (deterministisk mark-koll)", () => {
  const call =
    (byIndex: (string[] | null)[] | null): typeof callVerifyLogosApi =>
    async () =>
      byIndex;

  it("keeps when >=3 cited brands are physically present in the text", async () => {
    const items = [{ heading: "Our customers", body: "Acme Globex Initech Umbrella power our work" }];
    expect(await verifyLogosLlm(items, call([["Acme", "Globex", "Initech"]]))).toEqual([true]);
  });

  it("rejects when fewer than 3 cited brands are present", async () => {
    const items = [{ heading: "Partners", body: "Acme and Globex only" }];
    expect(await verifyLogosLlm(items, call([["Acme", "Globex"]]))).toEqual([false]);
  });

  it("rejects hallucinated citations (cited but not in the body)", async () => {
    const items = [{ heading: "Dr. Smith, MD", body: "Director of Clinical Strategy, a general surgeon." }];
    expect(await verifyLogosLlm(items, call([["Acme", "Globex", "Initech"]]))).toEqual([false]); // none present
  });

  it("fail-open: a null API result keeps every item", async () => {
    const items = [{ heading: "a", body: "b" }, { heading: "c", body: "d" }];
    expect(await verifyLogosLlm(items, call(null))).toEqual([true, true]);
  });

  it("fail-open per item: a missing per-item verdict keeps that item", async () => {
    const items = [
      { heading: "x", body: "no brands here" },
      { heading: "Wall", body: "Acme Globex Initech present" },
    ];
    expect(await verifyLogosLlm(items, call([null, ["Acme", "Globex", "Initech"]]))).toEqual([true, true]);
  });

  it("counts DISTINCT brands — repeats don't reach the threshold of 3", async () => {
    const items = [{ heading: "Partners", body: "Acme Acme Acme everywhere" }];
    expect(await verifyLogosLlm(items, call([["Acme", "Acme", "Acme"]]))).toEqual([false]);
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
