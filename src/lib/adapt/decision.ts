// The decision engine (M4b). Pure, deterministic, no I/O: given one segment's
// measured behavior (vs the site baseline) and the content inventory, it emits a
// small, explainable AdaptationPlan of SAFE ops — or null when nothing is clearly
// worth doing.
//
// Principles, enforced structurally:
//   • Conservative — only acts when a segment measurably UNDERPERFORMS the baseline
//     (don't "fix" what isn't broken; honor "learn before adapting").
//   • Grounded — every op points at a real inventory row's selector/id. Nothing is
//     invented; the rules can only rearrange/emphasize what the crawl proved exists.
//   • Bounded + explainable — at most a few ops, each with a plain-language rationale
//     derived from the same numbers the dashboard shows.

import type { SegmentBaseline, SegmentBehavior } from "@/lib/segments/aggregate";
import type { AdaptationOp, AdaptationPlan } from "@/snippet/contract";

// A flattened inventory row as the engine reasons about it (resolved from
// content_inventory in the serving path).
export interface InventoryRow {
  id: string; // content_inventory.id (uuid) → AdaptationOp inventoryId
  category: string; // cta | trust | section | nav
  selector: string;
  text: string | null;
  sectionKind: string | null;
  aboveFold: boolean | null;
  visualWeight: number | null;
  top: number | null; // rect.top px, for ordering/anchoring when known
}

// A content_inventory row as Supabase returns it (snake_case, freeform rect Json).
export interface RawInventoryRow {
  id: string;
  category: string;
  selector: string;
  text: string | null;
  section_kind: string | null;
  above_fold: boolean | null;
  visual_weight: number | null;
  rect: unknown;
}

// Map DB rows → the engine's InventoryRow shape. Shared by every caller so the
// flattening lives in one place.
export function toInventoryRows(rows: RawInventoryRow[]): InventoryRow[] {
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    selector: r.selector,
    text: r.text,
    sectionKind: r.section_kind,
    aboveFold: r.above_fold,
    visualWeight: r.visual_weight,
    top: rectTop(r.rect),
  }));
}

// content_inventory.rect is freeform Json from the extractor; read a numeric top
// for ordering/anchoring, tolerating shape drift.
export function rectTop(rect: unknown): number | null {
  if (rect && typeof rect === "object" && !Array.isArray(rect)) {
    const r = rect as Record<string, unknown>;
    if (typeof r.top === "number") return r.top;
    if (typeof r.y === "number") return r.y;
  }
  return null;
}

export interface BuiltPlan {
  plan: AdaptationPlan;
  content: Record<string, never>; // v1 rules use selector-based ops; no content to resolve
  rationale: string[]; // why each op was chosen — surfaced to the owner, never to visitors
}

// Trigger thresholds — a segment must be off baseline by at least this much before
// the engine acts. Looser than the dashboard's *observation* gates on purpose:
// observing is free, adapting should clear a real bar but still fire on clear signal.
const BOUNCE_TRIGGER = 0.12; // 12pts worse bounce than baseline
const SCROLL_TRIGGER = 12; // 12pts shallower average scroll than baseline
const MAX_OPS = 3;

const TRUST_SECTION = /testimonial|review|trust|logo|rating|guarantee|press|customer/i;

function truncate(s: string | null, n = 40): string {
  if (!s) return "";
  const t = s.trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export function buildPlan(args: {
  siteId: string;
  segmentId: string;
  extractorVersion: string;
  segment: SegmentBehavior;
  baseline: SegmentBaseline;
  inventory: InventoryRow[];
}): BuiltPlan | null {
  const { segment, baseline, inventory } = args;
  const ops: AdaptationOp[] = [];
  const rationale: string[] = [];

  const bounceDelta =
    segment.bounceRate != null && baseline.bounceRate != null
      ? segment.bounceRate - baseline.bounceRate
      : null;
  const scrollDelta =
    segment.avgScrollPct != null && baseline.avgScrollPct != null
      ? segment.avgScrollPct - baseline.avgScrollPct
      : null;

  const skittish = bounceDelta != null && bounceDelta >= BOUNCE_TRIGGER;
  const shallow = scrollDelta != null && scrollDelta <= -SCROLL_TRIGGER;
  if (!skittish && !shallow) return null; // segment is at/above baseline — leave it be

  // Primary CTA = the heaviest call-to-action the crawl found.
  const primaryCta = inventory
    .filter((r) => r.category === "cta")
    .sort((a, b) => (b.visualWeight ?? 0) - (a.visualWeight ?? 0))[0];

  // Rule A — make the primary action impossible to miss for visitors who don't
  // engage. Pin it (sticky) when shallow scrollers would otherwise never reach it.
  if (primaryCta) {
    const style: "emphasize" | "sticky" =
      shallow && primaryCta.aboveFold === false ? "sticky" : "emphasize";
    ops.push({
      op: "emphasizeCta",
      selector: primaryCta.selector,
      inventoryId: primaryCta.id,
      style,
    });
    const why = shallow
      ? `scroll ${Math.round(Math.abs(scrollDelta!))}pts below average`
      : `bounce ${Math.round(bounceDelta! * 100)}pts above average`;
    rationale.push(
      `${segment.label}: ${why} → ${style === "sticky" ? "pin" : "emphasize"} the primary CTA${primaryCta.text ? ` “${truncate(primaryCta.text)}”` : ""}.`,
    );
  }

  // Rule B — skittish segments leave before the social proof. If trust content sits
  // below the fold and there's an above-fold anchor, lift it up under the hero.
  if (skittish) {
    const trustBelow = inventory
      .filter(
        (r) =>
          (r.category === "trust" ||
            (r.category === "section" && TRUST_SECTION.test(r.sectionKind ?? ""))) &&
          r.aboveFold === false,
      )
      .sort((a, b) => (a.top ?? Infinity) - (b.top ?? Infinity))[0];

    const anchor = inventory
      .filter((r) => r.category === "section" && r.aboveFold !== false)
      .sort((a, b) => (a.top ?? 0) - (b.top ?? 0))[0];

    if (trustBelow && anchor && trustBelow.selector !== anchor.selector) {
      ops.push({
        op: "moveElement",
        selector: trustBelow.selector,
        inventoryId: trustBelow.id,
        position: "after",
        anchorSelector: anchor.selector,
      });
      rationale.push(
        `${segment.label}: bounces ${Math.round(bounceDelta! * 100)}pts above average and leaves before the proof → surface ${truncate(trustBelow.text) || "the testimonials"} right under the hero.`,
      );
    }
  }

  if (ops.length === 0) return null;

  const plan: AdaptationPlan = {
    planId: `seg-${args.segmentId.slice(0, 8)}-${args.segment.source}`,
    siteId: args.siteId,
    segmentId: args.segmentId,
    extractorVersion: args.extractorVersion,
    ops: ops.slice(0, MAX_OPS),
    fallback: "noop",
  };
  return { plan, content: {}, rationale };
}

// Stable segment identity without a segments table yet: a deterministic, valid
// UUID derived from (siteId, source). Same segment ⇒ same id across requests, so a
// served plan is consistent for a visitor. Not cryptographic — just a stable key.
export function segmentUuid(siteId: string, source: string): string {
  const h = hash128(`${siteId}:${source}`);
  const version = "5" + h.slice(13, 16); // version nibble = 5
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20); // 8–b
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${version}-${variant}-${h.slice(20, 32)}`;
}

// 128-bit digest as 32 hex chars: four FNV-1a passes with distinct seeds.
function hash128(input: string): string {
  const seeds = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x9e3779b9];
  let out = "";
  for (const seed of seeds) {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}
