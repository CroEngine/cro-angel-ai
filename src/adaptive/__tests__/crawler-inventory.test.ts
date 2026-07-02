import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import {
  classifyCtaIntent,
  ctaScore,
  curateCtas,
  extractMicrocopy,
  isChromeText,
  isReusableCta,
  looksConcatenated,
  mapAuditToInventory,
  mapGoldenToInventory,
} from "../crawler-inventory";
import type { PageAuditData } from "@/lib/tests/schema";

// Real captured HubSpot snapshot — loaded at runtime (it lives outside src/).
const hubspotGolden: unknown = JSON.parse(readFileSync("corpus/hubspot/golden.json", "utf8"));

describe("classifyCtaIntent", () => {
  it("maps published CTA labels to engine intents", () => {
    expect(classifyCtaIntent("Book a demo")).toBe("demo");
    expect(classifyCtaIntent("Get a demo of HubSpot's software")).toBe("demo");
    expect(classifyCtaIntent("Start Free Trial")).toBe("trial");
    expect(classifyCtaIntent("Get started free")).toBe("trial");
    expect(classifyCtaIntent("Contact Sales")).toBe("sales");
    expect(classifyCtaIntent("Talk to an expert")).toBe("sales");
  });
});

describe("extractMicrocopy", () => {
  it("recovers published reassurance phrases by kind", () => {
    const items = extractMicrocopy([
      "No credit card required",
      "Get set up in 2 minutes",
      "Cancel anytime",
      "Some unrelated copy",
    ]);
    const kinds = items.map((i) => i.meta?.kind);
    expect(kinds).toContain("no_credit_card");
    expect(kinds).toContain("guarantee");
    // text is the actual published string, never invented
    expect(items.find((i) => i.meta?.kind === "no_credit_card")?.text).toBe(
      "No credit card required",
    );
  });
});

describe("curation — drop page chrome, keep real CTAs", () => {
  it("flags chrome text (cookie / rating / nav / numbers) and spares real CTAs", () => {
    // real glutenforum junk that leaked into the CTA slot
    for (const junk of [
      "Acceptera alla",
      "Endast nödvändiga",
      "1 stjärnor",
      "5 stjärnor",
      "0",
      "2",
      "Öppna meny",
      "Logga in",
      "Läs mer",
      "Mer information & öppettider",
    ]) {
      expect(isChromeText(junk)).toBe(true);
    }
    for (const real of ["Skapa konto", "Book a demo", "Start Free Trial", "Get started free"]) {
      expect(isChromeText(real)).toBe(false);
    }
  });

  it("drops bare social links and listing sort/filter controls", () => {
    for (const chrome of [
      "Instagram",
      "Facebook",
      "Populärt",
      "Flest röster",
      "Genom tiderna",
      "Senaste",
      "Trending",
      "Sortera",
      "Visa alla",
      "Mest lästa",
    ]) {
      expect(isChromeText(chrome)).toBe(true);
    }
    // a real engagement CTA that merely mentions a platform is kept
    expect(isChromeText("Follow us on Instagram")).toBe(false);
    expect(isChromeText("Kommentera")).toBe(false);
  });

  it("drops nav / footer / icon-button CTAs, keeps genuine ones", () => {
    expect(isReusableCta({ text: "Sign up", section: "hero", category: "cta_primary" })).toBe(true);
    expect(isReusableCta({ text: "Home", section: "nav", category: "nav_item" })).toBe(false);
    expect(isReusableCta({ text: "Privacy", section: "footer", category: "link" })).toBe(false);
    expect(isReusableCta({ text: "☰", section: "header", category: "icon_button" })).toBe(false);
    expect(isReusableCta({ text: "Acceptera alla", section: "content", category: "cta_primary" })).toBe(false);
  });

  it("detects scraped-together card titles, spares clean copy and brand names", () => {
    expect(looksConcatenated("Toppen-produkt.Forum")).toBe(true);
    expect(looksConcatenated("Kraftig reaktion på gluten, varför?Forum")).toBe(true);
    expect(looksConcatenated("Sveriges största samlingsplats för allt om glutenfritt")).toBe(false);
    expect(looksConcatenated("Dela med dig!")).toBe(false);
    expect(looksConcatenated("YouTube")).toBe(false);
    expect(looksConcatenated("iPhone 15 Pro")).toBe(false);
  });

  it("strips a bleeding section heading but keeps the section as a target", () => {
    const inv = mapAuditToInventory(
      {
        url: "https://forum.example/",
        sections: [
          {
            id: "h",
            type: "hero",
            position: 0,
            heading: "Dazzley kladdkaka! Toppen-produkt.Forum",
            selector: "#hero",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rect: { y: 0, w: 0, h: 0 } as any,
            aboveFold: true,
            visualWeight: 50,
            elementCount: 3,
            childCount: 3,
            containsPrimaryCTA: false,
            containsTrustSignals: false,
            containsForm: false,
            containsPricing: false,
            containsNavigation: false,
          },
        ],
      },
      "forum",
    );
    const hero = inv.slots.hero?.[0];
    expect(hero?.selector).toBe("#hero"); // still targetable
    expect(hero?.text).toBeUndefined(); // but the junk heading is not reused
  });

  it("bounds CTAs to the most prominent MAX_CTAS (language-agnostic)", () => {
    // 14 reusable CTAs of varying prominence — none matches a chrome wordlist,
    // and each a different width so they don't read as one uniform strip.
    const ctas = Array.from({ length: 14 }, (_, i) =>
      mkCta(`Action ${i}`, "content", i < 3 ? "cta_primary" : "cta_secondary", 60 + i * 7, 40),
    );
    // make the first three clearly most prominent
    ctas[0].visualWeight = 95;
    ctas[1].visualWeight = 90;
    ctas[2].visualWeight = 85;
    const inv = mapAuditToInventory({ url: "https://x/", ctas }, "x");
    const kept = inv.slots.cta ?? [];
    expect(kept.length).toBeLessThanOrEqual(8);
    const texts = kept.map((c) => c.text);
    // the three high-weight primaries survive the top-K cut
    expect(texts).toContain("Action 0");
    expect(texts).toContain("Action 1");
    expect(texts).toContain("Action 2");
  });

  it("dedupes repeated CTA labels and drops over-long banner blobs", () => {
    const inv = mapAuditToInventory(
      {
        url: "https://x/",
        ctas: [
          mkCta("Read the customer story", "content", "cta_primary"),
          mkCta("Read the customer story", "content", "cta_primary"), // dup, other selector
          mkCta("Read the customer story", "content", "cta_primary"), // dup
          mkCta("DESCUENTAZOS EN BEBIDAS ¡HASTA 40% OFF! Ver ofertas", "content", "cta_primary"),
          mkCta("Sign up", "hero", "cta_primary"),
        ],
      },
      "x",
    );
    const texts = (inv.slots.cta ?? []).map((c) => c.text);
    expect(texts.filter((t) => t === "Read the customer story").length).toBe(1); // deduped
    expect(texts.some((t) => (t ?? "").startsWith("DESCUENTAZOS"))).toBe(false); // banner dropped
    expect(texts).toContain("Sign up");
  });

  it("collapses a uniform nav/category strip to its most prominent member", () => {
    // 5 same-size, short-label CTAs in one section = a nav/category/logo strip.
    const strip = ["Women", "Men", "Kids", "Baby", "Sale"].map((t) =>
      mkCta(t, "content", "cta_primary", 80, 30),
    );
    strip[0].visualWeight = 50; // "Women" the most prominent of the strip
    const distinct = mkCta("Sign up now", "hero", "cta_primary", 160, 48);
    const inv = mapAuditToInventory({ url: "https://x/", ctas: [...strip, distinct] }, "x");
    const texts = (inv.slots.cta ?? []).map((c) => c.text);
    expect(texts).toContain("Sign up now"); // the distinct CTA survives
    const stripKept = ["Women", "Men", "Kids", "Baby", "Sale"].filter((t) => texts.includes(t));
    expect(stripKept.length).toBe(1); // only one of the strip remains
  });

  it("curateCtas runs the whole pipeline (filter → collapse → dedup → cap) and orders by prominence", () => {
    const out = curateCtas([
      mkCta("Acceptera alla", "content", "cta_primary"), // chrome → dropped
      mkCta("Read the customer story", "content", "cta_primary"), // dup
      mkCta("Read the customer story", "content", "cta_primary"), // dup → collapsed
      mkCta("A very very very long promotional banner label here", "content", "cta_primary"), // banner → dropped
      Object.assign(mkCta("Book a demo", "hero", "cta_primary", 180, 52), { visualWeight: 99 }),
    ]);
    const texts = out.map((c) => c.text);
    expect(texts).not.toContain("Acceptera alla");
    expect(texts.filter((t) => t === "Read the customer story").length).toBe(1);
    expect(texts.some((t) => t.startsWith("A very very"))).toBe(false);
    expect(texts[0]).toBe("Book a demo"); // highest prominence first
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it("ctaScore ranks a prominent primary above a faint secondary", () => {
    const primary = ctaScore({ visualWeight: 80, aboveFold: true, category: "cta_primary", intent: "conversion" });
    const faint = ctaScore({ visualWeight: 10, aboveFold: false, category: "cta_secondary", competingActions: 20 });
    expect(primary).toBeGreaterThan(faint);
  });

  it("mapAuditToInventory keeps only reusable CTAs from a noisy page", () => {
    const noisy = mapAuditToInventory(
      {
        url: "https://forum.example/",
        ctas: [
          mkCta("Skapa konto", "content", "cta_primary"),
          mkCta("Acceptera alla", "content", "cta_primary"),
          mkCta("1 stjärnor", "cards", "cta_primary"),
          mkCta("Öppna meny", "nav", "nav_item"),
          mkCta("Logga in", "header", "cta_secondary"),
        ],
      },
      "forum",
    );
    const texts = (noisy.slots.cta ?? []).map((c) => c.text);
    expect(texts).toContain("Skapa konto");
    expect(texts).not.toContain("Acceptera alla");
    expect(texts).not.toContain("1 stjärnor");
    expect(texts).not.toContain("Öppna meny");
    expect(texts).not.toContain("Logga in");
  });
});

function mkCta(
  text: string,
  section: string,
  category: string,
  w = 100,
  h = 40,
): PageAuditData["ctas"][number] {
  return {
    text,
    intent: "conversion",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    category: category as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    section: section as any,
    aboveFold: true,
    visualWeight: 40,
    competingActions: 1,
    nearestTrustSignalDistance: 0,
    nearestFormDistance: 0,
    contrastRatio: 5,
    wcagLevel: "AA",
    selector: `#${text.replace(/\s+/g, "-")}`,
    rect: { x: 0, y: 0, w, h },
  };
}

describe("mapGoldenToInventory — real HubSpot corpus", () => {
  const inv = mapGoldenToInventory(hubspotGolden, "hubspot");

  it("recovers CTA labels from the captured page with engine intents", () => {
    const ctas = inv.slots.cta ?? [];
    expect(ctas.length).toBeGreaterThan(0);
    const texts = ctas.map((c) => c.text);
    // A real captured demo CTA is present and classified as demo intent.
    expect(texts.some((t) => /demo/i.test(t ?? ""))).toBe(true);
    expect(ctas.find((c) => /get a demo/i.test(c.text ?? ""))?.meta?.intent).toBe("demo");
    expect(ctas.some((c) => c.meta?.intent === "trial")).toBe(true);
  });

  it("recovers the captured headline", () => {
    const headlines = (inv.slots.headline ?? []).map((h) => h.text);
    expect(headlines.some((h) => /go-to-market teams/i.test(h ?? ""))).toBe(true);
  });

  it("records trust + section slots found on the page (presence)", () => {
    expect(inv.slots.testimonial?.length).toBeGreaterThan(0);
    expect(inv.slots.customer_logos?.length).toBeGreaterThan(0);
    expect(inv.slots.hero?.length).toBeGreaterThan(0);
  });
});

describe("mapAuditToInventory — full crawler output keeps selectors", () => {
  const audit: Partial<PageAuditData> = {
    url: "https://acme.com/",
    headings: { h1Count: 1, h2Count: 0, h3Count: 0, h1Texts: ["Grow faster with Acme"] },
    hero: {
      headline: "Grow faster with Acme",
      subheadline: "",
      primaryCtaText: "Book a demo",
      primaryCtaIntent: "conversion",
      sectionId: "s1",
      aboveFold: true,
    },
    ctas: [
      {
        text: "Start Free Trial",
        intent: "conversion",
        category: "cta_primary",
        section: "hero",
        aboveFold: true,
        visualWeight: 80,
        competingActions: 1,
        nearestTrustSignalDistance: 0,
        nearestFormDistance: 0,
        contrastRatio: 5,
        wcagLevel: "AA",
        selector: "#hero .cta",
        rect: { x: 0, y: 0, w: 100, h: 40 },
      },
    ],
    trustSignals: [
      {
        type: "customer_logos",
        text: "Trusted by Spotify, Volvo",
        section: "hero",
        aboveFold: true,
        visualWeight: 30,
        source: "img_alt",
        selector: "#logos",
        logoCount: 5,
      },
      {
        type: "guarantee",
        text: "30-day money-back guarantee",
        section: "footer",
        aboveFold: false,
        visualWeight: 10,
        source: "text",
        selector: "#guarantee",
      },
    ],
    sections: [
      {
        id: "faq1",
        type: "faq",
        position: 5,
        heading: "FAQ",
        selector: "#faq",
        rect: { y: 0, w: 0, h: 0 },
        aboveFold: false,
        visualWeight: 20,
        elementCount: 3,
        childCount: 3,
        containsPrimaryCTA: false,
        containsTrustSignals: false,
        containsForm: false,
        containsPricing: false,
        containsNavigation: false,
      },
    ],
  };

  const inv = mapAuditToInventory(audit, "acme");

  it("keeps selectors so the snippet can target real DOM", () => {
    expect(inv.slots.cta?.find((c) => c.text === "Start Free Trial")?.selector).toBe("#hero .cta");
    expect(inv.slots.customer_logos?.[0]?.selector).toBe("#logos");
    expect(inv.slots.guarantee?.[0]?.selector).toBe("#guarantee");
    expect(inv.slots.faq?.[0]?.selector).toBe("#faq");
  });

  it("classifies CTA intents and extracts the guarantee microcopy", () => {
    expect(inv.slots.cta?.find((c) => c.text === "Book a demo")?.meta?.intent).toBe("demo");
    expect(inv.slots.cta?.find((c) => c.text === "Start Free Trial")?.meta?.intent).toBe("trial");
    expect((inv.slots.microcopy ?? []).some((m) => m.meta?.kind === "guarantee")).toBe(true);
  });

  it("an empty audit yields an empty-but-valid inventory (never throws/invents)", () => {
    const empty = mapAuditToInventory({}, "blank");
    expect(empty.site).toBe("blank");
    expect(Object.keys(empty.slots).length).toBe(0);
  });
});
