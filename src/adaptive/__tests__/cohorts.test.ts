// Kohortbryggan (E4b-kopplingen): servern härleder SAMMA vokabulär som
// klientmotorn (adaptive-lab/profile deriveCohorts) ur VisitorContext, och
// decide kan grinda mönster på den med OCH-semantik.
import { describe, expect, it } from "vitest";

import { buildVisitorContext, cohortsForVisitor, cohortsSatisfied } from "../context";

const server = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120",
  acceptLanguage: "sv-SE,sv;q=0.9",
  referrer: "",
  country: "SE",
};
const client = (over: Record<string, unknown> = {}) => ({
  url: "https://acme.se/",
  referrer: "",
  screenWidth: 1440,
  hourOfDay: 10,
  ...over,
});

describe("cohortsForVisitor", () => {
  it("linkedin arrival → ch:social + src:linkedin, first visit → ret:new", () => {
    const ctx = buildVisitorContext(server, client({ utmSource: "linkedin" }) as never);
    expect(cohortsForVisitor(ctx)).toEqual(["ch:social", "src:linkedin", "ret:new"]);
  });
  it("organic google → ch:search + src:google; ads split off as ch:ads", () => {
    const ctx = buildVisitorContext(server, client({ utmSource: "google" }) as never);
    expect(cohortsForVisitor(ctx)).toContain("ch:search");
    expect(cohortsForVisitor(ctx)).toContain("src:google");
    const ads = buildVisitorContext(
      server,
      client({ utmSource: "google", utmMedium: "cpc" }) as never,
    );
    expect(cohortsForVisitor(ads)).toContain("ch:ads");
  });
  it("direct first-timer is just ch:direct + ret:new — no redundant src:", () => {
    const ctx = buildVisitorContext(server, client() as never);
    expect(cohortsForVisitor(ctx)).toEqual(["ch:direct", "ret:new"]);
  });
  it("returning pricing-viewer gets ret:2plus + seen:pricing (the price_hesitant keys)", () => {
    const ctx = buildVisitorContext(
      server,
      client({ visitCount: 3, viewedPricing: true }) as never,
    );
    const c = cohortsForVisitor(ctx);
    expect(c).toContain("ret:2plus");
    expect(c).toContain("seen:pricing");
  });
});

describe("cohortsSatisfied — samma OCH-semantik som labbets ruleMatches", () => {
  it("kräver ALLA nycklar; tomt krav matchar alla", () => {
    const have = ["ch:social", "src:linkedin", "ret:new"];
    expect(cohortsSatisfied(["src:linkedin"], have)).toBe(true);
    expect(cohortsSatisfied(["src:linkedin", "ret:2plus"], have)).toBe(false);
    expect(cohortsSatisfied([], have)).toBe(true);
  });
});
