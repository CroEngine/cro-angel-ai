import { describe, it, expect } from "vitest";

import type { RedesignContentModel } from "../context";
import type { RedesignPlan, RedesignOp } from "../generate";
import { previewPlan, formatOrder } from "../preview";

const sec = (id: string, type: string, position: number) => ({
  id,
  type,
  position,
  heading: id,
  aboveFold: position === 1,
  visualWeight: 50,
});

const content = (
  sections = [
    sec("s-hero", "hero", 1),
    sec("s-logos", "logos", 2),
    sec("s-pricing", "pricing", 3),
    sec("s-testi", "testimonials", 4),
    sec("s-footer", "footer", 5),
  ],
): RedesignContentModel => ({ sections, trustSignals: [], ctas: [], hero: { headline: "H" } });

const plan = (...ops: RedesignOp[]): RedesignPlan => ({ ops, rejected: [] });
const op = (o: RedesignOp["op"], targetId: string): RedesignOp => ({
  op: o,
  targetId,
  detail: "",
  why: "",
});

describe("previewPlan — structural FÖRE/EFTER", () => {
  it("move_up swaps the target with its predecessor and records the move", () => {
    const p = previewPlan(content(), plan(op("move_up", "s-testi")));
    expect(formatOrder(p.before)).toBe("hero → logos → pricing → testimonials → footer");
    expect(formatOrder(p.after)).toBe("hero → logos → testimonials → pricing → footer");
    // testimonials moved 3→2, pricing pushed 2→3
    expect(p.moves).toEqual(
      expect.arrayContaining([
        { targetId: "s-testi", from: 3, to: 2 },
        { targetId: "s-pricing", from: 2, to: 3 },
      ]),
    );
    expect(p.reversible).toBe(true);
    expect(p.warnings).toHaveLength(0);
  });

  it("compounding move_ups lift a section several positions", () => {
    const p = previewPlan(content(), plan(op("move_up", "s-testi"), op("move_up", "s-testi")));
    expect(formatOrder(p.after)).toBe("hero → testimonials → logos → pricing → footer");
  });

  it("reveal / condense are recorded but do not reorder", () => {
    const p = previewPlan(content(), plan(op("reveal", "s-testi"), op("condense", "hero")));
    expect(p.revealed).toEqual(["s-testi"]);
    expect(p.retouched).toEqual(["hero"]);
    expect(formatOrder(p.after)).toBe(formatOrder(p.before)); // order unchanged
  });

  it("flags hero_demoted when a section is lifted above the hero", () => {
    const p = previewPlan(content(), plan(op("move_up", "s-logos")));
    expect(formatOrder(p.after)).toBe("logos → hero → pricing → testimonials → footer");
    expect(p.warnings.map((w) => w.code)).toContain("hero_demoted");
  });

  it("flags footer_not_last when the footer is lifted", () => {
    const p = previewPlan(content(), plan(op("move_up", "s-footer")));
    expect(p.warnings.map((w) => w.code)).toContain("footer_not_last");
  });

  it("flags noop on an empty plan", () => {
    const p = previewPlan(content(), plan());
    expect(p.warnings.map((w) => w.code)).toContain("noop");
    expect(p.moves).toHaveLength(0);
  });
});
