import { describe, it, expect } from "vitest";

import { sanitizeAudit, sanitizeObserve, cleanText, scrubPath } from "../sanitize";

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

  it("preserves a CTA's href (the goal signal), stripping query and dangerous schemes", () => {
    const out = sanitizeAudit({
      url: "https://x.se/",
      ctas: [
        { text: "Compare", selector: "#a", href: "https://partner.example/deal?ref=abc#x" },
        { text: "Call", selector: "#b", href: "tel:+46812345" },
        { text: "Evil", selector: "#c", href: "javascript:alert(1)" },
        { text: "Cat", selector: "#d", href: "/bilforsakring?utm=1" },
      ],
    });
    const ctas = out.ctas as { href?: string }[];
    expect(ctas[0].href).toBe("https://partner.example/deal"); // query/hash gone
    expect(ctas[1].href).toBe("tel:+46812345");
    expect(ctas[2].href).toBeUndefined(); // javascript: dropped
    expect(ctas[3].href).toBe("/bilforsakring"); // relative path kept, query gone
  });

  it("preserves a CTA's rect (size — no PII) so curation can group strips by size", () => {
    const out = sanitizeAudit({
      url: "https://x.se/",
      ctas: [
        { text: "Cat", selector: "#a", rect: { x: 10.4, y: 20.6, w: 291.2, h: 60.8 } },
        { text: "NoRect", selector: "#b" },
      ],
    });
    const ctas = out.ctas as { rect?: { w: number; h: number } }[];
    expect(ctas[0].rect).toEqual({ x: 10, y: 21, w: 291, h: 61 }); // rounded, kept
    expect(ctas[1].rect).toBeUndefined();
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

describe("scrubPath — journey ref/path privacy boundary", () => {
  it("redacts UUIDs, long opaque tokens, emails and long digit runs", () => {
    expect(scrubPath("/reset/9f8b7c6d-1234-4a5b-8c9d-0e1f2a3b4c5d")).toBe("/reset/[id]");
    expect(scrubPath("/reset/tok_ABCdef123GHIjkl456MNO")).toContain("[id]"); // 20+ opaque run
    expect(scrubPath("/order/ref?x=1").replace(/\s+/g, "")).toBe("/order/ref?x=1"); // short, kept
    expect(scrubPath("/account?email=a@b.se")).toBe("/account?email=[redacted]");
    expect(scrubPath("Ring 070-123 45 67")).toContain("[redacted]");
  });

  it("redacts a UUID whole even when a group is all-digits (regression: live-verify leak)", () => {
    // cleanText's LONG_DIGITS eats an all-digit UUID group; UUID redaction must
    // run FIRST or 3 of 5 groups leak. These fixtures have digit-only groups the
    // old letter-tailed fixture never exercised.
    expect(scrubPath("/reset/550e8400-e29b-41d4-a716-446655440000")).toBe("/reset/[id]");
    expect(scrubPath("/u/12345678-1234-1234-1234-123456789012")).toBe("/u/[id]");
    expect(scrubPath("a[href=/o/00000000-0000-4000-8000-000000000000]")).not.toContain("0000");
  });

  it("preserves readable slugs (no false-positive redaction)", () => {
    expect(scrubPath("/blogg/den-ultimata-guiden-till-glutenfri-kladdkaka")).toBe(
      "/blogg/den-ultimata-guiden-till-glutenfri-kladdkaka",
    );
    expect(scrubPath("/produkter/iphone-15-pro")).toBe("/produkter/iphone-15-pro");
    expect(scrubPath("Skapa konto")).toBe("Skapa konto");
  });
});

describe("sanitizeObserve — structural observe-only block", () => {
  it("returns null when there is no observe data", () => {
    expect(sanitizeObserve(null)).toBeNull();
    expect(sanitizeObserve({})).toBeNull();
    expect(sanitizeObserve("nope")).toBeNull();
  });

  it("keeps field TYPES/counts, drops non-standard autocomplete + PII in submit text", () => {
    const out = sanitizeObserve({
      forms: [
        {
          fieldCount: 3,
          fieldTypes: { email: 1, text: 2, "bad key!": 5, veryveryveryveryverylongkeyname123: 1 },
          autocomplete: ["email", "given-name", "evil-freeform-token", "current-password"],
          submitText: "Maila oss på a@b.se nu",
          kind: "newsletter",
          aboveFold: true,
        },
      ],
    })!;
    const f = out.forms[0];
    expect(f.fieldCount).toBe(3);
    expect(f.fieldTypes).toEqual({ email: 1, text: 2 }); // junk keys dropped
    expect(f.autocomplete).toEqual(["email", "given-name", "current-password"]); // off-list dropped
    expect(f.submitText).toBe("Maila oss på [redacted] nu"); // email scrubbed
    expect(f.kind).toBe("newsletter");
  });

  it("normalizes navigation to counts + booleans", () => {
    const out = sanitizeObserve({
      navigation: { primaryLinks: 42.7, footerLinks: "12", hasSearch: 1, hasBreadcrumb: false },
    })!;
    expect(out.navigation).toEqual({
      primaryLinks: 43,
      footerLinks: 0, // non-number → 0
      hasSearch: true,
      hasBreadcrumb: false,
    });
  });

  it("keeps pricing presence + PII-scrubbed samples", () => {
    const out = sanitizeObserve({
      pricing: { present: true, priceCount: 3, samples: ["199 kr", "från 49:-", "ring 070-1234567"] },
    })!;
    expect(out.pricing.present).toBe(true);
    expect(out.pricing.priceCount).toBe(3);
    expect(out.pricing.samples[0]).toBe("199 kr");
    expect(out.pricing.samples[2]).toContain("[redacted]"); // phone scrubbed
  });

  it("caps forms at 10 and rejects a kind that isn't a short token", () => {
    const forms = Array.from({ length: 20 }, () => ({ fieldCount: 1, kind: "<script>" }));
    const out = sanitizeObserve({ forms })!;
    expect(out.forms.length).toBe(10);
    expect(out.forms[0].kind).toBe("other"); // non-token kind rejected
  });
});
