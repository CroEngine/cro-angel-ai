// Angel Adaptive — RULES: the approval-gated serving unit (E4b/E4).
//
// A rule is the thing a site OWNER approves: "visitors arriving from
// LinkedIn (cohort src:linkedin) get proof-first (this reorder), because the
// data says proof-early converts better for them". The approval is at the
// RULE level — approve once, serve every matching visitor — but an approval
// is never forever-valid on faith: every single pageview re-runs the same
// self-checks the primitives always had, so a site redesign that makes an
// approved change unsafe turns into a per-view refusal, not a broken page.
//
// Serving mechanics (all client-side, deterministic):
//   match   — every cohort listed on the rule must be present on the visitor
//             (AND), plus an optional segment gate.
//   holdout — deterministic FNV-1a hash of visitorKey + rule id vs the
//             rule's ramp percentage: the same visitor always lands on the
//             same side, no coordination needed. Holdout visitors generate a
//             rule_holdout event (the measurement baseline) and see nothing.
//   apply   — through the SAME machinery as everything else: planned
//             reorders via applyPlannedReorder (full self-check + rollback),
//             patterns via the pattern library (their own runtime guards).
//
// Nothing here auto-runs: serving happens only when the host explicitly
// calls serve() or configures a rules source. Learn mode stays inert.

import type { ContentInventory } from "./inventory";
import {
  applyPlannedReorder,
  applyAdaptations,
  type PlannedReorder,
  type Segment,
  SEGMENT_PATTERNS,
} from "./patterns";

export type RuleAction =
  | { kind: "pattern"; patternId: string }
  | { kind: "planned_reorder"; plan: PlannedReorder };

export type RuleStatus = "proposed" | "approved" | "paused" | "retired";

export type AngelRule = {
  id: string;
  siteId?: string;
  // Every listed cohort must be present on the visitor (AND). Empty list =
  // matches everyone (site-wide rule).
  cohorts: string[];
  // Optional extra gate on the session-derived segment.
  segment?: Segment;
  action: RuleAction;
  status: RuleStatus;
  // Percentage of matching visitors who receive the change; the rest are the
  // holdout. 0..100, default 100.
  ramp?: number;
  evidence?: { before?: string; after?: string; rationale?: string };
};

export type RuleOutcome = {
  ruleId: string;
  outcome: "served" | "holdout" | "refused" | "not_matched";
  detail?: string;
};

export type RuleEvent = { type: string; ts: number; ruleId: string; detail?: string };

// FNV-1a over visitorKey + rule id → stable bucket 0..99. Deterministic per
// (visitor, rule): re-visits land on the same side of the holdout split.
export function assignBucket(visitorKey: string, ruleId: string): number {
  const s = visitorKey + "::" + ruleId;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 100;
}

export function ruleMatches(
  rule: AngelRule,
  cohorts: string[],
  segment: Segment | null,
): boolean {
  if (rule.status !== "approved") return false;
  for (const c of rule.cohorts) if (cohorts.indexOf(c) === -1) return false;
  if (rule.segment && rule.segment !== segment) return false;
  return true;
}

// Structural validation for rules fetched over the network — reject anything
// that doesn't look exactly like a rule list before it reaches serving.
export function validateRules(raw: unknown): AngelRule[] {
  if (!Array.isArray(raw)) return [];
  const out: AngelRule[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    if (typeof r.id !== "string" || !r.id) continue;
    if (!Array.isArray(r.cohorts) || r.cohorts.some((c) => typeof c !== "string")) continue;
    if (r.status !== "proposed" && r.status !== "approved" && r.status !== "paused" && r.status !== "retired")
      continue;
    const a = r.action as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object") continue;
    if (a.kind === "pattern") {
      if (typeof a.patternId !== "string") continue;
    } else if (a.kind === "planned_reorder") {
      const p = a.plan as Record<string, unknown> | undefined;
      if (!p || p.action !== "reorder") continue;
      if (typeof p.container !== "string" || typeof p.move !== "string") continue;
    } else {
      continue;
    }
    if (r.segment !== undefined && !(typeof r.segment === "string" && r.segment in SEGMENT_PATTERNS))
      continue;
    if (r.ramp !== undefined && (typeof r.ramp !== "number" || r.ramp < 0 || r.ramp > 100)) continue;
    out.push(r as unknown as AngelRule);
  }
  return out;
}

export type ServeResult = {
  outcomes: RuleOutcome[];
  events: RuleEvent[];
  reverts: Array<() => void>;
};

/**
 * Serve a rule list to this visitor. Pure orchestration over the existing
 * appliers — every application self-checks and rolls back on failure exactly
 * as always. Returns what happened per rule plus the reverts for the caller
 * to register. Never throws.
 */
export function serveRules(
  rules: AngelRule[],
  ctx: {
    inv: ContentInventory;
    cohorts: string[];
    segment: Segment | null;
    visitorKey: string;
  },
): ServeResult {
  const outcomes: RuleOutcome[] = [];
  const events: RuleEvent[] = [];
  const reverts: Array<() => void> = [];
  const now = Date.now();

  for (const rule of rules) {
    try {
      if (!ruleMatches(rule, ctx.cohorts, ctx.segment)) {
        outcomes.push({ ruleId: rule.id, outcome: "not_matched" });
        continue;
      }
      const ramp = rule.ramp === undefined ? 100 : rule.ramp;
      if (assignBucket(ctx.visitorKey, rule.id) >= ramp) {
        outcomes.push({ ruleId: rule.id, outcome: "holdout" });
        events.push({ type: "rule_holdout", ts: now, ruleId: rule.id });
        continue;
      }

      if (rule.action.kind === "planned_reorder") {
        const res = applyPlannedReorder(ctx.inv, rule.action.plan);
        if (res.ok && res.revert) {
          reverts.push(res.revert);
          outcomes.push({ ruleId: rule.id, outcome: "served", detail: res.detail });
          events.push({ type: "rule_served", ts: now, ruleId: rule.id, detail: res.detail });
        } else {
          // The per-view safety net: an approved rule that no longer passes
          // the self-checks refuses silently and reports why.
          outcomes.push({ ruleId: rule.id, outcome: "refused", detail: res.reason });
          events.push({ type: "rule_refused", ts: now, ruleId: rule.id, detail: res.reason });
        }
      } else {
        const single = applyAdaptations(ctx.inv, "default", [rule.action.patternId]);
        if (single.applied.length) {
          reverts.push(single.revert);
          outcomes.push({
            ruleId: rule.id,
            outcome: "served",
            detail: single.applied[0]?.detail,
          });
          events.push({ type: "rule_served", ts: now, ruleId: rule.id });
        } else {
          outcomes.push({ ruleId: rule.id, outcome: "refused", detail: "pattern-refused" });
          events.push({ type: "rule_refused", ts: now, ruleId: rule.id, detail: "pattern-refused" });
        }
      }
    } catch {
      outcomes.push({ ruleId: rule.id, outcome: "refused", detail: "threw" });
    }
  }
  return { outcomes, events, reverts };
}
