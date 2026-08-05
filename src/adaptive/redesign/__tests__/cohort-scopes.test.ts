// Kohort-scope-planeraren: mätbarhet är grinden, basen är aldrig ett scope.
import { describe, expect, it } from "vitest";

import { cohortBriefLines, planCohortScopes, segmentKeyForScope } from "../cohort-scopes";

const row = (src: string, visitors: number, ret = false, pricing = false) => ({
  traffic_source: src,
  is_returning: ret,
  viewed_pricing: pricing,
  visitors,
});

describe("planCohortScopes", () => {
  const opts = { windowDays: 30, baseRate: 0.4, mdeRel: 0.3 };

  it("föreslår mätbara källkohorter, snabbast först — aldrig basen", () => {
    const scopes = planCohortScopes(
      [row("linkedin", 9000), row("google", 3000), row("direct", 20000)],
      { ...opts, maxScopes: 10 },
    );
    const keys = scopes.map((s) => s.cohorts[0]);
    // linkedin är enda social-källan ⇒ ch:social och src:linkedin binder lika
    // (samma trafik, samma dagar) — båda föreslås, alfabetisk ordning bryter.
    expect(keys.slice(0, 2)).toEqual(["ch:social", "src:linkedin"]);
    expect(keys).toContain("src:google");
    expect(keys).not.toContain("ch:direct");
    expect(keys).not.toContain("ret:new");
  });

  it("utesluter kohorter som inte når domslut inom maxDays", () => {
    // ~7/dag på 40 % bas: ~262/arm behövs → ~75 dagar > 45.
    const scopes = planCohortScopes([row("linkedin", 200)], opts);
    expect(scopes).toEqual([]);
  });

  it("seen:pricing och ret:2plus aggregeras över källor", () => {
    const scopes = planCohortScopes(
      [row("google", 5000, true, true), row("linkedin", 5000, true, true)],
      { ...opts, maxScopes: 10 },
    );
    const byKey = Object.fromEntries(scopes.map((s) => [s.cohorts[0], s.visitorsInWindow]));
    expect(byKey["seen:pricing"]).toBe(10000);
    expect(byKey["ret:2plus"]).toBe(10000);
  });

  it("lågkonverterande primär kräver mer trafik för samma scope", () => {
    const eng = planCohortScopes([row("linkedin", 3000)], { ...opts, baseRate: 0.4 });
    const conv = planCohortScopes([row("linkedin", 3000)], { ...opts, baseRate: 0.04 });
    expect(eng.length).toBe(2); // ch:social + src:linkedin — båda mätbara
    expect(conv.length).toBe(0); // 100/dag räcker inte för 4 %-bas inom 45 d
  });

  it("deterministisk ordning vid lika villkor", () => {
    const a = planCohortScopes([row("linkedin", 5000), row("facebook", 5000)], opts);
    const b = planCohortScopes([row("facebook", 5000), row("linkedin", 5000)], opts);
    expect(a.map((s) => s.cohorts[0])).toEqual(b.map((s) => s.cohorts[0]));
  });
});

describe("segmentKeyForScope + cohortBriefLines", () => {
  const scope = (k: string) => ({ cohorts: [k], visitorsInWindow: 9000, estimatedDaysToVerdict: 6 });
  it("bara src:-scopes är serverbara som segmentnyckel i dag", () => {
    expect(segmentKeyForScope(scope("src:linkedin"))).toBe("linkedin");
    expect(segmentKeyForScope(scope("ch:social"))).toBeNull();
    expect(segmentKeyForScope(scope("seen:pricing"))).toBeNull();
  });
  it("briefen bär mätdata + tydligt märkt hypotes, aldrig påhittad konvertering", () => {
    const lines = cohortBriefLines(scope("src:linkedin"));
    expect(lines[0]).toContain("9000 exposed");
    expect(lines[1]).toContain("not yet measured");
    expect(lines.some((l) => l.includes("hypothesis") && l.includes("peer evidence"))).toBe(true);
  });
});
