// Delade dashboard-hjälpare — talformat, arm-statistik och statuspiller för
// Overview-panelen och dess overlays (utbrutna ur overview-panel.tsx i
// sajt-genomgången 2026-07-18; ren flytt, ingen semantikändring).

import { armStatValid, twoProportionZ } from "@/lib/dashboard/aggregate";
import { isDimsPrefix, segmentDims, segmentKeysRelated } from "@/lib/segment-key";

import type { VariantView } from "@/lib/dashboard/dashboard.functions";

export const fmt = (n: number) => n.toLocaleString("en-US");
export const pct = (r: number, digits = 1) => `${(r * 100).toFixed(digits)}%`;

/** Ensidig normal-CDF ur z — "sannolikheten att liften är äkta". Abramowitz–
 *  Stegun-approximation; samma tal-art som vinnar-utvärderarens grindar. */
export function probFromZ(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? p : 1 - p;
}

export interface Arms {
  variant: { visits: number; conversions: number };
  control: { visits: number; conversions: number };
}

/** Summera armarna över en uppsättning servande/vinnande varianter. */
export function sumArms(variants: VariantView[]): Arms | null {
  const live = variants.filter(
    (v) => (v.status === "serving" || v.status === "winner") && v.abTest,
  );
  if (live.length === 0) return null;
  const acc: Arms = {
    variant: { visits: 0, conversions: 0 },
    control: { visits: 0, conversions: 0 },
  };
  for (const v of live) {
    acc.variant.visits += v.abTest!.variant.visits;
    acc.variant.conversions += v.abTest!.variant.conversions;
    acc.control.visits += v.abTest!.control.visits;
    acc.control.conversions += v.abTest!.control.conversions;
  }
  return acc;
}

export interface ArmVerdict {
  state: "observing" | "insufficient" | "measured";
  liftRel: number | null;
  prob: number | null;
  arms: Arms | null;
}

export function judgeArms(arms: Arms | null): ArmVerdict {
  if (!arms) return { state: "observing", liftRel: null, prob: null, arms: null };
  const ok =
    armStatValid(arms.variant.visits, arms.variant.conversions) &&
    armStatValid(arms.control.visits, arms.control.conversions);
  const crV = arms.variant.visits > 0 ? arms.variant.conversions / arms.variant.visits : 0;
  const crC = arms.control.visits > 0 ? arms.control.conversions / arms.control.visits : 0;
  const liftRel = crC > 0 ? (crV - crC) / crC : null;
  if (!ok) return { state: "insufficient", liftRel, prob: null, arms };
  const z = twoProportionZ(
    arms.variant.conversions,
    arms.variant.visits,
    arms.control.conversions,
    arms.control.visits,
  );
  return { state: "measured", liftRel, prob: z === null ? null : probFromZ(z), arms };
}

/** Finaste servande/vinnande variant vars segmentnyckel är prefix av `key`
 *  (samma lån-styrka-regel som serve-vägen). */
export function variantFor(variants: VariantView[], key: string): VariantView | null {
  const dims = segmentDims(key);
  let best: VariantView | null = null;
  for (const v of variants) {
    if (v.status !== "serving" && v.status !== "winner") continue;
    const vd = segmentDims(v.segmentKey);
    if (!isDimsPrefix(vd, dims)) continue;
    if (!best || vd.length > segmentDims(best.segmentKey).length) best = v;
  }
  return best;
}

/** Uppmätt lift för en trädnod: bara när en variant serverar EXAKT den nyckeln. */
export function liftForKey(variants: VariantView[], key: string): number | null {
  const v = variantFor(variants, key);
  if (!v?.abTest || v.segmentKey !== key) return null;
  return judgeArms({ variant: v.abTest.variant, control: v.abTest.control }).liftRel;
}

/** Varianterna som hör till ett val: nyckeln själv, allt under den, och den
 *  grövre variant som faktiskt serverar hit (lånad styrka). */
export function scopedVariants(variants: VariantView[], key: string): VariantView[] {
  return variants.filter((v) => {
    if (v.status !== "verified" && v.status !== "serving" && v.status !== "winner") return false;
    return segmentKeysRelated(v.segmentKey, key);
  });
}

export const KIND_BY_DEPTH = ["Channel", "Device", "Country", "Visitor type"];

export const STATUS_PILL: Record<string, { bg: string; color: string }> = {
  verified: { bg: "#eff6ff", color: "#3730a3" },
  serving: { bg: "#ecfdf5", color: "#047857" },
  winner: { bg: "#d1fae5", color: "#065f46" },
};

/** Visningsöversättning av segment-tokens: nycklarna (lagrade i variant-
 *  segment_keys och byggda av aggregatets rollup) behåller sina tokens —
 *  bara ETIKETTEN blir engelska. */
export const TOKEN_EN: Record<string, string> = {
  okänd: "unknown",
  ny: "new",
  återkommande: "returning",
};
export const enLabel = (label: string) =>
  label
    .split(" · ")
    .map((t) => TOKEN_EN[t] ?? t)
    .join(" · ");

export const liftFmt = (liftRel: number | null) =>
  liftRel != null ? `${liftRel > 0 ? "+" : ""}${(liftRel * 100).toFixed(0)}%` : "—";
