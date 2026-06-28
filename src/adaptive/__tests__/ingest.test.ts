import { describe, it, expect } from "vitest";

import { ingestAudit } from "../ingest.server";
import type { PageAuditData } from "@/lib/tests/schema";

// A small but realistic crawler audit (full shape, with selectors).
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

describe("ingestAudit", () => {
  it("maps a crawler audit to inventory items and is best-effort about persistence", async () => {
    const res = await ingestAudit("acme", audit, { domain: "acme.com" });

    // Mapping always runs, independent of the DB.
    expect(res.site).toBe("acme");
    expect(res.items).toBeGreaterThan(0);

    // No service-role key in the test env → persistence/registration no-op,
    // but the call resolves cleanly instead of throwing.
    expect(typeof res.saved).toBe("number");
    expect(typeof res.registered).toBe("boolean");
    expect(res.saved).toBeLessThanOrEqual(res.items);
  });

  it("never throws on an empty audit", async () => {
    const res = await ingestAudit("blank", {});
    expect(res.site).toBe("blank");
    expect(res.items).toBe(0);
    expect(res.saved).toBe(0);
  });
});
