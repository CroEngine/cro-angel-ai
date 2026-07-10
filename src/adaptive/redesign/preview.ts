// Fas 3 (slice 3a) — structural FÖRE/EFTER + safety gates for a redesign plan.
//
// Takes the validated plan (slice 2) and applies its reversible ops to the page's
// SECTION ORDER to produce a reviewable before/after — plus structural sanity
// gates that catch gross layout breakage (hero demoted, footer no longer last,
// a section lost). This is the cheap, deterministic half of "blir det snyggt":
// it answers "does the new ORDER make sense?" without a browser.
//
// The PIXEL half — render the reordered page + the real beauty gates (introduced
// overflow, covered clickables) — reuses scripts/preflight.ts and is the next
// step; a plan that fails these structural gates never gets there.
//
// Pure + framework-free.

import type { RedesignContentModel } from "./context";
import type { RedesignPlan } from "./generate";

export interface SectionRef {
  id: string;
  type: string;
  heading: string;
}

export interface PlanMove {
  targetId: string;
  from: number; // 0-based index in the BEFORE order
  to: number; // 0-based index in the AFTER order
}

export interface PreviewWarning {
  code: "hero_demoted" | "footer_not_last" | "section_lost" | "noop";
  message: string;
}

export interface RedesignPreview {
  before: SectionRef[];
  after: SectionRef[];
  moves: PlanMove[];
  /** reveal ops — content un-hidden, no reorder. */
  revealed: string[];
  /** condense / set_text ops — copy tightened in place, no reorder. */
  retouched: string[];
  warnings: PreviewWarning[];
  /** Ops are reversible by construction (each records original state). */
  reversible: true;
}

const ref = (s: RedesignContentModel["sections"][number]): SectionRef => ({
  id: s.id,
  type: s.type,
  heading: s.heading,
});

/** Apply a validated plan to the section order. `move_up` swaps the target with
 *  its predecessor (minimal, reversible — "en liten ändring i taget"); multiple
 *  move_ups compound. reveal / condense / set_text don't reorder. Pure. */
export function previewPlan(content: RedesignContentModel, plan: RedesignPlan): RedesignPreview {
  const before = [...content.sections].sort((a, b) => a.position - b.position).map(ref);
  const order = before.map((s) => s.id);
  const revealed: string[] = [];
  const retouched: string[] = [];

  for (const op of plan.ops) {
    if (op.op === "move_up") {
      const i = order.indexOf(op.targetId);
      if (i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
    } else if (op.op === "reveal") {
      revealed.push(op.targetId);
    } else {
      retouched.push(op.targetId); // condense | set_text
    }
  }

  const byId = new Map(before.map((s) => [s.id, s]));
  const after = order.map((id) => byId.get(id)!).filter(Boolean);
  const beforeIdx = new Map(before.map((s, i) => [s.id, i]));
  const moves: PlanMove[] = after
    .map((s, to) => ({ targetId: s.id, from: beforeIdx.get(s.id)!, to }))
    .filter((m) => m.from !== m.to);

  return {
    before,
    after,
    moves,
    revealed,
    retouched,
    warnings: structuralWarnings(before, after, plan),
    reversible: true,
  };
}

/** Structural sanity gates — modest, deterministic checks that complement (never
 *  replace) the pixel beauty gates in preflight. */
function structuralWarnings(
  before: SectionRef[],
  after: SectionRef[],
  plan: RedesignPlan,
): PreviewWarning[] {
  const w: PreviewWarning[] = [];

  // Integrity: after must be a permutation of before (no section lost/duplicated).
  const b = new Set(before.map((s) => s.id));
  const a = new Set(after.map((s) => s.id));
  if (b.size !== a.size || [...b].some((id) => !a.has(id))) {
    w.push({ code: "section_lost", message: "A section was lost or duplicated by the reorder." });
  }

  // Hero should stay the first section (never demoted below the fold).
  const heroBeforeFirst = before[0]?.type === "hero";
  if (heroBeforeFirst && after[0]?.type !== "hero") {
    w.push({ code: "hero_demoted", message: "The hero is no longer the first section." });
  }

  // Footer should stay last.
  const footerBeforeLast = before[before.length - 1]?.type === "footer";
  if (footerBeforeLast && after[after.length - 1]?.type !== "footer") {
    w.push({ code: "footer_not_last", message: "The footer is no longer the last section." });
  }

  // A plan with no ops has nothing to preflight or serve.
  if (plan.ops.length === 0) {
    w.push({ code: "noop", message: "Plan proposes no changes." });
  }

  return w;
}

/** One-line before/after order strings, for logs / the demo. */
export function formatOrder(sections: SectionRef[]): string {
  return sections.map((s) => s.type).join(" → ");
}
