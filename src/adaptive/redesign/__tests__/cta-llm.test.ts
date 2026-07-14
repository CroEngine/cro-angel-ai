import { describe, it, expect } from "vitest";

import { addLlmCtas } from "../cta-llm.server";
import { extractCtaCandidates } from "../extract";

import type { RedesignContentModel } from "../context";
import type { labelTexts } from "../../labeler.server";

// En georgisk sida — ett språk BORTOM det deterministiska ~30-språksgolvet,
// precis fallet LLM-lagret finns för. "ყიდვა" = köp, "შესვლა" = logga in.
const PAGE = `
  <main>
    <h1>მთავარი</h1>
    <a href="/buy">ყიდვა ახლავე</a>
    <a href="/login">შესვლა</a>
    <a href="#faq">კითხვები</a>
    <a href="/konto">Skapa konto</a>
  </main>`;

const model = (): RedesignContentModel => ({
  sections: [],
  trustSignals: [],
  ctas: [{ text: "Skapa konto", intent: "conversion", aboveFold: true }],
  hero: undefined,
});

const fakeLabeler =
  (byText: Record<string, { role: string; confidence: number } | null>): typeof labelTexts =>
  async (batch) =>
    batch.map((b) => {
      const l = byText[b.text];
      return l ? { role: l.role, confidence: l.confidence } : null;
    });

describe("addLlmCtas — språk-universella lagret ovanpå det deterministiska golvet", () => {
  it("skickar BARA golvets 'unknown' (aldrig flikar eller redan kända) och mappar acquisition → conversion", async () => {
    const content = model();
    const candidates = extractCtaCandidates(PAGE);
    const seen: string[] = [];
    const labeler: typeof labelTexts = async (batch) => {
      batch.forEach((b) => seen.push(b.text));
      return fakeLabeler({
        "ყიდვა ახლავე": { role: "acquisition", confidence: 0.95 },
        "შესვლა": { role: "auth", confidence: 0.9 },
      })(batch);
    };
    const added = await addLlmCtas(content, candidates, labeler);
    expect(added).toBe(1);
    expect(seen).not.toContain("Skapa konto"); // golvet dömde redan: conversion
    expect(seen).not.toContain("კითხვები"); // same-page anchor = navigation, aldrig LLM
    expect(content.ctas.map((c) => c.text)).toContain("ყიდვა ახლავე");
    expect(content.ctas.find((c) => c.text === "ყიდვა ახლავე")?.intent).toBe("conversion");
    // login-länken etiketterades auth → aldrig in i modellen
    expect(content.ctas.map((c) => c.text)).not.toContain("შესვლა");
  });

  it("respekterar konfidensgolvet — osäkra omdömen påverkar aldrig brief/hit-test", async () => {
    const content = model();
    const added = await addLlmCtas(
      content,
      extractCtaCandidates(PAGE),
      fakeLabeler({ "ყიდვა ახლავე": { role: "acquisition", confidence: 0.5 } }),
    );
    expect(added).toBe(0);
    expect(content.ctas).toHaveLength(1);
  });

  it("utan nyckel/API (labeler → null) står golvet ensamt — inga gissningar", async () => {
    const content = model();
    const added = await addLlmCtas(content, extractCtaCandidates(PAGE), async () => null);
    expect(added).toBe(0);
    expect(content.ctas).toHaveLength(1);
  });
});
