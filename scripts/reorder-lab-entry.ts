// Browser entry for the reorder lab: exposes the pattern applier so synthetic
// pages can drive it with a hand-built inventory (machinery under test is the
// reorder attempt loop, not the extractor — that has its own benchmarks).
import {
  applyAdaptations,
  applyPlannedReorder,
  type PlannedReorder,
  type Segment,
} from "../src/adaptive-lab/patterns";
import type { ContentInventory } from "../src/adaptive-lab/inventory";

(window as unknown as Record<string, unknown>).__angelLab = {
  apply: (inv: ContentInventory, segment: Segment) => applyAdaptations(inv, segment),
  plan: (inv: ContentInventory, plan: PlannedReorder) => applyPlannedReorder(inv, plan),
};
