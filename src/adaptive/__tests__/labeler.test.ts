import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { labelTexts, labelInventoryCtas, LABEL_VERSION } from "../labeler.server";
import { resolveRole, isAcquisition } from "../crawler-inventory";
import type { ContentInventory } from "../types";

const apiResponse = (labels: unknown) => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify(labels) }] }),
});

describe("labelTexts — Anthropic call with strict validation", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.unstubAllGlobals();
  });

  it("returns null without an API key (deterministic rules stand alone)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await labelTexts([{ text: "Hilfe" }])).toBeNull();
  });

  it("parses valid labels and indexes them like the input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        apiResponse([
          { i: 0, role: "support", confidence: 0.95 },
          // extra fält från modellen (t.ex. gamla v1-promptens intent) ignoreras
          { i: 1, role: "acquisition", intent: "signup", confidence: 0.9 },
        ]),
      ),
    );
    const out = await labelTexts([{ text: "Hilfe" }, { text: "Konto erstellen" }]);
    expect(out?.[0]).toEqual({ role: "support", confidence: 0.95 });
    expect(out?.[1]).toEqual({ role: "acquisition", confidence: 0.9 });
  });

  it("rejects unknown roles and out-of-range indices; clamps confidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        apiResponse([
          { i: 0, role: "evil-role", confidence: 1 },
          { i: 7, role: "support", confidence: 1 },
          { i: 1, role: "acquisition", confidence: 9 },
        ]),
      ),
    );
    const out = await labelTexts([{ text: "a" }, { text: "b" }]);
    expect(out?.[0]).toBeNull(); // bad role dropped
    expect(out?.[1]).toEqual({ role: "acquisition", confidence: 1 });
  });

  it("returns null on malformed output and on API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => apiResponse("not an array")));
    expect(await labelTexts([{ text: "a" }])).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })));
    expect(await labelTexts([{ text: "a" }])).toBeNull();
  });
});

describe("labelInventoryCtas — cache + in-place labelling", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.unstubAllGlobals();
  });

  const inv = (metaExtra: Record<string, string> = {}): ContentInventory => ({
    site: "t",
    slots: {
      cta: [
        {
          id: "cta-0",
          slot: "cta",
          text: "Hilfe",
          selector: "#help",
          meta: { role: "acquisition", href: "/hilfe", ...metaExtra },
        },
      ],
    },
  });

  it("labels new items via the API and stamps the version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => apiResponse([{ i: 0, role: "support", confidence: 0.9 }])),
    );
    const inventory = inv();
    await labelInventoryCtas(inventory, null);
    const meta = inventory.slots.cta![0].meta!;
    expect(meta.llmRole).toBe("support");
    expect(meta.labelVersion).toBe(LABEL_VERSION);
  });

  it("reuses cached labels for unchanged (text|href) without calling the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const prev = inv({ llmRole: "support", llmConfidence: "0.90", labelVersion: LABEL_VERSION });
    const next = inv();
    await labelInventoryCtas(next, prev);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(next.slots.cta![0].meta!.llmRole).toBe("support");
  });

  it("leaves items untouched when the API is unavailable", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const inventory = inv();
    await labelInventoryCtas(inventory, null);
    expect(inventory.slots.cta![0].meta!.llmRole).toBeUndefined();
  });
});

describe("resolveRole — precedence between rule verdicts and LLM labels", () => {
  it("rule verdict is a floor the LLM can never override upward", () => {
    expect(
      resolveRole({
        meta: { role: "support", llmRole: "acquisition", llmConfidence: "0.99" },
      }),
    ).toBe("support");
  });

  it("a confident LLM label demotes items the rules missed", () => {
    expect(resolveRole({ meta: { role: "acquisition", llmRole: "support", llmConfidence: "0.90" } })).toBe(
      "support",
    );
    expect(isAcquisition({ meta: { role: "acquisition", llmRole: "support", llmConfidence: "0.90" } })).toBe(
      false,
    );
  });

  it("an unconfident LLM label is advisory only", () => {
    expect(resolveRole({ meta: { role: "acquisition", llmRole: "support", llmConfidence: "0.50" } })).toBe(
      "acquisition",
    );
  });
});

