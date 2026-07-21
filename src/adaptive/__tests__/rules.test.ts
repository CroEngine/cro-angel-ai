// E4 rule core — pure-function tests (matching, holdout, validation).
import { describe, expect, it } from "vitest";

import { assignBucket, ruleMatches, validateRules, type AngelRule } from "../rules";

function rule(over: Partial<AngelRule> = {}): AngelRule {
  return {
    id: "r1",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "approved",
    ...over,
  };
}

describe("ruleMatches", () => {
  it("requires approved status", () => {
    for (const status of ["proposed", "paused", "retired"] as const) {
      expect(ruleMatches(rule({ status }), ["src:linkedin"], null)).toBe(false);
    }
    expect(ruleMatches(rule(), ["src:linkedin"], null)).toBe(true);
  });

  it("ANDs every listed cohort", () => {
    const r = rule({ cohorts: ["src:linkedin", "seen:pricing"] });
    expect(ruleMatches(r, ["src:linkedin"], null)).toBe(false);
    expect(ruleMatches(r, ["src:linkedin", "seen:pricing", "ret:new"], null)).toBe(true);
  });

  it("empty cohort list matches everyone", () => {
    expect(ruleMatches(rule({ cohorts: [] }), [], null)).toBe(true);
  });

  it("segment gate must match when present", () => {
    const r = rule({ segment: "engaged_no_click" });
    expect(ruleMatches(r, ["src:linkedin"], "default")).toBe(false);
    expect(ruleMatches(r, ["src:linkedin"], "engaged_no_click")).toBe(true);
  });
});

describe("assignBucket", () => {
  it("is deterministic per (visitor, rule)", () => {
    expect(assignBucket("vk-abc", "r1")).toBe(assignBucket("vk-abc", "r1"));
  });
  it("differs across rules for the same visitor (independent experiments)", () => {
    const buckets = new Set(
      Array.from({ length: 20 }, (_, i) => assignBucket("vk-abc", "rule-" + i)),
    );
    expect(buckets.size).toBeGreaterThan(10);
  });
  it("distributes visitors roughly uniformly", () => {
    let below50 = 0;
    for (let i = 0; i < 2000; i++) if (assignBucket("visitor-" + i, "r1") < 50) below50++;
    expect(below50).toBeGreaterThan(850);
    expect(below50).toBeLessThan(1150);
  });
});

describe("validateRules", () => {
  const good = {
    id: "r1",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "approved",
  };

  it("accepts a well-formed list and rejects garbage rows", () => {
    const out = validateRules([
      good,
      null,
      42,
      { id: "", cohorts: [], action: { kind: "pattern", patternId: "x" }, status: "approved" },
      { id: "r2", cohorts: "not-a-list", action: { kind: "pattern", patternId: "x" }, status: "approved" },
      { id: "r3", cohorts: [], action: { kind: "nope" }, status: "approved" },
      { id: "r4", cohorts: [], action: { kind: "pattern", patternId: "x" }, status: "live" },
      { id: "r5", cohorts: [], action: { kind: "pattern", patternId: "x" }, status: "approved", ramp: 150 },
      { id: "r6", cohorts: [], action: { kind: "pattern", patternId: "x" }, status: "approved", segment: "bogus" },
    ]);
    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });

  it("accepts planned_reorder actions with a structural plan check", () => {
    const out = validateRules([
      {
        id: "r-plan",
        cohorts: ["src:linkedin"],
        status: "approved",
        action: {
          kind: "planned_reorder",
          plan: { action: "reorder", container: "#main", move: "#testi", after: null, mode: "grid" },
        },
      },
      {
        id: "r-bad-plan",
        cohorts: [],
        status: "approved",
        action: { kind: "planned_reorder", plan: { action: "reorder", container: 7 } },
      },
    ]);
    expect(out.map((r) => r.id)).toEqual(["r-plan"]);
  });

  it("rejects non-arrays", () => {
    expect(validateRules({ rules: [good] })).toEqual([]);
    expect(validateRules("[]")).toEqual([]);
  });
});
