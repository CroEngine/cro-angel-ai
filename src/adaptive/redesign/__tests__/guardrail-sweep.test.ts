// Guardrail-svepets planerare — hold vid skada, självläkning, aldrig röra
// andras stopp, aldrig agera på tystnad.
import { describe, expect, it } from "vitest";

import { GUARDRAIL_HOLD_PREFIX, metricArmsFromRpc, planGuardrailSweep } from "../guardrail-sweep";

const rpc = (over: Partial<Record<string, number>> = {}) => [
  // bounces lika i bägge armarna: bounce är guardrail i specen nedan, och en
  // skillnad här hade tyst ändrat vad de befintliga svep-testerna mäter.
  {
    arm: "variant",
    visits: 5000,
    conversions: 250,
    continuations: 2600,
    cta_clicks: 300,
    form_submits: 40,
    engaged: over.vEng ?? 2000,
    bounces: over.vBounce ?? 1500,
  },
  {
    arm: "control",
    visits: 5000,
    conversions: over.cConv ?? 250,
    continuations: over.cCont ?? 2600,
    cta_clicks: 300,
    form_submits: 40,
    engaged: over.cEng ?? 2000,
    deep_scrolls: 900,
    bounces: over.cBounce ?? 1500,
  },
];

describe("metricArmsFromRpc", () => {
  it("bygger katalogarmarna; VARJE post bär sitt eget mått", () => {
    const arms = metricArmsFromRpc(rpc())!;
    expect(arms.conversion.served.conversions).toBe(250);
    expect(arms.continuation.served.conversions).toBe(2600);
    expect(arms.bounce.served).toEqual({ n: 5000, conversions: 1500 });
    expect(arms.deep_scroll.holdout).toEqual({ n: 5000, conversions: 900 });
  });

  it("kartan skriver ALDRIG om conversion-posten (annars blir guardrailen en attrapp)", () => {
    // Tidigare bytte continuation-läget ut conversion mot continuation-tal.
    // Kartan slås upp på katalog-id, så en sajt med conversion som GUARDRAIL
    // fick sin guardrail dömd på fel data. Primärvalet hör hos anroparen.
    const arms = metricArmsFromRpc(rpc())!;
    expect(arms.conversion.served.conversions).not.toBe(arms.continuation.served.conversions);
  });

  it("saknad bounce-kolumn (äldre RPC) blir 0, aldrig en gissning", () => {
    const noBounce = rpc().map((r) => {
      const { bounces: _drop, ...rest } = r as Record<string, unknown>;
      return rest as typeof r;
    });
    expect(metricArmsFromRpc(noBounce)!.bounce.served.conversions).toBe(0);
  });
  it("null när båda armarna är tomma", () => {
    expect(metricArmsFromRpc([])).toBeNull();
  });
});

describe("planGuardrailSweep", () => {
  const spec = { primary: "conversion", guardrails: ["bounce", "engaged"] };

  it("håller varianten när ett skyddsmått skadats signifikant", () => {
    // Variantarmen tappar engagemang brant: 2000 → kontroll 2600 (z ≈ 12).
    const arms = metricArmsFromRpc(rpc({ vEng: 2000, cEng: 2600 }));
    const [a] = planGuardrailSweep([{ id: "v1", heldReason: null, success: spec, arms }]);
    expect(a).toEqual({ id: "v1", action: "hold", reason: `${GUARDRAIL_HOLD_PREFIX}engaged` });
  });

  it("släpper sitt eget hold när skadan läkt — och bara sitt eget", () => {
    const healthy = metricArmsFromRpc(rpc());
    const [ours] = planGuardrailSweep([
      { id: "v1", heldReason: `${GUARDRAIL_HOLD_PREFIX}engaged`, success: spec, arms: healthy },
    ]);
    expect(ours.action).toBe("release");
    const [theirs] = planGuardrailSweep([
      { id: "v2", heldReason: "drift:priset ändrades", success: spec, arms: healthy },
    ]);
    expect(theirs.action).toBe("keep");
  });

  it("agerar aldrig på tystnad: inga armar ⇒ keep, även för eget hold", () => {
    const [a] = planGuardrailSweep([
      { id: "v1", heldReason: `${GUARDRAIL_HOLD_PREFIX}engaged`, success: spec, arms: null },
    ]);
    expect(a.action).toBe("keep");
  });

  it("idempotent: samma orsak igen ⇒ keep, inte nytt hold", () => {
    const arms = metricArmsFromRpc(rpc({ vEng: 2000, cEng: 2600 }));
    const [a] = planGuardrailSweep([
      { id: "v1", heldReason: `${GUARDRAIL_HOLD_PREFIX}engaged`, success: spec, arms },
    ]);
    expect(a.action).toBe("keep");
  });

  it("signifikant primärförlust håller också — skadan är skäl nog", () => {
    const arms = metricArmsFromRpc(rpc({ cConv: 350 })); // 5% vs 7%
    const [a] = planGuardrailSweep([{ id: "v1", heldReason: null, success: spec, arms }]);
    expect(a).toEqual({ id: "v1", action: "hold", reason: `${GUARDRAIL_HOLD_PREFIX}primary-loss` });
  });
});
