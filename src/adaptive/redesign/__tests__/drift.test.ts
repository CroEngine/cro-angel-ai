import { describe, it, expect } from "vitest";

import {
  DRIFT_HOLD_PREFIX,
  dependenciesOf,
  pickReplacementSnippet,
  planDependencySweep,
} from "../drift";

const dep = (path: string, textSnapshot: string) => ({ path, textSnapshot });
const v = (id: string, deps: ReturnType<typeof dep>[], heldReason: string | null = null) => ({
  id,
  heldReason,
  dependencies: deps,
});

describe("planDependencySweep — självläkningens rena planerare", () => {
  it("keeps a variant whose source text is still verbatim on the page", () => {
    const actions = planDependencySweep([v("a", [dep("/priser", "Från 299 kr/mån")])], {
      "/priser": ["Från 299 kr/mån", "Studentpris: 199 kr/mån"],
    });
    expect(actions).toEqual([{ id: "a", action: "keep" }]);
  });

  it("keeps (never holds) when the source page has no fresh frozen copy — absence is not drift", () => {
    const actions = planDependencySweep([v("a", [dep("/priser", "Från 299 kr/mån")])], {
      "/priser": null,
    });
    expect(actions).toEqual([{ id: "a", action: "keep" }]);
  });

  it("refreshes with the closest fresh statement when the old one is gone (price change)", () => {
    const actions = planDependencySweep(
      [v("a", [dep("/priser", "Från 299 kr/mån — alla pass ingår.")])],
      {
        "/priser": ["Studentpris: 249 kr/mån", "Från 349 kr/mån — alla pass ingår."],
      },
    );
    expect(actions).toEqual([
      {
        id: "a",
        action: "refresh",
        path: "/priser",
        oldText: "Från 299 kr/mån — alla pass ingår.",
        newText: "Från 349 kr/mån — alla pass ingår.",
      },
    ]);
  });

  it("holds when the source no longer publishes ANY price statement", () => {
    const actions = planDependencySweep([v("a", [dep("/priser", "Från 299 kr/mån")])], {
      "/priser": [],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("hold");
    expect((actions[0] as { reason: string }).reason).toContain(DRIFT_HOLD_PREFIX.trim());
    expect((actions[0] as { reason: string }).reason).toContain("/priser");
  });

  it("releases ONLY its own drift-hold when the source has healed", () => {
    const healed = planDependencySweep(
      [v("a", [dep("/priser", "Från 299 kr/mån")], `${DRIFT_HOLD_PREFIX}"x" försvann`)],
      { "/priser": ["Från 299 kr/mån"] },
    );
    expect(healed).toEqual([{ id: "a", action: "release" }]);
    const foreignHold = planDependencySweep(
      [v("a", [dep("/priser", "Från 299 kr/mån")], "manuellt stopp av annan orsak")],
      { "/priser": ["Från 299 kr/mån"] },
    );
    expect(foreignHold).toEqual([{ id: "a", action: "keep" }]);
  });

  it("ignores variants without dependencies entirely", () => {
    expect(planDependencySweep([v("a", [])], {})).toEqual([]);
  });

  it("normalizes whitespace when matching the snapshot (markup line breaks ≠ drift)", () => {
    const actions = planDependencySweep([v("a", [dep("/priser", "Från 299  kr/mån")])], {
      "/priser": ["Från 299 kr/mån"],
    });
    expect(actions).toEqual([{ id: "a", action: "keep" }]);
  });
});

describe("pickReplacementSnippet — deterministiskt, ordöverlapp", () => {
  it("prefers the statement sharing the most words with the old one", () => {
    expect(
      pickReplacementSnippet("Från 299 kr/mån — alla pass ingår.", [
        "Studentpris: 249 kr/mån",
        "Från 349 kr/mån — alla pass ingår.",
      ]),
    ).toBe("Från 349 kr/mån — alla pass ingår.");
  });

  it("falls back to the first (document-order) candidate on a tie and null on empty", () => {
    expect(pickReplacementSnippet("$9 /month", ["$14 /month", "$19 /month"])).toBe("$14 /month");
    expect(pickReplacementSnippet("x", [])).toBeNull();
  });
});

describe("dependenciesOf — tolerant evidensläsning", () => {
  it("reads well-formed dependencies and ignores everything else", () => {
    expect(
      dependenciesOf({ dependencies: [{ path: "/p", textSnapshot: "t" }, { path: 1 }, null] }),
    ).toEqual([{ path: "/p", textSnapshot: "t" }]);
    expect(dependenciesOf(null)).toEqual([]);
    expect(dependenciesOf({})).toEqual([]);
    expect(dependenciesOf({ dependencies: "nope" })).toEqual([]);
  });
});
