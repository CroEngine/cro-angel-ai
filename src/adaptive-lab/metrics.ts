// Angel Adaptive — METRICS: the catalog of what a site can be "after".
//
// A site cares about hundreds of outcomes; the measurement machinery accepts
// any binary per-visitor event. This module is where that breadth becomes a
// CONTRACT: a fixed catalog of well-defined metrics (each with the direction
// that is good and where it is observed), site-type presets, and the
// SuccessSpec — the rule-level declaration "judge me on THIS, protect THESE"
// that the owner approves together with the change itself. The hierarchy it
// feeds (one primary, guardrails that can only pause) is proven with planted
// traps in `scripts/guardrail-sim.ts` / docs/metric-hierarchy.md.

import {
  MDE_REL,
  MIN_ARM_N,
  evaluateRuleMetrics,
  type ArmStats,
  type MetricDirection,
  type RuleRuling,
} from "./measure";

export type MetricSource =
  | "client" // observable by the snippet on the page (events)
  | "profile" // derived from the first-party journey profile
  | "goal" // owner-declared goal (data-goal-click / data-goal-url) or goal join
  | "collector"; // needs session stitching server-side (e.g. bounce)

export type MetricDef = {
  id: string;
  label: string; // owner-facing (Swedish — the approval card language)
  direction: MetricDirection; // which way is GOOD
  source: MetricSource;
  baseRateHint: number; // typical base rate, for time-to-verdict estimates
};

export const METRIC_CATALOG: MetricDef[] = [
  { id: "conversion", label: "Konvertering (sajtens mål)", direction: "up", source: "goal", baseRateHint: 0.04 },
  { id: "form_submit", label: "Formulär skickat", direction: "up", source: "client", baseRateHint: 0.03 },
  { id: "cta_click", label: "Klick på primär CTA", direction: "up", source: "client", baseRateHint: 0.05 },
  { id: "pricing_view", label: "Sett prissidan", direction: "up", source: "profile", baseRateHint: 0.12 },
  { id: "engaged", label: "Engagerad (≥60 % scroll eller ≥30 s)", direction: "up", source: "client", baseRateHint: 0.4 },
  { id: "deep_scroll", label: "Läst djupt (≥80 % scroll)", direction: "up", source: "client", baseRateHint: 0.25 },
  { id: "return_visit", label: "Återkommit (≥2 besök)", direction: "up", source: "profile", baseRateHint: 0.2 },
  // Bounce = besökaren gjorde INGENTING: en sida, inga klick, varken 60 %
  // scroll eller 30 s. Tröskeltalen är samma som engaged/continuation redan
  // använder, negerade — måtten kan aldrig säga emot varandra. baseRateHint
  // är MÄTT (glutenforum, 1 503 besökare, 2026-08-15), inte gissad; GA:s
  // "en sida"-definition ger 92 % på samma data och är därför oduglig som
  // beslutsmått, se migration 20260815100000.
  { id: "bounce", label: "Bounce (en sida, inga klick, inte engagerad)", direction: "down", source: "collector", baseRateHint: 0.57 },
];

export function metricById(id: string): MetricDef | null {
  for (const m of METRIC_CATALOG) if (m.id === id) return m;
  return null;
}

// The rule-level success declaration — what the owner approves alongside the
// change. Primary decides win/loss; guardrails can only pause.
export type SuccessSpec = {
  primary: string; // metric id from the catalog
  guardrails: string[]; // metric ids, max 4, never the primary itself
  mdeRel?: number; // smallest relative effect the site cares about
};

export type SiteType = "saas" | "leadgen" | "ecommerce" | "content";

// Sensible defaults per site type — a starting point on the card, not a
// verdict; the owner can change any of it before approving.
export const SITE_TYPE_PRESETS: Record<SiteType, SuccessSpec> = {
  saas: { primary: "conversion", guardrails: ["bounce", "engaged"] },
  leadgen: { primary: "form_submit", guardrails: ["bounce", "engaged"] },
  ecommerce: { primary: "conversion", guardrails: ["bounce", "engaged"] },
  // Innehållssajter mäter på bounce (ägarbeslut 2026-08-15): den har högst
  // varians av allt vi kan observera (≈57 % mot engagerads 40 %) och ger
  // därmed flest domslut per besökare. Konvertering blir GUARDRAIL, inte
  // borttagen: den kostar ingenting när den saknar events, men fångar den
  // dag ett bounce-lyft rider över sjunkande mål.
  content: { primary: "bounce", guardrails: ["conversion", "engaged"] },
};

export function defaultSuccessSpec(siteType: SiteType = "saas"): SuccessSpec {
  const p = SITE_TYPE_PRESETS[siteType];
  return { primary: p.primary, guardrails: [...p.guardrails], mdeRel: MDE_REL };
}

const MAX_GUARDRAILS = 4;

/**
 * Validate + normalize a success spec (rules can arrive over the network).
 * Unknown metric ids or a broken shape → null (the rule is rejected).
 * Normalization: guardrails deduped, primary removed from them, capped at 4.
 */
export function validateSuccessSpec(raw: unknown): SuccessSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.primary !== "string" || !metricById(r.primary)) return null;
  if (!Array.isArray(r.guardrails)) return null;
  const guardrails: string[] = [];
  for (const g of r.guardrails) {
    if (typeof g !== "string" || !metricById(g)) return null;
    if (g === r.primary || guardrails.indexOf(g) !== -1) continue;
    guardrails.push(g);
  }
  if (guardrails.length > MAX_GUARDRAILS) return null;
  if (r.mdeRel !== undefined && (typeof r.mdeRel !== "number" || r.mdeRel <= 0 || r.mdeRel > 1))
    return null;
  const out: SuccessSpec = { primary: r.primary, guardrails };
  if (r.mdeRel !== undefined) out.mdeRel = r.mdeRel as number;
  return out;
}

/**
 * How long until this rule can reach a verdict? Standard two-proportion
 * sample size at 80% power / alpha 5% for the declared MDE, then divided by
 * the traffic that actually lands in the smaller arm. This is what makes the
 * proxy-vs-conversion trade concrete on the approval card: an engagement
 * primary reaches a verdict ~20× sooner than a 4% conversion primary.
 */
export function estimateVerdictTime(input: {
  dailyMatchedVisitors: number;
  baseRate: number;
  mdeRel?: number;
  ramp?: number; // percent served, default 50
}): { nPerArm: number; days: number } {
  const mde = input.mdeRel ?? MDE_REL;
  const ramp = input.ramp ?? 50;
  const p = Math.min(0.95, Math.max(0.001, input.baseRate));
  const zAlpha = 1.959964; // two-sided 5%
  const zBeta = 0.841621; // 80% power
  const nRaw = ((zAlpha + zBeta) ** 2 * 2 * p * (1 - p)) / (p * mde) ** 2;
  const nPerArm = Math.max(MIN_ARM_N, Math.ceil(nRaw));
  const armShare = Math.max(0.01, Math.min(ramp, 100 - ramp) / 100);
  const perDay = Math.max(1, input.dailyMatchedVisitors * armShare);
  return { nPerArm, days: Math.ceil(nPerArm / perDay) };
}

// ── Client-side metric derivation ──────────────────────────────────────────
//
// What the snippet can decide about THIS pageview from its own observations.
// Structural input types so the same function runs over live buffers, stored
// events, and tests. `bounce` is deliberately absent: it is a session-level
// fact (did a SECOND page ever come?) the collector derives — the snippet
// ships the ingredients (pageview, session id, time, clicks).

export const ENGAGED_SCROLL_PCT = 60;
export const ENGAGED_MS = 30_000;
export const DEEP_SCROLL_PCT = 80;

type MetricEvent = { type: string; value?: number };
type MetricProfile = { seenPricing?: boolean; visits?: number } | null | undefined;

export function deriveViewMetrics(
  events: ReadonlyArray<MetricEvent>,
  profile?: MetricProfile,
): Record<string, boolean> {
  let ctaClick = false;
  let formSubmit = false;
  let goal = false;
  let maxScroll = 0;
  let timeMs = 0;
  for (const e of events) {
    if (e.type === "cta_click") ctaClick = true;
    else if (e.type === "form_submit") formSubmit = true;
    else if (e.type === "goal") goal = true;
    else if (e.type === "scroll_depth" && typeof e.value === "number")
      maxScroll = Math.max(maxScroll, e.value);
    else if (e.type === "time_on_page" && typeof e.value === "number")
      timeMs = Math.max(timeMs, e.value);
  }
  return {
    conversion: goal,
    form_submit: formSubmit,
    cta_click: ctaClick,
    engaged: maxScroll >= ENGAGED_SCROLL_PCT || timeMs >= ENGAGED_MS,
    deep_scroll: maxScroll >= DEEP_SCROLL_PCT,
    pricing_view: !!profile?.seenPricing,
    return_visit: (profile?.visits ?? 0) >= 2,
  };
}

/**
 * The bridge from a rule's declared SuccessSpec to a ruling: guardrail
 * directions come from the catalog (single source of truth), MDE from the
 * spec. A metric with no data yet contributes empty arms — the gates make
 * that "not enough data", never a fabricated verdict.
 */
export function evaluateRuleWithSpec(
  spec: SuccessSpec,
  arms: Record<string, { served: ArmStats; holdout: ArmStats } | undefined>,
): RuleRuling {
  const empty = (): { served: ArmStats; holdout: ArmStats } => ({
    served: { n: 0, conversions: 0 },
    holdout: { n: 0, conversions: 0 },
  });
  const primaryArms = arms[spec.primary] ?? empty();
  const guardrailArms = spec.guardrails.map((id) => {
    const def = metricById(id);
    return {
      metric: id,
      direction: (def?.direction ?? "up") as MetricDirection,
      ...(arms[id] ?? empty()),
    };
  });
  return evaluateRuleMetrics(spec.primary, primaryArms, guardrailArms, {
    mdeRel: spec.mdeRel,
  });
}
