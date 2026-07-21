// Guardrail-svepets planerare — hold vid skada, självläkning, aldrig röra
// andras stopp, aldrig agera på tystnad.
import { describe, expect, it } from "vitest";

import {
  GUARDRAIL_HOLD_PREFIX,
  metricArmsFromRpc,
  planGuardrailSweep,
} from "../guardrail-sweep";

const rpc = (over: Partial<Record<string, number>> = {}) => [
  { arm: "variant", visits: 5000, conversions: 250, continuations: 2600,
    cta_clicks: 300, form_submits: 40, engaged: over.vEng ?? 2000, ...{} },
  { arm: "control", visits: 5000, conversions: over.cConv ?? 250, continuations: over.cCont ?? 2600,
    cta_clicks: 300, form_submits: 40, engaged: over.cEng ?? 2000 },
];

describe("metricArmsFromRpc", () => {
  it("bygger katalogarmarna; bounce = gick aldrig vidare", () => {
    const arms = metricArmsFromRpc(rpc(), "conversion")!;
    expect(arms.bounce.served).toEqual({ n: 5000, conversions: 2400 });
    expect(arms.conversion.served.conversions).toBe(250);
  });
  it("continuation-läget matar primären med 'gick vidare'", () => {
    const arms = metricArmsFromRpc(rpc(), "continuation")!;
    expect(arms.conversion.served.conversions).toBe(2600);
  });
  it("null när båda armarna är tomma", () => {
    expect(metricArmsFromRpc([], "conversion")).toBeNull();
  });
});

describe("planGuardrailSweep", () => {
  const spec = { primary: "conversion", guardrails: ["bounce", "engaged"] };

  it("håller varianten när ett skyddsmått skadats signifikant", () => {
    // Variantarmen tappar engagemang brant: 2000 → kontroll 2600 (z ≈ 12).
    const arms = metricArmsFromRpc(rpc({ vEng: 2000, cEng: 2600 }), "conversion");
    const [a] = planGuardrailSweep([{ id: "v1", heldReason: null, success: spec, arms }]);
    expect(a).toEqual({ id: "v1", action: "hold", reason: `${GUARDRAIL_HOLD_PREFIX}engaged` });
  });

  it("släpper sitt eget hold när skadan läkt — och bara sitt eget", () => {
    const healthy = metricArmsFromRpc(rpc(), "conversion");
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
    const arms = metricArmsFromRpc(rpc({ vEng: 2000, cEng: 2600 }), "conversion");
    const [a] = planGuardrailSweep([
      { id: "v1", heldReason: `${GUARDRAIL_HOLD_PREFIX}engaged`, success: spec, arms },
    ]);
    expect(a.action).toBe("keep");
  });

  it("signifikant primärförlust håller också — skadan är skäl nog", () => {
    const arms = metricArmsFromRpc(rpc({ cConv: 350 }), "conversion"); // 5% vs 7%
    const [a] = planGuardrailSweep([{ id: "v1", heldReason: null, success: spec, arms }]);
    expect(a).toEqual({ id: "v1", action: "hold", reason: `${GUARDRAIL_HOLD_PREFIX}primary-loss` });
  });
});
