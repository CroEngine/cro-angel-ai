// Ägarens återbruksetikett — ett PÅSTÅENDE om vad som är bevisat, så den
// testas som ett. Transferformen steg 4 införde en andra bevisform, och den
// får aldrig ärva textblockets ordalydelse ("this exact text won").
import { describe, expect, it } from "vitest";

import { reuseProvenanceLabel, reusedKindOf } from "../reuse-provenance";

describe("reusedKindOf", () => {
  it("läser kind 'move' som flytt-överföring", () => {
    expect(reusedKindOf({ provedOnPath: "/priser", kind: "move" })).toBe("move");
  });

  it("rader utan kind är textblock — formen som fanns före steg 4", () => {
    expect(reusedKindOf({ provedOnPath: "/priser" })).toBe("text");
    expect(reusedKindOf({ provedOnPath: "/priser", kind: "text" })).toBe("text");
  });

  it("null när varianten inte är återbruk eller saknar proveniens", () => {
    for (const bad of [undefined, null, {}, { kind: "move" }, { provedOnPath: "" }, "x", 7]) {
      expect(reusedKindOf(bad)).toBeNull();
    }
  });
});

describe("reuseProvenanceLabel", () => {
  it("textblocket påstår att TEXTEN vann", () => {
    const { label, title } = reuseProvenanceLabel("text", "/priser");
    expect(label).toBe("reused · won on /priser");
    expect(title).toContain("this exact text won its A/B test on /priser");
  });

  it("flytten påstår att TYPKLASSEN vann — aldrig texten", () => {
    const { label, title } = reuseProvenanceLabel("move", "/priser");
    expect(label).toBe("reused move · won on /priser");
    expect(title).toContain("moving a section of this type up won its A/B test on /priser");
    expect(title).not.toContain("this exact text");
    // …och att sektionen som flyttas här är målsidans egen.
    expect(title).toContain("this page's own");
  });

  it("bägge formerna säger att överföringen hit är obevisad tills testet körts", () => {
    for (const kind of ["text", "move"] as const) {
      expect(reuseProvenanceLabel(kind, "/x").title).toContain("unproven until this test runs");
    }
  });
});
