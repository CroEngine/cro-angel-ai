import { describe, it, expect } from "vitest";

import type { SegmentSummary } from "@/lib/dashboard/aggregate";
import {
  classifyTrend,
  segmentInsightFrom,
  buildRedesignContext,
  renderRedesignPrompt,
  DEFAULT_REDESIGN_GUARDRAILS,
  CROSS_PAGE_ALLOWED,
  INSERT_SNIPPET_ALLOWED,
  withInsertSnippet,
  type RedesignContentModel,
  type RedesignPageRef,
} from "../context";

const seg = (over: Partial<SegmentSummary> = {}): SegmentSummary => ({
  key: "instagram·mobile·se",
  label: "instagram · mobile · se",
  depth: 3,
  channel: "instagram",
  device: "mobile",
  country: "se",
  returning: null,
  visits: 2082,
  conversions: 101,
  conversionRate: 0.062,
  formStarts: 0,
  formAbandons: 0,
  adequate: true,
  recent: { visits: 900, conversions: 80, conversionRate: 0.089, adequate: false },
  ...over,
});

const page: RedesignPageRef = {
  url: "https://example.se/",
  frozenHtmlPath: "fixtures/frozen/example/page.mhtml",
  screenshotPath: "fixtures/frozen/example/screenshot.jpg",
  viewport: { width: 390, height: 844 },
};

const content: RedesignContentModel = {
  sections: [
    {
      id: "s1",
      type: "hero",
      position: 1,
      heading: "Kom igång",
      aboveFold: true,
      visualWeight: 80,
    },
    {
      id: "s2",
      type: "pricing",
      position: 2,
      heading: "Priser",
      aboveFold: false,
      visualWeight: 60,
    },
    {
      id: "s3",
      type: "testimonials",
      position: 3,
      heading: "Röster",
      aboveFold: false,
      visualWeight: 40,
    },
  ],
  trustSignals: [
    {
      type: "social_proof_count",
      text: "10 000 nöjda kunder",
      aboveFold: false,
      section: "testimonials",
    },
  ],
  ctas: [{ text: "Skapa konto", intent: "conversion", aboveFold: true }],
  hero: { headline: "Sveriges enklaste verktyg", subheadline: "Gratis att börja" },
};

describe("classifyTrend", () => {
  it("classifies rising / falling / flat / unknown by relative move", () => {
    expect(classifyTrend(0.062, 0.089)).toBe("rising"); // +44%
    expect(classifyTrend(0.083, 0.045)).toBe("falling"); // -46%
    expect(classifyTrend(0.1, 0.105)).toBe("flat"); // +5% < 15%
    expect(classifyTrend(0.1, null)).toBe("unknown"); // no recent window
    expect(classifyTrend(0, 0.05)).toBe("unknown"); // no lifetime base
  });
});

describe("segmentInsightFrom", () => {
  it("maps a SegmentSummary (lifetime + recent) into the insight, deriving trend", () => {
    const insight = segmentInsightFrom(seg(), {
      rageRefs: [{ ref: "button#kop", bursts: 42 }],
      formAbandonRate: 0.18,
      observations: ["social proof sits below the fold"],
    });
    expect(insight).toMatchObject({
      key: "instagram·mobile·se",
      visitsLifetime: 2082,
      conversionRateLifetime: 0.062,
      conversionRateRecent: 0.089,
      trend: "rising",
      adequate: true,
      formAbandonRate: 0.18,
    });
    expect(insight.rageRefs[0].ref).toBe("button#kop");
  });

  it("recent=null → recent rate null + unknown trend", () => {
    const insight = segmentInsightFrom(seg({ recent: null }));
    expect(insight.conversionRateRecent).toBeNull();
    expect(insight.trend).toBe("unknown");
  });
});

describe("renderRedesignPrompt", () => {
  const ctx = buildRedesignContext({
    site: "example",
    goal: { text: "Skapa konto", kind: "signup", selector: "#kop" },
    page,
    content,
    segment: segmentInsightFrom(seg(), {
      rageRefs: [{ ref: "button#kop", bursts: 42 }],
      observations: ["social proof (10 000 kunder) sits below the fold"],
    }),
  });
  const prompt = renderRedesignPrompt(ctx);

  it("hands over the page + screenshot + frozen markup refs", () => {
    expect(prompt).toContain("https://example.se/");
    expect(prompt).toContain("page.mhtml");
    expect(prompt).toContain("screenshot.jpg");
  });

  it("lists sections in placement order and flags fold position", () => {
    const hero = prompt.indexOf("[s1] hero");
    const pricing = prompt.indexOf("[s2] pricing");
    const testi = prompt.indexOf("[s3] testimonials");
    expect(hero).toBeGreaterThan(-1);
    expect(hero).toBeLessThan(pricing);
    expect(pricing).toBeLessThan(testi);
    expect(prompt).toContain("below fold");
  });

  it("carries the segment trend + frustration lever", () => {
    expect(prompt).toContain("instagram · mobile · se");
    expect(prompt).toContain("rising");
    expect(prompt).toContain("button#kop");
    expect(prompt).toContain("social proof");
  });

  it("states the hard rule: only rearrange existing, never invent; ops-only output", () => {
    expect(prompt).toMatch(/only rearrange|never invent|not invent/i);
    for (const op of DEFAULT_REDESIGN_GUARDRAILS.ops) expect(prompt).toContain(op);
    // both allowed and forbidden lists surface
    expect(prompt).toContain("ALLOWED");
    expect(prompt).toContain("FORBIDDEN");
    expect(prompt).toMatch(/Invent any content/i);
  });

  it("defaults to the croengine-vision guardrails when none passed", () => {
    expect(ctx.guardrails).toBe(DEFAULT_REDESIGN_GUARDRAILS);
  });
});

describe("sourcePages — korssid-lyftets citerbara material (task #117)", () => {
  // Korssid-lyftet KRÄVER insert_snippet i vokabulären. Sedan ägarbeslutet
  // 2026-08-15 ("endast flytta sektioner") ligger det inte i standarden, så
  // testerna ber om det explicit — samma väg en anropare som medvetet vill ha
  // tillbaka textdraget måste ta.
  const INSERT_ON = withInsertSnippet(DEFAULT_REDESIGN_GUARDRAILS);
  const withSources = buildRedesignContext({
    site: "example",
    goal: { text: "Skapa konto", kind: "signup", selector: "#kop" },
    page,
    content,
    segment: segmentInsightFrom(seg(), {}),
    guardrails: INSERT_ON,
    sourcePages: [
      {
        path: "/priser",
        snippets: [{ text: "Från 99 kr/mån — alla funktioner ingår.", tag: "p" }],
      },
      { path: "/tom", snippets: [] },
    ],
  });

  it("keeps only source pages with actual snippets and extends the allowlist", () => {
    expect(withSources.sourcePages?.map((p) => p.path)).toEqual(["/priser"]);
    expect(withSources.guardrails.ops).toContain("insert_snippet");
    expect(withSources.guardrails.allowed).toContain(CROSS_PAGE_ALLOWED);
  });

  it("renders the quotes verbatim in the prompt with the verbatim-only rule", () => {
    const prompt = renderRedesignPrompt(withSources);
    expect(prompt).toContain("Quotable content from OTHER pages");
    expect(prompt).toContain("Från 99 kr/mån — alla funktioner ingår.");
    expect(prompt).toContain("insert_snippet");
    expect(prompt).toMatch(/VERBATIM/);
  });

  it("leaves a single-page context untouched (no section, no verb)", () => {
    const single = buildRedesignContext({
      site: "example",
      goal: { text: null, kind: null, selector: null },
      page,
      content,
      segment: segmentInsightFrom(seg(), {}),
      guardrails: INSERT_ON,
    });
    expect(single.sourcePages).toBeUndefined();
    // Samma-sida-lyftet (2026-07-27): med insert påslaget är verbet i
    // vokabulären — whitelist-SEKTIONEN i prompten hör dock fortfarande till
    // källsidorna.
    expect(single.guardrails.ops).toContain("insert_snippet");
    expect(single.guardrails.allowed).not.toContain(CROSS_PAGE_ALLOWED);
    expect(renderRedesignPrompt(single)).not.toContain("Quotable content");
  });

  // ÄGARBESLUTET 2026-08-15, den viktiga raden: med move-only vokabulär är
  // källsidorna INTE material. Förut lade buildRedesignContext på korssid-
  // raden i allowed oavsett ops, så prompten hade lovat designern ett drag
  // validateOps omedelbart slänger — kontexten sa en sak och grinden en annan.
  it("move-only: källsidorna faller bort helt — prompten lovar inget den inte får", () => {
    const moveOnly = buildRedesignContext({
      site: "example",
      goal: { text: null, kind: null, selector: null },
      page,
      content,
      segment: segmentInsightFrom(seg(), {}),
      sourcePages: [
        {
          path: "/priser",
          snippets: [{ text: "Från 99 kr/mån — alla funktioner ingår.", tag: "p" }],
        },
      ],
    });
    expect(moveOnly.sourcePages).toBeUndefined();
    expect(moveOnly.guardrails.allowed).not.toContain(CROSS_PAGE_ALLOWED);
    const prompt = renderRedesignPrompt(moveOnly);
    expect(prompt).not.toContain("Quotable content");
    expect(prompt).not.toContain("insert_snippet");
    // Retext-formatet ska inte heller läras ut när set_text/condense är ur
    // vokabulären — en LLM som får ett format brukar använda det.
    expect(prompt).not.toContain("EXACT replacement copy");
    expect(prompt).toContain("never change a single word");
  });
});

describe("sourcePages — offert-fallbackens kind i prompten (slice 4)", () => {
  it("explains the link rendering for answer-kind source pages", () => {
    const ctx = buildRedesignContext({
      site: "example",
      goal: { text: null, kind: null, selector: null },
      page,
      content,
      segment: segmentInsightFrom(seg(), {}),
      guardrails: withInsertSnippet(DEFAULT_REDESIGN_GUARDRAILS),
      sourcePages: [
        {
          path: "/sv/pricing",
          kind: "answer",
          snippets: [{ text: "Låt oss ge dig en offert", tag: "h1" }],
        },
      ],
    });
    const prompt = renderRedesignPrompt(ctx);
    expect(prompt).toContain("publishes no prices");
    expect(prompt).toContain("Låt oss ge dig en offert");
  });
});

describe("ägarregeln: endast omflytt", () => {
  it("default-vokabulären är move_up — inget annat", () => {
    // 2026-07-28 ("vi ska endast skicka runt färdiga stycken") tog set_text,
    // reveal och condense ur GENERERINGEN. 2026-08-15 ("endast flytta
    // sektioner, inte ändra text") tog även insert_snippet. En breddning av
    // den här listan är ett ägarbeslut, inte en refaktorering — testet gör
    // den medveten.
    expect(DEFAULT_REDESIGN_GUARDRAILS.ops).toEqual(["move_up"]);
    // ...och allowed får aldrig lova mer än ops tillåter.
    expect(DEFAULT_REDESIGN_GUARDRAILS.allowed).not.toContain(INSERT_SNIPPET_ALLOWED);
  });

  it("withInsertSnippet lägger på BÅDE op:en och dess allowed-rad, en gång", () => {
    const on = withInsertSnippet(DEFAULT_REDESIGN_GUARDRAILS);
    expect(on.ops).toEqual(["move_up", "insert_snippet"]);
    expect(on.allowed).toContain(INSERT_SNIPPET_ALLOWED);
    // Idempotent: dubbla anrop får inte dubblera raden i prompten.
    expect(withInsertSnippet(on)).toBe(on);
    // Grundvokabulären är orörd (ingen mutation av den delade konstanten).
    expect(DEFAULT_REDESIGN_GUARDRAILS.ops).toEqual(["move_up"]);
  });
});
