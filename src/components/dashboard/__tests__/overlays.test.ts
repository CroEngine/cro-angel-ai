import { describe, it, expect } from "vitest";

import { changeChips, narratedDevice } from "../overlays";

import type { VariantComparison, VariantOpView } from "@/lib/dashboard/dashboard.functions";

// Overlaysens RENA visningslogik: ändrings-chipsen i Compare-toppraden och
// persontidslinjens enhetsord. Chipsen är ägarvända — hela produktions-
// vokabulären (move_up, insert_snippet) ska ge läsbar engelska, aldrig råa
// op-tokens (granskningsfynd 2026-08-14: "insert_snippet" stod som chip).

const op = (o: string): VariantOpView => ({ op: o, targetId: "", detail: "", why: "" });
const cmp = (over: Partial<VariantComparison> = {}): VariantComparison => ({
  headline: null,
  orderBefore: [],
  orderAfter: [],
  movedLabel: null,
  screenshots: { before: null, after: null, attempt1: null },
  ...over,
});

describe("changeChips — ägarvända ändrings-chips", () => {
  it("move_up med comparison-ordning: 'Moved \"X\" #4 → #2' ur positionerna", () => {
    const { shown } = changeChips({
      ops: [op("move_up")],
      comparison: cmp({
        movedLabel: "Reviews",
        orderBefore: ["Hero", "Pricing", "FAQ", "Reviews"],
        orderAfter: ["Hero", "Reviews", "Pricing", "FAQ"],
      }),
    });
    expect(shown).toEqual(['Moved "Reviews" #4 → #2']);
  });

  it("hela produktionsvokabulären {move_up, insert_snippet} blir läsbar text utan råa tokens", () => {
    const { shown } = changeChips({
      ops: [op("move_up"), op("insert_snippet")],
      comparison: null,
    });
    expect(shown).toEqual(["Moved a section up", "Added a line from the site below the hero"]);
    for (const chip of shown) expect(chip).not.toMatch(/_/);
  });

  it("set_text blir 'Rewrote a heading' (äldre varianter kan bära den)", () => {
    const { shown } = changeChips({ ops: [op("set_text")], comparison: null });
    expect(shown).toEqual(["Rewrote a heading"]);
  });

  it("upprepade ops dedupliceras till EN chip", () => {
    const { shown, more } = changeChips({
      ops: [op("insert_snippet"), op("insert_snippet")],
      comparison: null,
    });
    expect(shown).toEqual(["Added a line from the site below the hero"]);
    expect(more).toBe(0);
  });

  it("max 3 chips + '+N more' för resten", () => {
    const { shown, more } = changeChips({
      ops: [op("move_up"), op("set_text"), op("insert_snippet"), op("future_op")],
      comparison: null,
    });
    expect(shown).toHaveLength(3);
    expect(more).toBe(1);
  });
});

describe("narratedDevice — tidslinjens enhetsord", () => {
  it("berättar besökets FAKTISKA enhet — tablet är tablet, inte 'desktop'", () => {
    expect(narratedDevice("mobile")).toBe("mobile");
    expect(narratedDevice("desktop")).toBe("desktop");
    // Kohortfiltrets deviceOf bucketar tablet→desktop för ATTRIBUTION; det
    // får aldrig läcka in i berättelsen, som påstår fakta om besöket.
    expect(narratedDevice("tablet")).toBe("tablet");
  });

  it("okänd enhet ⇒ null så raden utelämnar 'on …' i stället för att gissa", () => {
    expect(narratedDevice(null)).toBeNull();
    expect(narratedDevice("smartfridge")).toBeNull();
  });
});
