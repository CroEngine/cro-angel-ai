import { describe, it, expect } from "vitest";

import { abMetricLabels, measuredHeadline } from "../ab-metric-labels";
import { metricTableRows } from "../variant-stats";

// A/B-ytans etiketter och svarskortets rubrikval (UI-buggjaktens fynd
// 2026-08-14). Testerna pinnar tre ärlighetsregler: continuation-tal visas
// aldrig under conversion-rubriker (abTest.*.conversions bär CONTINUATIONS
// när test_metric='continuation'), bara ett win-domslut får fira "Yes — …",
// och kontrollarm utan konverteringar (liftRel null) ger en egen mening i
// stället för ett tomt kort.

describe("abMetricLabels — metric ⇒ rubriker/copy", () => {
  it("continuation-läget byter ALLA fyra ytor — inga conversion-ord kvar", () => {
    const l = abMetricLabels("continuation");
    expect(l.rateLabel).toBe("Continuation rate");
    expect(l.countLabel).toBe("Continued (2nd page)");
    expect(l.verb).toBe("continue to a second page");
    expect(l.judgedOn).toBe("continuation (reaching a second page)");
    for (const s of Object.values(l)) {
      expect(s.toLowerCase()).not.toContain("conv");
    }
  });

  it("conversion, null och undefined ger alla conversion-etiketterna (ärlig default)", () => {
    for (const m of ["conversion", null, undefined] as const) {
      const l = abMetricLabels(m);
      expect(l.rateLabel).toBe("Conv. rate");
      expect(l.countLabel).toBe("Conversions");
      expect(l.verb).toBe("convert");
      expect(l.judgedOn).toBe("conversions");
    }
  });

  it("countLabel i continuation-läget delar formulering med metricTableRows-raden", () => {
    const arm = {
      visits: 100,
      conversions: 5,
      continuations: 60,
      ctaClicks: 10,
      formSubmits: 2,
      engaged: 40,
      deepScrolls: 20,
    };
    const rowLabels = metricTableRows({ variant: arm, control: arm }).map((r) => r.label);
    expect(rowLabels).toContain(abMetricLabels("continuation").countLabel);
  });
});

describe("measuredHeadline — svarskortets rubrikval", () => {
  it("win med lift firar med talet, i respektive metric-språk", () => {
    const conv = measuredHeadline("win", 0.12, "conversion");
    expect(conv.title).toBe("Yes — +12% lift");
    expect(conv.body).toContain("convert more");
    expect(conv.celebrate).toBe(true);

    const cont = measuredHeadline("win", 0.12, "continuation");
    expect(cont.title).toBe("Yes — +12% lift");
    expect(cont.body).toContain("continue to a second page more");
    expect(cont.body).not.toContain("convert");
  });

  it("no_effect får ALDRIG fira — även vid +20% observerad lift", () => {
    const h = measuredHeadline("no_effect", 0.2, "conversion");
    expect(h.title).not.toContain("Yes");
    expect(h.title).not.toContain("+20%");
    expect(h.celebrate).toBe(false);
    expect(h.body).toContain("no lift is claimed");
  });

  it("win med liftRel null (kontroll 0 konverteringar) ger en egen mening — inget tomt kort", () => {
    const conv = measuredHeadline("win", null, "conversion");
    expect(conv.title).toBe("Yes — adapted converts, control didn't");
    expect(conv.body).toContain("undefined");
    expect(conv.celebrate).toBe(true);

    const cont = measuredHeadline("win", null, "continuation");
    expect(cont.title).toBe("Yes — adapted continues, control didn't");
  });

  it("loss säger det rakt ut med minustecknet, utan firande", () => {
    const h = measuredHeadline("loss", -0.08, "conversion");
    expect(h.title).toBe("Not yet — -8%");
    expect(h.body).toContain("convert less");
    expect(h.celebrate).toBe(false);
  });

  it("okänt/inconclusive-domslut faller i den försiktiga grenen och firar aldrig", () => {
    expect(measuredHeadline(undefined, 0.5, "conversion").celebrate).toBe(false);
    expect(measuredHeadline("inconclusive", 0.5, "conversion").celebrate).toBe(false);
  });
});
