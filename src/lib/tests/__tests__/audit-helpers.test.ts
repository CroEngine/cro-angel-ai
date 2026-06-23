// deriveHero — no-<h1> hero detection (extractor v1.4.0).
//
// Pure-function coverage for the v1.4.0 fixes, locked in here rather than
// against live captures (homepages drift — warby-parker grew an <h1>, glossier's
// campaign copy rotates — so a frozen capture is a poor regression anchor):
//   (a) displayHeading fallback for a hero with no semantic heading
//   (b) excluding off-canvas chrome (aside/nav/footer) so an overlay's label
//       isn't taken as the hero when there's no <h1> to anchor on
//   (c) synthesizing a hero from the page h1 when no section anchors to it,
//       with no false hero when there's no meaningful h1.

import { describe, it, expect } from "vitest";

import { deriveHero } from "../audit-helpers";
import type { PageSection } from "../schema";

function mkSection(
  p: Partial<PageSection> & { id: string; type: PageSection["type"] },
): PageSection {
  return {
    position: 1,
    heading: "",
    rect: { y: 0, w: 1000, h: 400 },
    aboveFold: true,
    visualWeight: 50,
    elementCount: 10,
    childCount: 3,
    containsPrimaryCTA: false,
    containsTrustSignals: false,
    containsForm: false,
    containsPricing: false,
    containsNavigation: false,
    ...p,
  };
}

describe("deriveHero — no-h1 hero detection (v1.4.0)", () => {
  it("uses displayHeading when the hero section has no semantic heading", () => {
    // Styled-<div> hero: classified hero by position, but heading === "".
    const sections = [
      mkSection({
        id: "section_1",
        type: "hero",
        heading: "",
        displayHeading: "SEE SUMMER BETTER",
      }),
    ];
    expect(deriveHero(sections, [], [])?.headline).toBe("SEE SUMMER BETTER");
  });

  it("prefers a real semantic heading over displayHeading when both exist", () => {
    const sections = [
      mkSection({
        id: "section_1",
        type: "hero",
        heading: "Real Headline",
        displayHeading: "ignored",
      }),
    ];
    expect(deriveHero(sections, [], [])?.headline).toBe("Real Headline");
  });

  it("excludes an off-canvas aside drawer so the real hero wins (glossier case)", () => {
    // No <h1>. An above-fold cart drawer (aside + CTA + a 2-word non-blocklisted
    // heading "Edit item") precedes the real hero form. Must pick the form.
    const sections = [
      mkSection({ id: "section_2", type: "aside", heading: "Edit item", containsPrimaryCTA: true }),
      mkSection({
        id: "section_6",
        type: "form",
        heading: "You smell like vacation",
        containsPrimaryCTA: true,
        visualWeight: 100,
      }),
    ];
    const hero = deriveHero(sections, [], []);
    expect(hero?.headline).toBe("You smell like vacation");
    expect(hero?.sectionId).toBe("section_6");
  });

  it("does not take a nav/footer as the hero even with a CTA", () => {
    const sections = [
      mkSection({ id: "section_1", type: "nav", heading: "Main Menu", containsPrimaryCTA: true }),
      mkSection({ id: "section_2", type: "hero", heading: "", displayHeading: "Big Promise" }),
    ];
    expect(deriveHero(sections, [], [])?.headline).toBe("Big Promise");
  });

  it("synthesizes a hero from the h1 when no section anchors to it (warby-parker case)", () => {
    // Landmark-less SPA: the walker produced only a nav section (no heading), but
    // the page has a valid h1. deriveHero must still surface a hero from the h1.
    const sections = [
      mkSection({ id: "section_1", type: "nav", heading: "", containsPrimaryCTA: false }),
    ];
    const hero = deriveHero(sections, [], ["A new level of lightweight"]);
    expect(hero?.headline).toBe("A new level of lightweight");
    expect(hero?.sectionId).toBe("");
  });

  it("returns undefined when no section anchors AND there is no meaningful h1 (no false hero)", () => {
    const sections = [mkSection({ id: "section_1", type: "nav", heading: "" })];
    expect(deriveHero(sections, [], [])).toBeUndefined();
    // a label-ish single-word h1 is not a headline → still undefined
    expect(deriveHero(sections, [], ["Menu"])).toBeUndefined();
  });

  it("still anchors on the page <h1> first — order/type independent (corpus unchanged)", () => {
    // An aside precedes the content section carrying the h1. The h1-anchor finder
    // must win regardless, so hubspot/linear-style pages are unaffected.
    const sections = [
      mkSection({
        id: "section_1",
        type: "aside",
        heading: "Shopping Bag",
        containsPrimaryCTA: true,
      }),
      mkSection({ id: "section_3", type: "content", heading: "Grow better with HubSpot" }),
    ];
    const hero = deriveHero(sections, [], ["Grow better with HubSpot"]);
    expect(hero?.headline).toBe("Grow better with HubSpot");
    expect(hero?.sectionId).toBe("section_3");
  });
});
