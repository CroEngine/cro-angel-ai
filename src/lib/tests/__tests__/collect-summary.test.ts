// Pins summarizeCollected's arithmetic (CRO-planen steg 1). The summary block
// was lifted verbatim from engine.server.ts so the offline replay harness
// produces a byte-identical summary; this locks the numbers — especially the
// ones that used to be silently null offline (competingAboveFold,
// primaryConversionCtaCount, aboveFold) — against future drift.
//
// The fixtures are RAW (pre-filter) COLLECT_SCRIPT-shaped elements: the
// summarizer filters + groups internally, exactly as both call sites now feed it.

import { describe, it, expect } from "vitest";

import { summarizeCollected, filterCollected } from "../collect-summary";
import type {
  CollectedElement,
  ElementCategory,
  ElementIntent,
  SectionKind,
  ViewportZone,
} from "../schema";

interface Over {
  text?: string;
  tagName?: string;
  category?: ElementCategory;
  intent?: ElementIntent;
  section?: SectionKind;
  zone?: ViewportZone;
  score?: number;
  w?: number;
  h?: number;
}

function mk(o: Over = {}): CollectedElement {
  const w = o.w ?? 120;
  const h = o.h ?? 40;
  return {
    text: o.text ?? "Button",
    tagName: o.tagName ?? "a",
    selector: `sel-${o.text ?? "x"}-${Math.round(w)}x${Math.round(h)}`,
    category: o.category ?? "link",
    intent: o.intent ?? "information",
    section: o.section ?? "content",
    href: null,
    disabled: false,
    visible: true,
    aboveFold: (o.zone ?? "mid_page") === "above_fold",
    rect: { x: 0, y: 0, w, h },
    position: { viewportZone: o.zone ?? "mid_page", yPercent: 0, xPercent: 0 },
    visualWeight: {
      area: w * h,
      fontSize: 16,
      fontWeight: 400,
      backgroundContrast: 1,
      score: o.score ?? 10,
    },
    attributes: {},
    computedStyles: {
      color: "#000",
      backgroundColor: "#fff",
      fontSize: "16px",
      fontWeight: "400",
      padding: "0",
      borderRadius: "0",
      border: "none",
      cursor: "pointer",
      display: "block",
    },
  };
}

describe("summarizeCollected — the CRO summary aggregate (steg 1)", () => {
  it("computes competing/primary/aboveFold and dedupes repeated controls", () => {
    const raw: CollectedElement[] = [
      mk({
        text: "Get demo",
        category: "cta_primary",
        intent: "conversion",
        section: "hero",
        zone: "above_fold",
        score: 100,
      }),
      mk({
        text: "Contact sales",
        category: "cta_secondary",
        intent: "conversion",
        section: "hero",
        zone: "above_fold",
        score: 80,
      }),
      mk({
        text: "Submit",
        category: "form_submit",
        intent: "conversion",
        section: "hero",
        zone: "below_fold",
        score: 50,
      }),
      // three identical nav controls -> one group, two groupedAway
      mk({
        text: "Home",
        category: "nav_item",
        intent: "navigation",
        section: "nav",
        zone: "above_fold",
        score: 10,
        w: 60,
        h: 20,
      }),
      mk({
        text: "Home",
        category: "nav_item",
        intent: "navigation",
        section: "nav",
        zone: "above_fold",
        score: 10,
        w: 60,
        h: 20,
      }),
      mk({
        text: "Home",
        category: "nav_item",
        intent: "navigation",
        section: "nav",
        zone: "above_fold",
        score: 10,
        w: 60,
        h: 20,
      }),
      mk({
        text: "Learn more",
        category: "link",
        intent: "information",
        section: "content",
        zone: "mid_page",
        score: 30,
      }),
    ];

    const r = summarizeCollected(raw, "clickables");

    // Elements are never dropped for "clickables"; only marked.
    expect(r.totalCount).toBe(7);
    // unique = 7 minus the 2 grouped-away nav dupes
    expect(r.count).toBe(5);
    expect(r.summary.total).toBe(5);

    // The B8 competing reservation: two above-fold conversion CTAs, minus one
    // slot reserved for the primary -> 1 competing. This was silently null offline.
    expect(r.summary.primaryConversionCtaCount).toBe(1);
    expect(r.summary.conversionCtasAboveFold).toBe(2);
    expect(r.summary.competingAboveFold).toBe(1);

    // above-fold count excludes the two grouped-away dupes (e1, e2, one nav)
    expect(r.summary.aboveFold).toBe(3);

    // byCategory / intent / section over non-grouped elements only
    expect(r.byCategory).toEqual({
      cta_primary: 1,
      cta_secondary: 1,
      form_submit: 1,
      nav_item: 1,
      link: 1,
    });
    expect(r.summary.intentBreakdown).toEqual({ conversion: 3, navigation: 1, information: 1 });
    expect(r.summary.bySection).toEqual({ hero: 3, nav: 1, content: 1 });

    // exactly one repeated group, the nav triple
    expect(r.summary.groups).toHaveLength(1);
    expect(r.summary.groups?.[0]).toMatchObject({ label: "Home", count: 3, category: "nav_item" });

    // grouping marks the 2nd and 3rd nav dupes in place
    const navMarked = r.filtered.filter((e) => e.text === "Home" && e.groupedAway).length;
    expect(navMarked).toBe(2);

    // topVisualWeight: sorted desc, grouped-away excluded, capped at 5
    expect(r.summary.topVisualWeight.map((t) => t.text)).toEqual([
      "Get demo",
      "Contact sales",
      "Submit",
      "Learn more",
      "Home",
    ]);
  });

  it("empty input yields an empty, non-null summary (never fabricates)", () => {
    const r = summarizeCollected([], "clickables");
    expect(r.count).toBe(0);
    expect(r.summary.total).toBe(0);
    expect(r.summary.competingAboveFold).toBe(0);
    expect(r.summary.primaryConversionCtaCount).toBe(0);
    expect(r.summary.aboveFold).toBe(0);
    expect(r.byCategory).toEqual({});
    expect(r.summary.groups).toEqual([]);
    expect(r.summary.topVisualWeight).toEqual([]);
  });

  it("caps topVisualWeight at 5 by descending score", () => {
    const raw = Array.from({ length: 8 }, (_, i) =>
      mk({ text: `b${i}`, score: i * 10, w: 100 + i, h: 40 + i }),
    );
    const r = summarizeCollected(raw, "clickables");
    expect(r.summary.topVisualWeight).toHaveLength(5);
    expect(r.summary.topVisualWeight.map((t) => t.text)).toEqual(["b7", "b6", "b5", "b4", "b3"]);
  });

  it('filterCollected("buttons") keeps only real buttons; "clickables" is passthrough', () => {
    const raw = [
      mk({ text: "a", tagName: "a" }),
      mk({ text: "btn", tagName: "button" }),
      mk({ text: "submit", tagName: "input[type=submit]" }),
    ];
    expect(filterCollected(raw, "clickables")).toHaveLength(3);
    expect(filterCollected(raw, "buttons").map((e) => e.text)).toEqual(["btn", "submit"]);
  });
});
