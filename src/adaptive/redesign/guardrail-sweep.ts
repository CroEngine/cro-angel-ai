// Guardrail-svepet — nattloopens RENA planerare för kontraktsskydden
// (samma idiom som drift.ts: pure + deterministisk, ägarens status rörs
// aldrig, allt maskinellt går via held_reason och läker själv).
//
// Varje natt döms varje servande variants LIVE-armar mot dess framgångs-
// kontrakt med den kalibrerade matten (evaluateRuleWithSpec — bevisad med
// planterade fällor över 200 världar, docs/metric-hierarchy.md):
//
//   * guardrail_breach eller signifikant primärförlust → hold: skada på
//     riktiga besökare stoppas av maskinen, inte av att ägaren råkar logga
//     in. Grindarna (300/arm, ensidigt alfa 1 %) gör falska stopp sällsynta
//     (~1 % per variant med två guardrails) — och ett falskt stopp är den
//     billiga riktningen.
//   * vårt eget guardrail-hold + inte längre brott → release (självläkning,
//     exakt som drift-svepets källa-läkt).
//   * någon ANNANS hold (drift) → keep — vi rör aldrig andras stopp.
//   * inga armar/för lite data → keep — frånvaro av bevis är inte skada.

import {
  defaultSuccessSpec,
  evaluateRuleWithSpec,
  validateSuccessSpec,
} from "../../adaptive-lab/metrics";
import type { ArmStats } from "../../adaptive-lab/measure";

export const GUARDRAIL_HOLD_PREFIX = "guardrail:";

/** En rad ur angel_variant_arms-RPC:n (typad löst — servern äger schemat). */
export interface ArmsRpcRow {
  arm: string;
  visits: number | string;
  conversions: number | string;
  continuations: number | string;
  cta_clicks?: number | string;
  form_submits?: number | string;
  engaged?: number | string;
  deep_scrolls?: number | string;
  /** Bounce-kolumnen (migration 20260815100000). Valfri: äldre RPC-svar
   *  saknar den, och då faller bounce-armen tillbaka på 0 i stället för att
   *  krascha — ett omätt mått ska bli "för lite data", aldrig en gissning. */
  bounces?: number | string;
}

export type MetricArms = Record<string, { served: ArmStats; holdout: ArmStats }>;

/**
 * EN sanning för hur RPC-raderna blir per-metrik-armar (metrikkatalogens
 * id:n) — dashboarden och svepet delar den här. Primärens dataflöde följer
 * sajtens test_metric (continuation-läget räknar "gick vidare" som
 * conversion, precis som abTest). bounce = gick aldrig vidare.
 */
export function metricArmsFromRpc(rows: ArmsRpcRow[]): MetricArms | null {
  const armOf = (name: string) => {
    const r = rows.find((x) => x.arm === name);
    return {
      n: Number(r?.visits) || 0,
      conv: Number(r?.conversions) || 0,
      cont: Number(r?.continuations) || 0,
      clicks: Number(r?.cta_clicks) || 0,
      forms: Number(r?.form_submits) || 0,
      eng: Number(r?.engaged) || 0,
      deep: Number(r?.deep_scrolls) || 0,
      bounced: Number(r?.bounces) || 0,
    };
  };
  const v = armOf("variant");
  const c = armOf("control");
  if (v.n + c.n === 0) return null;
  const pair = (sv: number, sn: number, hv: number, hn: number) => ({
    served: { n: sn, conversions: sv },
    holdout: { n: hn, conversions: hv },
  });
  // VARJE post bär sitt EGET mått. Tidigare tog testMetric-parametern och
  // skrev om `conversion`-posten till continuation-siffror i continuation-
  // läge — men kartan slås upp på metrikkatalogens id:n, så en sajt vars
  // kontrakt hade "conversion" som GUARDRAIL fick då sin guardrail dömd på
  // fel data. Primärvalet hör hemma hos anroparen (evaluateWinnerWithGuards),
  // inte i kartan. Rättat 2026-08-15 när konvertering blev guardrail för
  // bounce-sajter — utan det hade skyddet varit en attrapp.
  return {
    conversion: pair(v.conv, v.n, c.conv, c.n),
    continuation: pair(v.cont, v.n, c.cont, c.n),
    bounce: pair(v.bounced, v.n, c.bounced, c.n),
    engaged: pair(v.eng, v.n, c.eng, c.n),
    cta_click: pair(v.clicks, v.n, c.clicks, c.n),
    form_submit: pair(v.forms, v.n, c.forms, c.n),
    deep_scroll: pair(v.deep, v.n, c.deep, c.n),
  };
}

export interface GuardrailSweepVariant {
  id: string;
  heldReason: string | null;
  /** Rått kontrakt ur DB — valideras här; ogiltigt/saknat ⇒ sajtstandarden. */
  success: unknown;
  arms: MetricArms | null;
}

export type GuardrailSweepAction =
  | { id: string; action: "hold"; reason: string }
  | { id: string; action: "release" }
  | { id: string; action: "keep" };

export function planGuardrailSweep(variants: GuardrailSweepVariant[]): GuardrailSweepAction[] {
  return variants.map((v) => {
    const ours = v.heldReason?.startsWith(GUARDRAIL_HOLD_PREFIX) ?? false;
    if (!v.arms) {
      // Ingen data. Ett eget hold står kvar tills data visar läkning —
      // att släppa på tystnad vore att gissa.
      return { id: v.id, action: "keep" } as const;
    }
    const spec = validateSuccessSpec(v.success) ?? defaultSuccessSpec();
    const ruling = evaluateRuleWithSpec(spec, v.arms);
    const breached = ruling.guardrails.filter((g) => g.breached).map((g) => g.metric);
    const harmful = ruling.verdict === "guardrail_breach" || ruling.verdict === "loss";
    if (harmful) {
      const label = ruling.verdict === "loss" ? "primary-loss" : breached.join("+") || "breach";
      const reason = `${GUARDRAIL_HOLD_PREFIX}${label}`;
      // Idempotent: samma orsak ⇒ keep; ny orsak eller ohållen ⇒ hold.
      if (v.heldReason === reason) return { id: v.id, action: "keep" } as const;
      if (v.heldReason && !ours) return { id: v.id, action: "keep" } as const; // annans hold
      return { id: v.id, action: "hold", reason } as const;
    }
    if (ours) return { id: v.id, action: "release" } as const; // läkt
    return { id: v.id, action: "keep" } as const;
  });
}
