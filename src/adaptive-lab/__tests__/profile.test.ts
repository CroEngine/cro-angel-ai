// E2 profile core — pure-function tests (no DOM, no storage).
import { describe, expect, it } from "vitest";

import {
  classifyTouch,
  deriveCohorts,
  foldPageIntoProfile,
  serializeProfile,
  type AngelProfile,
  type PageVisit,
} from "../profile";

const T0 = 1_700_000_000_000;
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

function visit(over: Partial<PageVisit> = {}): PageVisit {
  return { path: "/", ts: T0, sectionTypes: ["hero", "features"], touch: null, ...over };
}

describe("classifyTouch", () => {
  const own = "example.com";
  const cases: Array<[string, string, ReturnType<typeof classifyTouch>]> = [
    ["", "", { channel: "direct", source: "direct" }],
    ["https://www.google.com/search?q=x", "", { channel: "search", source: "google" }],
    ["https://www.google.se/", "", { channel: "search", source: "google" }],
    ["https://duckduckgo.com/", "", { channel: "search", source: "duckduckgo" }],
    ["https://www.linkedin.com/feed/", "", { channel: "social", source: "linkedin" }],
    ["https://lnkd.in/abc", "", { channel: "social", source: "linkedin" }],
    ["https://t.co/xyz", "", { channel: "social", source: "x" }],
    ["https://out.reddit.com/", "", { channel: "social", source: "reddit" }],
    ["https://some-blog.io/post", "", { channel: "referral", source: "some-blog.io" }],
    // UTM outranks referrer
    ["https://www.google.com/", "?utm_source=newsletter&utm_medium=email", { channel: "email", source: "newsletter" }],
    ["https://www.google.com/", "?utm_source=google&utm_medium=cpc", { channel: "ads", source: "google" }],
    ["", "?gclid=abc123", { channel: "ads", source: "google" }],
    ["", "?fbclid=abc123", { channel: "ads", source: "facebook" }],
    ["", "?utm_source=linkedin&utm_medium=social", { channel: "social", source: "linkedin" }],
    ["", "?utm_source=partnerx", { channel: "referral", source: "partnerx" }],
    // internal navigation → null (existing touch stands)
    ["https://example.com/about", "", null],
    ["https://www.example.com/", "", null],
    ["https://sub.example.com/", "", null],
  ];
  for (const [ref, search, expected] of cases) {
    it(`${ref || "(no referrer)"} ${search || ""} → ${JSON.stringify(expected)}`, () => {
      expect(classifyTouch(ref, search, own)).toEqual(expected);
    });
  }
});

describe("foldPageIntoProfile", () => {
  it("creates a fresh v1 profile on first visit", () => {
    const p = foldPageIntoProfile(null, visit({ touch: { channel: "search", source: "google" } }));
    expect(p.v).toBe(1);
    expect(p.visits).toBe(1);
    expect(p.firstTouch).toEqual({ channel: "search", source: "google" });
    expect(p.lastTouch).toEqual({ channel: "search", source: "google" });
    expect(p.pages).toHaveLength(1);
    expect(p.seenPricing).toBe(false);
  });

  it("same session (< 30 min) keeps the visit count; a gap increments it", () => {
    let p = foldPageIntoProfile(null, visit());
    p = foldPageIntoProfile(p, visit({ path: "/features", ts: T0 + 10 * MIN }));
    expect(p.visits).toBe(1);
    p = foldPageIntoProfile(p, visit({ path: "/", ts: T0 + 50 * MIN }));
    expect(p.visits).toBe(2);
  });

  it("internal navigation (touch null) preserves the last touch", () => {
    let p = foldPageIntoProfile(null, visit({ touch: { channel: "social", source: "linkedin" } }));
    p = foldPageIntoProfile(p, visit({ path: "/pricing", ts: T0 + MIN, touch: null }));
    expect(p.lastTouch).toEqual({ channel: "social", source: "linkedin" });
  });

  it("a new touch on a later visit updates lastTouch, never firstTouch", () => {
    let p = foldPageIntoProfile(null, visit({ touch: { channel: "social", source: "linkedin" } }));
    p = foldPageIntoProfile(
      p,
      visit({ ts: T0 + 40 * MIN, touch: { channel: "search", source: "google" } }),
    );
    expect(p.firstTouch).toEqual({ channel: "social", source: "linkedin" });
    expect(p.lastTouch).toEqual({ channel: "search", source: "google" });
  });

  it("seenPricing sticks — by path and by section type", () => {
    let p = foldPageIntoProfile(null, visit({ path: "/pricing", ts: T0 }));
    expect(p.seenPricing).toBe(true);
    p = foldPageIntoProfile(p, visit({ path: "/", ts: T0 + MIN }));
    expect(p.seenPricing).toBe(true);

    const bySection = foldPageIntoProfile(
      null,
      visit({ path: "/", sectionTypes: ["hero", "pricing"] }),
    );
    expect(bySection.seenPricing).toBe(true);
    expect(foldPageIntoProfile(null, visit({ path: "/prisjakt" })).seenPricing).toBe(false);
    expect(foldPageIntoProfile(null, visit({ path: "/priser" })).seenPricing).toBe(true);
  });

  it("re-crawls of the same path within 5 min merge into one page entry", () => {
    let p = foldPageIntoProfile(null, visit());
    p = foldPageIntoProfile(p, visit({ ts: T0 + 30_000, sectionTypes: ["hero", "faq"] }));
    expect(p.pages).toHaveLength(1);
    expect(p.pages[0].secs).toContain("faq");
  });

  it("ring buffer caps at 30 pages", () => {
    let p: AngelProfile | null = null;
    for (let i = 0; i < 40; i++) {
      p = foldPageIntoProfile(p, visit({ path: `/p${i}`, ts: T0 + i * 6 * MIN }));
    }
    expect(p!.pages.length).toBe(30);
    expect(p!.pages[0].p).toBe("/p10");
  });

  it("expired profiles (> 90 days) reset instead of accumulating", () => {
    let p = foldPageIntoProfile(null, visit({ touch: { channel: "social", source: "linkedin" } }));
    p = foldPageIntoProfile(p, visit({ ts: T0 + 91 * DAY, touch: null }));
    expect(p.visits).toBe(1);
    expect(p.firstTouch).toBeNull();
    expect(p.firstSeen).toBe(T0 + 91 * DAY);
  });
});

describe("serializeProfile", () => {
  it("drops oldest pages to fit the size cap", () => {
    let p: AngelProfile | null = null;
    for (let i = 0; i < 30; i++) {
      p = foldPageIntoProfile(p, {
        path: "/very/long/path/segment/number/" + i + "/x".repeat(180),
        ts: T0 + i * 6 * MIN,
        sectionTypes: ["hero", "features", "testimonials", "pricing"],
        touch: null,
      });
    }
    const json = serializeProfile(p!);
    expect(json.length).toBeLessThanOrEqual(6000);
    const parsed = JSON.parse(json) as AngelProfile;
    expect(parsed.pages[parsed.pages.length - 1].p).toContain("/29/");
  });
});

describe("deriveCohorts", () => {
  it("names channel, source, return state and pricing exposure", () => {
    let p = foldPageIntoProfile(null, visit({ touch: { channel: "social", source: "linkedin" } }));
    p = foldPageIntoProfile(p, visit({ path: "/pricing", ts: T0 + 40 * MIN, touch: null }));
    expect(deriveCohorts(p)).toEqual(["ch:social", "src:linkedin", "ret:2plus", "seen:pricing"]);
  });
  it("handles the null profile", () => {
    expect(deriveCohorts(null)).toEqual([]);
  });
  it("direct visitors don't get a redundant src key", () => {
    const p = foldPageIntoProfile(null, visit({ touch: { channel: "direct", source: "direct" } }));
    expect(deriveCohorts(p)).toEqual(["ch:direct", "ret:new"]);
  });
});
