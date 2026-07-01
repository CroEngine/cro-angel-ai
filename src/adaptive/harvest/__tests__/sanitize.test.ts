import { describe, it, expect } from "vitest";

import { sanitizeAudit, cleanText } from "../sanitize";

describe("cleanText", () => {
  it("redacts emails and long digit runs, collapses whitespace, caps length", () => {
    expect(cleanText("mail me at a.b@example.com now")).toBe("mail me at [redacted] now");
    expect(cleanText("call 555 123 4567 today")).toBe("call [redacted] today");
    expect(cleanText("  a   b \n c ")).toBe("a b c");
    expect(cleanText("x".repeat(500)).length).toBe(200);
    expect(cleanText(42)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });
});

describe("sanitizeAudit", () => {
  it("keeps only inventory-relevant fields (drops images/videos/head/etc.)", () => {
    const out = sanitizeAudit({
      url: "https://x.se/",
      ctas: [{ text: "Start free", selector: "#a", intent: "conversion", aboveFold: true }],
      images: { total: 99 },
      videos: { count: 3 },
      head: { title: "secret" },
      robots: "User-agent: *",
    });
    expect(Object.keys(out).sort()).toEqual(["ctas", "url"]);
    expect((out as Record<string, unknown>).images).toBeUndefined();
    expect((out as Record<string, unknown>).head).toBeUndefined();
  });

  it("strips URL query/hash", () => {
    const out = sanitizeAudit({ url: "https://x.se/path?token=abc#frag" });
    expect(out.url).toBe("https://x.se/path");
  });

  it("scrubs PII inside CTA/hero/section/trust text", () => {
    const out = sanitizeAudit({
      url: "https://x.se/",
      ctas: [{ text: "Email jane@doe.com", selector: "#c" }],
      hero: { headline: "Call 070 123 45 67" },
      sections: [{ id: "s1", type: "hero", position: 0, heading: "Hi bob@x.io" }],
      trustSignals: [{ type: "testimonial", text: "Great — a@b.com", personName: "Bob" }],
    });
    expect((out.ctas as { text: string }[])[0].text).toBe("Email [redacted]");
    expect((out.hero as { headline: string }).headline).toBe("Call [redacted]");
    expect((out.sections as { heading: string }[])[0].heading).toBe("Hi [redacted]");
    expect((out.trustSignals as { text: string }[])[0].text).toBe("Great — [redacted]");
  });

  it("keeps a selector-only CTA but drops empty ones", () => {
    const out = sanitizeAudit({
      url: "https://x.se/",
      ctas: [{ selector: "#only" }, { text: "", selector: "" }, { text: "Buy" }],
    });
    expect((out.ctas as unknown[]).length).toBe(2);
  });

  it("returns {} for garbage input", () => {
    expect(sanitizeAudit(null)).toEqual({});
    expect(sanitizeAudit("nope")).toEqual({});
    expect(sanitizeAudit(123)).toEqual({});
  });

  it("caps array sizes", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ text: `cta ${i}`, selector: `#c${i}` }));
    const out = sanitizeAudit({ url: "https://x.se/", ctas: many });
    expect((out.ctas as unknown[]).length).toBe(200);
  });
});
