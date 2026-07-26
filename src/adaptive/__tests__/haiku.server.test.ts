import { afterEach, describe, expect, it, vi } from "vitest";

import { callHaikuText } from "../haiku.server";

// Locks the shared Haiku fetch scaffolding that section-llm / proof-rank /
// labeler / goal-judge all now depend on (previously 4 untested copies).

function mockFetch(body: unknown, ok = true, status = 200) {
  // Typed like the fetch call so fn.mock.calls[0] is [url, init], not an empty tuple.
  const fn = vi.fn(async (_url: string, _init?: RequestInit) =>
    ({ ok, status, json: async () => body }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const TEXT_BODY = { content: [{ type: "text", text: '[{"i":0}]' }] };

describe("callHaikuText", () => {
  it("returns null and never fetches without an API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fn = mockFetch(TEXT_BODY);
    expect(await callHaikuText({ system: "s", userContent: "u", max_tokens: 10, tag: "t" })).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("posts to the messages endpoint with the pinned model + headers", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fn = mockFetch(TEXT_BODY);
    await callHaikuText({ system: "SYS", userContent: "USER", max_tokens: 1500, tag: "section-typer" });
    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(1500);
    expect(body.system).toBe("SYS");
    expect(body.messages).toEqual([{ role: "user", content: "USER" }]);
  });

  it("omits temperature unless set, and includes it (even 0) when passed", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const noTemp = mockFetch(TEXT_BODY);
    await callHaikuText({ system: "s", userContent: "u", max_tokens: 10, tag: "t" });
    expect(JSON.parse((noTemp.mock.calls[0][1] as RequestInit).body as string)).not.toHaveProperty(
      "temperature",
    );
    vi.unstubAllGlobals();
    const withTemp = mockFetch(TEXT_BODY);
    await callHaikuText({ system: "s", userContent: "u", max_tokens: 10, temperature: 0, tag: "goal-judge" });
    expect(JSON.parse((withTemp.mock.calls[0][1] as RequestInit).body as string).temperature).toBe(0);
  });

  it("returns the first text block", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    mockFetch({ content: [{ type: "thinking", text: "no" }, { type: "text", text: "yes" }] });
    expect(await callHaikuText({ system: "s", userContent: "u", max_tokens: 10, tag: "t" })).toBe("yes");
  });

  it("returns null on a non-OK API response", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch({}, false, 529);
    expect(await callHaikuText({ system: "s", userContent: "u", max_tokens: 10, tag: "proof-rank" })).toBeNull();
    expect(warn).toHaveBeenCalledWith("[angel] proof-rank: API 529");
    warn.mockRestore();
  });

  it("returns null (never throws) when fetch rejects", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await callHaikuText({ system: "s", userContent: "u", max_tokens: 10, tag: "labeler" })).toBeNull();
  });
});
