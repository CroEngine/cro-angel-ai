import { describe, it, expect } from "vitest";

import { metricTableRows } from "../variant-stats";

// Variantradens utfällbara mätartabell (ägarbeslut 2026-07-27: alla siffror
// synliga, men bara bakom ett klick). REN LÄSNING — testerna pinnar att
// tabellen bara FORMATERAR armarnas räknare och aldrig uppfinner egna tal;
// bounce-definitionen speglar guardSecondariesFromArms (visits − continuations).

const arm = (over: Partial<Record<string, number>> = {}) => ({
  visits: 200,
  conversions: 8,
  continuations: 120,
  ctaClicks: 30,
  formSubmits: 4,
  engaged: 90,
  deepScrolls: 50,
  ...over,
});

describe("metricTableRows — utfällbara mätartabellen", () => {
  it("åtta rader i fast ordning, besökare utan andel, övriga med andel av besök", () => {
    const rows = metricTableRows({ variant: arm(), control: arm({ visits: 100 }) });
    expect(rows.map((r) => r.label)).toEqual([
      "Visitors",
      "Continued (2nd page)",
      "Bounced",
      "Conversions",
      "CTA clicks",
      "Form submits",
      "Engaged (60% scroll / 30s)",
      "Deep scroll (80%)",
    ]);
    expect(rows[0].variant).toBe("200"); // aldrig "200 (100.0%)"
    expect(rows[1].variant).toBe("120 (60.0%)");
    expect(rows[3].variant).toBe("8 (4.0%)");
  });

  it("bounce = besök − fortsättningar, klampad vid 0 (samma definition som vakterna)", () => {
    const rows = metricTableRows({
      variant: arm({ visits: 200, continuations: 120 }),
      control: arm({ visits: 100, continuations: 130 }), // fler fortsättningar än besök → 0
    });
    const bounced = rows.find((r) => r.label === "Bounced")!;
    expect(bounced.variant).toBe("80 (40.0%)");
    expect(bounced.control).toBe("0 (0.0%)");
  });

  it("arm utan besök: andelar blir — i stället för division med noll", () => {
    const zero = arm({
      visits: 0,
      conversions: 0,
      continuations: 0,
      ctaClicks: 0,
      formSubmits: 0,
      engaged: 0,
      deepScrolls: 0,
    });
    const rows = metricTableRows({ variant: arm(), control: zero });
    expect(rows[1].control).toBe("0 (—)");
    expect(rows[0].control).toBe("0");
  });

  it("stora tal får en-US-tusentalsavgränsare (fmt-konventionen)", () => {
    const rows = metricTableRows({
      variant: arm({ visits: 12345, continuations: 6789 }),
      control: arm(),
    });
    expect(rows[0].variant).toBe("12,345");
    expect(rows[1].variant).toBe("6,789 (55.0%)");
  });
});
