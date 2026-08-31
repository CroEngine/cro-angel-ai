import { describe, it, expect } from "vitest";

import {
  mapFindings,
  previewAllowed,
  PREVIEW_MAX_PER_DAY,
  requesterHash,
  validatePreviewUrl,
} from "../preview";

describe("validatePreviewUrl — public http(s) only, prospect-friendly", () => {
  it("accepts a bare domain and assumes https", () => {
    const r = validatePreviewUrl("exempel.se");
    expect(r).toEqual({ ok: true, url: "https://exempel.se/" });
  });

  it("accepts full https URLs and strips the fragment", () => {
    const r = validatePreviewUrl("https://plausible.io/#pricing");
    expect(r).toEqual({ ok: true, url: "https://plausible.io/" });
  });

  it("rejects localhost, private ranges and link-local (SSRF hygiene)", () => {
    for (const bad of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "https://10.0.0.5",
      "https://192.168.1.1/admin",
      "https://172.16.0.9",
      "https://169.254.169.254/latest/meta-data",
      "https://foo.internal",
      "https://[::1]/",
    ]) {
      const r = validatePreviewUrl(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("rejects non-http protocols, credentials, IP literals and junk", () => {
    expect(validatePreviewUrl("ftp://example.com").ok).toBe(false);
    expect(validatePreviewUrl("javascript:alert(1)").ok).toBe(false);
    expect(validatePreviewUrl("https://user:pw@example.com").ok).toBe(false);
    expect(validatePreviewUrl("https://8.8.8.8").ok).toBe(false);
    expect(validatePreviewUrl("").ok).toBe(false);
    expect(validatePreviewUrl("not a url at all").ok).toBe(false);
    expect(validatePreviewUrl("intranet").ok).toBe(false); // no dot ⇒ not public
  });
});

describe("rate limiting — hashed requester, small honest cap", () => {
  it("hashes the ip and never exposes it", () => {
    const h = requesterHash("203.0.113.7");
    expect(h).toHaveLength(32);
    expect(h).not.toContain("203");
    expect(requesterHash("203.0.113.7")).toBe(h); // deterministic
    expect(requesterHash("203.0.113.8")).not.toBe(h);
  });

  it("allows under the cap, refuses at it", () => {
    expect(previewAllowed(0)).toBe(true);
    expect(previewAllowed(PREVIEW_MAX_PER_DAY - 1)).toBe(true);
    expect(previewAllowed(PREVIEW_MAX_PER_DAY)).toBe(false);
  });
});

describe("mapFindings — the day0-card shape, tolerant of junk", () => {
  it("maps headlines by weight and the lift status", () => {
    const f = mapFindings({
      fynd: [
        { rubrik: "B", vikt: 2 },
        { rubrik: "A", vikt: 1 },
        { rubrik: "C", vikt: 3 },
        { rubrik: "D", vikt: 4 },
      ],
      flyttStatus: "pass",
    });
    expect(f).toEqual({ headlines: ["A", "B", "C"], liftTest: "pass", moved: null });
  });

  it("returns null/empty shapes on junk instead of throwing", () => {
    expect(mapFindings(null)).toBeNull();
    expect(mapFindings("x")).toBeNull();
    expect(mapFindings({})).toEqual({ headlines: [], liftTest: null, moved: null });
    expect(mapFindings({ fynd: [{ vikt: 1 }], flyttStatus: 7 })).toEqual({
      headlines: [],
      liftTest: null,
      moved: null,
    });
  });

  it("surfaces the structured moved-locator; junk or empty text stays null", () => {
    expect(
      mapFindings({ fynd: [], flyttStatus: null, flytt: { tag: "h2", text: "Vanliga frågor" } })
        ?.moved,
    ).toEqual({ tag: "h2", text: "Vanliga frågor" });
    // Äldre jobb utan fältet, och trasiga former, döljer spotlighten ärligt.
    expect(mapFindings({ fynd: [], flyttStatus: null })?.moved).toBeNull();
    expect(mapFindings({ flytt: { tag: "h2", text: "" } })?.moved).toBeNull();
    expect(mapFindings({ flytt: { text: 42 } })?.moved).toBeNull();
    expect(mapFindings({ flytt: { tag: 9, text: "Rubrik" } })?.moved).toEqual({
      tag: null,
      text: "Rubrik",
    });
  });
});
