import { describe, it, expect } from "vitest";

import { analyze, summarize, type RobustnessObservation } from "../analyze";
import { personaContext, isPersona } from "../personas";

const sig = (elementCount: number, textLen = 100, bodyChildCount = 10) => ({
  textLen,
  elementCount,
  bodyChildCount,
});

function obs(over: Partial<RobustnessObservation> = {}): RobustnessObservation {
  return {
    url: "https://x/",
    site: "s",
    persona: "linkedin_desktop",
    reachable: true,
    snippetRan: true,
    consoleErrors: [],
    decidedCount: 3,
    appliedCount: 3,
    probes: [
      { pattern: "a", op: "reveal", via: "selector", count: 1 },
      { pattern: "b", op: "set_text", via: "text", count: 2 },
      { pattern: "c", op: "emphasize", via: "slot", count: 1 },
    ],
    baseline: sig(100),
    afterApply: sig(103),
    afterReset: sig(100),
    layout: { matched: 50, shiftedCount: 0, shiftedFraction: 0, maxMove: 0 },
    residueAfterReset: 0,
    durationMs: 10,
    ...over,
  };
}

describe("analyze — robustness verdicts", () => {
  it("passes a clean run with full targeting and no residue", () => {
    const r = analyze(obs());
    expect(r.verdict).toBe("pass");
    expect(r.reasons).toEqual([]);
    expect(r.metrics.targetingRate).toBe(1);
    expect(r.metrics.reversible).toBe(true);
  });

  it("fails when a console error fires during apply", () => {
    const r = analyze(obs({ consoleErrors: ["TypeError: boom"] }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toContain("console error");
  });

  it("fails when reset leaves residue (not reversible)", () => {
    const r = analyze(obs({ residueAfterReset: 2 }));
    expect(r.verdict).toBe("fail");
    expect(r.metrics.reversible).toBe(false);
  });

  it("fails when apply removes a meaningful chunk of the DOM", () => {
    const r = analyze(obs({ afterApply: sig(80) })); // 20% gone
    expect(r.verdict).toBe("fail");
    expect(r.metrics.elementsRemoved).toBe(20);
  });

  it("tolerates a tiny DOM delta (badge/text) as a pass", () => {
    const r = analyze(obs({ afterApply: sig(96) })); // 4% < 10%
    expect(r.verdict).toBe("pass");
  });

  it("warns (not fails) when some adaptations resolve no target", () => {
    const r = analyze(
      obs({
        probes: [
          { pattern: "a", op: "reveal", via: "selector", count: 1 },
          { pattern: "b", op: "set_text", via: "none", count: 0 },
          { pattern: "c", op: "emphasize", via: "none", count: 0 },
        ],
      }),
    );
    expect(r.verdict).toBe("warn");
    expect(r.metrics.targeted).toBe(1);
    expect(r.metrics.fullyTargeted).toBe(false);
  });

  it("warns (with review note) on a large layout shift after apply", () => {
    const r = analyze(obs({ layout: { matched: 60, shiftedCount: 40, shiftedFraction: 0.55, maxMove: 320 } }));
    expect(r.verdict).toBe("warn");
    expect(r.reasons.some((x) => x.includes("layout shift"))).toBe(true);
    expect(r.metrics.layout.shiftedFraction).toBeCloseTo(0.55);
  });

  it("does not warn on a small layout shift", () => {
    const r = analyze(obs({ layout: { matched: 60, shiftedCount: 3, shiftedFraction: 0.05, maxMove: 12 } }));
    expect(r.verdict).toBe("pass");
  });

  it("warns when nothing was decided (empty inventory)", () => {
    const r = analyze(obs({ decidedCount: 0, appliedCount: 0, probes: [] }));
    expect(r.verdict).toBe("warn");
    expect(r.metrics.targetingRate).toBe(1);
  });

  it("fails an unreachable page", () => {
    const r = analyze(obs({ reachable: false, snippetRan: false, decidedCount: 0, probes: [] }));
    expect(r.verdict).toBe("fail");
    expect(r.reasons).toContain("page unreachable");
  });

  it("fails when the snippet never initialized", () => {
    const r = analyze(obs({ snippetRan: false }));
    expect(r.verdict).toBe("fail");
  });

  it("lets a hard failure win over a soft warning", () => {
    const r = analyze(
      obs({
        consoleErrors: ["e"],
        probes: [
          { pattern: "a", op: "reveal", via: "none", count: 0 },
          { pattern: "b", op: "x", via: "none", count: 0 },
          { pattern: "c", op: "y", via: "none", count: 0 },
        ],
      }),
    );
    expect(r.verdict).toBe("fail");
  });
});

describe("summarize — sweep aggregate", () => {
  it("buckets verdicts and averages targeting across reachable pages", () => {
    const reports = [
      analyze(obs()),
      analyze(obs({ consoleErrors: ["e"] })),
      analyze(
        obs({
          probes: [
            { pattern: "a", op: "reveal", via: "selector", count: 1 },
            { pattern: "b", op: "set_text", via: "none", count: 0 },
            { pattern: "c", op: "emphasize", via: "none", count: 0 },
          ],
        }),
      ),
      analyze(obs({ reachable: false, snippetRan: false, decidedCount: 0, probes: [] })),
    ];
    const s = summarize(reports);
    expect(s.total).toBe(4);
    expect(s.pass).toBe(1);
    expect(s.warn).toBe(1);
    expect(s.fail).toBe(2);
    // unreachable page (snippetRan:false) counts as irreversible.
    expect(s.irreversible).toBe(1);
    expect(s.avgTargetingRate).toBeGreaterThan(0);
    expect(s.avgTargetingRate).toBeLessThanOrEqual(1);
  });
});

describe("personas", () => {
  it("maps persona ids to the right visitor context", () => {
    const li = personaContext("linkedin_desktop", "https://x/");
    expect(li.trafficSource).toBe("linkedin");
    expect(li.device).toBe("desktop");
    expect(li.url).toBe("https://x/");

    const gm = personaContext("google_mobile", "https://x/");
    expect(gm.trafficSource).toBe("google");
    expect(gm.device).toBe("mobile");

    const rp = personaContext("returning_pricing", "https://x/");
    expect(rp.isReturning).toBe(true);
    expect(rp.viewedPricing).toBe(true);
  });

  it("recognizes valid persona ids", () => {
    expect(isPersona("linkedin_desktop")).toBe(true);
    expect(isPersona("nope")).toBe(false);
  });
});
