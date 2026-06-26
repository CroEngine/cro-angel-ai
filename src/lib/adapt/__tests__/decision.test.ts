// Proves the decision engine's guarantees:
//   • conservative — no plan for segments at/above baseline;
//   • grounded — no ops it can't back with real inventory (never fabricates);
//   • well-formed — every plan validates against the locked AdaptationPlanSchema.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { SegmentBaseline, SegmentBehavior } from "@/lib/segments/aggregate";
import { AdaptationPlanSchema } from "@/snippet/contract";

import { buildPlan, type InventoryRow, segmentUuid } from "../decision";

const SITE = "00000000-0000-4000-8000-000000000000";
const ID_CTA = "11111111-1111-4111-8111-111111111111";
const ID_HERO = "22222222-2222-4222-8222-222222222222";
const ID_TRUST = "33333333-3333-4333-8333-333333333333";

const baseline: SegmentBaseline = { bounceRate: 0.35, avgScrollPct: 55, avgDurationMs: 12_000 };

// Defaults trigger BOTH rules: bounce +15pts, scroll −25pts vs baseline.
function seg(over: Partial<SegmentBehavior> = {}): SegmentBehavior {
  return {
    source: "social",
    label: "Social",
    sessions: 120,
    visitors: 110,
    share: 0.4,
    bounceRate: 0.5,
    avgScrollPct: 30,
    avgDurationMs: 8_000,
    ...over,
  };
}

const inventory: InventoryRow[] = [
  {
    id: ID_HERO,
    category: "section",
    selector: "#hero",
    text: "Hero",
    sectionKind: "hero",
    aboveFold: true,
    visualWeight: 50,
    top: 0,
  },
  {
    id: ID_CTA,
    category: "cta",
    selector: "#cta",
    text: "Start free trial",
    sectionKind: null,
    aboveFold: true,
    visualWeight: 90,
    top: 200,
  },
  {
    id: ID_TRUST,
    category: "trust",
    selector: "#testimonials",
    text: "Loved by 2,000 teams",
    sectionKind: "testimonial",
    aboveFold: false,
    visualWeight: 40,
    top: 2400,
  },
];

const args = (segment: SegmentBehavior, inv: InventoryRow[] = inventory) => ({
  siteId: SITE,
  segmentId: segmentUuid(SITE, segment.source),
  extractorVersion: "1.6.0",
  segment,
  baseline,
  inventory: inv,
});

describe("buildPlan", () => {
  it("returns null for a segment at/above baseline (don't fix what isn't broken)", () => {
    const healthy = seg({ bounceRate: 0.3, avgScrollPct: 60 });
    expect(buildPlan(args(healthy))).toBeNull();
  });

  it("emphasizes the primary CTA and lifts trust for a skittish, shallow segment", () => {
    const built = buildPlan(args(seg()));
    expect(built).not.toBeNull();

    expect(built!.plan.ops.map((o) => o.op)).toEqual(["emphasizeCta", "moveElement"]);

    const a = built!.plan.ops[0];
    expect(a.op).toBe("emphasizeCta");
    if (a.op === "emphasizeCta") {
      expect(a.selector).toBe("#cta");
      expect(a.inventoryId).toBe(ID_CTA);
      expect(a.style).toBe("emphasize"); // CTA is above the fold ⇒ emphasize, not sticky
    }

    const b = built!.plan.ops[1];
    expect(b.op).toBe("moveElement");
    if (b.op === "moveElement") {
      expect(b.selector).toBe("#testimonials");
      expect(b.position).toBe("after");
      expect(b.anchorSelector).toBe("#hero");
    }

    expect(built!.rationale).toHaveLength(2);
    expect(() => AdaptationPlanSchema.parse(built!.plan)).not.toThrow();
  });

  it("pins a below-the-fold CTA (sticky) for shallow scrollers", () => {
    const shallowOnly = seg({ bounceRate: 0.35, avgScrollPct: 30 }); // not skittish, just shallow
    const inv: InventoryRow[] = [
      { ...inventory[0] },
      { ...inventory[1], aboveFold: false }, // CTA below the fold
    ];
    const built = buildPlan(args(shallowOnly, inv));
    expect(built!.plan.ops).toHaveLength(1); // not skittish ⇒ no trust move
    const a = built!.plan.ops[0];
    if (a.op === "emphasizeCta") expect(a.style).toBe("sticky");
  });

  it("never fabricates: triggers but no usable inventory ⇒ null", () => {
    const built = buildPlan(args(seg(), [inventory[0]])); // only a hero section, no CTA, no trust
    expect(built).toBeNull();
  });

  it("segmentUuid is deterministic, distinct per source, and a valid UUID", () => {
    const a = segmentUuid(SITE, "social");
    expect(segmentUuid(SITE, "social")).toBe(a);
    expect(segmentUuid(SITE, "paid")).not.toBe(a);
    expect(z.string().uuid().safeParse(a).success).toBe(true);
  });
});
