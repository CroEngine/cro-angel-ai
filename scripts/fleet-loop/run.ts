#!/usr/bin/env bun
// FLEET LOOP — the whole loop over the real ~100-site corpus on FABRICATED
// traffic, with a planted ground truth so every result is verifiable.
//
//   real site layer   docs/day0-sweep-final.json (inventory: trust/CTA/
//                     sections) + docs/adaptive-sweep-final.json (what the
//                     engine actually derived + applied per persona, restore-
//                     clean). Not fabricated — the live crawls.
//   fabricated data   a seeded population per site (mulberry32 from the name,
//                     so the run replays byte-identically). Cohort mix,
//                     window traffic, per-metric base rates nudged by the
//                     site's real trust density.
//   planted truth     each site is a winner / null / trap world (deterministic
//                     from its name) — the measurement MUST recover it.
//   the REAL loop     planCohortScopes → cohort-scoped rule → the real
//                     ruleMatches+assignBucket ramp → per-metric arms →
//                     evaluateRuleWithSpec → planGuardrailSweep. No mocks.
//
//   bun run scripts/fleet-loop/run.ts
//
// Writes docs/fleet-loop-2026-07-21/{results.json, fleet-summary.json}.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

import { mulberry32 } from "../sim-rng";
import { cohortKeysFromDims } from "../../src/adaptive/context";
import {
  planCohortScopes,
  segmentKeyForScope,
  cohortBriefLines,
  type CohortTrafficRow,
  type CohortScope,
} from "../../src/adaptive/redesign/cohort-scopes";
import {
  planGuardrailSweep,
  metricArmsFromRpc,
  type ArmsRpcRow,
} from "../../src/adaptive/redesign/guardrail-sweep";
import {
  defaultSuccessSpec,
  evaluateRuleWithSpec,
  estimateVerdictTime,
  type SuccessSpec,
} from "../../src/adaptive-lab/metrics";
import { ruleMatches, assignBucket, type AngelRule } from "../../src/adaptive-lab/rules";
import { ALPHA } from "../../src/adaptive-lab/measure";

const OUT_DIR = "docs/fleet-loop-2026-07-21";

// ── Real site layer ─────────────────────────────────────────────────────────
type Day0Row = {
  name: string;
  url: string;
  trust?: { total?: number };
  ctaSummary?: { total?: number; primary?: number; aboveFold?: number };
  sectionOrder?: string[];
  hero?: { primaryCtaIntent?: string };
};
type AdaptRow = {
  name: string;
  url: string;
  restoredClean?: boolean;
  inventory?: { trust: number; ctas: number; sections: number; hasPricing: boolean };
  runs?: Array<{ persona: string; derived: string; applied: Array<{ patternId: string }> }>;
};

const day0 = (JSON.parse(readFileSync("docs/day0-sweep-final.json", "utf8")).results as Day0Row[]) ?? [];
const adapt = (JSON.parse(readFileSync("docs/adaptive-sweep-final.json", "utf8")).results as AdaptRow[]) ?? [];
const day0By = new Map(day0.map((d) => [d.name, d]));

// FNV-1a → stable per-site seed (reproducible, no Date/Math.random).
function seedOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const METRICS = ["conversion", "cta_click", "engaged", "form_submit", "bounce", "deep_scroll"] as const;
type MetricId = (typeof METRICS)[number];
type Profile = "winner" | "null" | "trap";

// Cohort universe for the fabricated traffic (real trafficSource tokens the
// context mapping understands). Shares sum to 1.
const SOURCE_MIX: Array<{ src: string; share: number }> = [
  { src: "linkedin", share: 0.14 },
  { src: "google", share: 0.26 },
  { src: "facebook", share: 0.08 },
  { src: "bing", share: 0.05 },
  { src: "newsletter", share: 0.07 },
  { src: "reddit", share: 0.04 },
  { src: "direct", share: 0.36 },
];

type SiteResult = Record<string, unknown>;

function runSite(a: AdaptRow): SiteResult {
  const d = day0By.get(a.name);
  const rand = mulberry32(seedOf(a.name));
  const trust = a.inventory?.trust ?? d?.trust?.total ?? 0;
  const ctas = a.inventory?.ctas ?? d?.ctaSummary?.total ?? 0;
  const sections = a.inventory?.sections ?? d?.sectionOrder?.length ?? 0;

  // ── Fabricated window traffic: spread wide so some cohorts are measurable
  //    and some honestly are not. ~500 .. ~60 000 exposed visitors / 30 d. ──
  const exposed = Math.round(500 * Math.pow(10, rand() * 2.08));
  const returningShare = 0.18 + rand() * 0.22; // 18–40 %
  const pricingShare = 0.1 + rand() * 0.22; // 10–32 %

  // Per (src, returning, pricing) traffic rows for the scope planner.
  const rows: CohortTrafficRow[] = [];
  for (const m of SOURCE_MIX) {
    const n = Math.round(exposed * m.share);
    if (n <= 0) continue;
    const ret = Math.round(n * returningShare);
    const price = Math.round(n * pricingShare);
    // Four buckets; keep counts consistent (independent flags).
    rows.push({ traffic_source: m.src, is_returning: false, viewed_pricing: false, visitors: n - ret - price });
    rows.push({ traffic_source: m.src, is_returning: true, viewed_pricing: false, visitors: ret });
    rows.push({ traffic_source: m.src, is_returning: false, viewed_pricing: true, visitors: price });
  }

  // Primary base rate, nudged by real trust density (more proof → a touch more
  // conversion), bounded and honest.
  const trustLift = Math.min(0.02, trust * 0.0009);
  const base: Record<MetricId, number> = {
    conversion: 0.03 + rand() * 0.03 + trustLift, // ~3–8 %
    cta_click: 0.04 + rand() * 0.03,
    engaged: 0.36 + rand() * 0.2,
    form_submit: 0.02 + rand() * 0.025,
    bounce: 0.4 + rand() * 0.15,
    deep_scroll: 0.2 + rand() * 0.12,
  };

  // ── Planted profile (deterministic from the seed): winner / null / trap. ──
  const roll = rand();
  const profile: Profile = roll < 0.55 ? "winner" : roll < 0.77 ? "null" : "trap";

  // ── The REAL loop ────────────────────────────────────────────────────────
  // 1) Which cohorts are measurable — and on WHICH primary? The product picks
  //    conversion when a cohort can reach a verdict on it, else falls back to
  //    an engagement primary (the live test_metric='continuation' regime) —
  //    far higher base rate, so many more cohorts become measurable.
  const scopesFor = (baseRate: number) =>
    planCohortScopes(rows, { windowDays: 30, baseRate, mdeRel: 0.3, maxScopes: 8 });
  const srcScope = (ss: CohortScope[]) => ss.find((s) => segmentKeyForScope(s) !== null) ?? null;

  let primary: MetricId;
  let chosen: CohortScope | null;
  let scopes: CohortScope[];
  if (profile === "trap") {
    // The trap is a gamed proxy: the owner declared cta_click as primary.
    primary = "cta_click";
    scopes = scopesFor(base.cta_click);
    chosen = srcScope(scopes);
  } else {
    const convScopes = scopesFor(base.conversion);
    const convChosen = srcScope(convScopes);
    if (convChosen) {
      primary = "conversion";
      scopes = convScopes;
      chosen = convChosen;
    } else {
      primary = "engaged"; // continuation-style fallback
      scopes = scopesFor(base.engaged);
      chosen = srcScope(scopes);
    }
  }

  // Plant the effect on the CHOSEN primary (winner) / the proxy (trap).
  const effect: Partial<Record<MetricId, number>> = {};
  let planted = 0;
  if (profile === "winner") {
    // Effects a designer would actually ship — mostly at/above the MDE the
    // scope was sized for, so recovery is strong; the tail below it produces
    // honest underpowered misses (kept alive, never a false verdict).
    planted = primary === "conversion" ? 0.18 + rand() * 0.32 : 0.22 + rand() * 0.28;
    effect[primary] = planted;
    effect.bounce = -(0.02 + rand() * 0.06); // a genuine winner tends to help
    if (primary !== "engaged") effect.engaged = 0.03 + rand() * 0.06;
  } else if (profile === "trap") {
    effect.cta_click = 0.3 + rand() * 0.1; // proxy lifts
    effect.bounce = 0.18 + rand() * 0.06; // but chases visitors away
    effect.engaged = -(0.1 + rand() * 0.05);
    effect.conversion = 0; // the proxy is a lie
    planted = effect.cta_click;
  }
  // null: effect stays empty everywhere.

  const realPatterns = Array.from(
    new Set((a.runs ?? []).flatMap((r) => r.applied.map((p) => p.patternId))),
  );
  const derived = Array.from(new Set((a.runs ?? []).map((r) => r.derived)));

  const siteBase = {
    name: a.name,
    url: a.url,
    real: {
      trust,
      ctas,
      sections,
      restoredClean: a.restoredClean ?? null,
      appliedPatterns: realPatterns,
      derivedSegments: derived,
      heroIntent: d?.hero?.primaryCtaIntent ?? null,
    },
    fabricated: {
      exposedPer30d: exposed,
      returningShare: +returningShare.toFixed(2),
      pricingShare: +pricingShare.toFixed(2),
      baseRates: Object.fromEntries(
        (Object.keys(base) as MetricId[]).map((k) => [k, +base[k].toFixed(4)]),
      ),
    },
    primaryMetric: primary,
    planted: { profile, primaryEffectRel: +planted.toFixed(3), guardrailHarm: profile === "trap" },
    scopesMeasurable: scopes.map((s) => ({
      cohorts: s.cohorts,
      visitors: s.visitorsInWindow,
      days: s.estimatedDaysToVerdict,
      serveableAs: segmentKeyForScope(s),
    })),
  };

  if (!chosen) {
    return {
      ...siteBase,
      outcome: "no_measurable_cohort",
      note: "Ingen src:-kohort når domslut inom fönstret — ärligt utfall, inget A/B föreslås.",
      verify: { expected: profile, got: "no_variant", pass: true, reason: "not measurable" },
    };
  }

  // 2) the cohort-scoped, contracted rule — born gated exactly like the loop.
  //    Success contract follows the chosen primary; guardrails never include it.
  const spec: SuccessSpec =
    profile === "trap"
      ? { primary: "cta_click", guardrails: ["bounce", "engaged", "conversion"], mdeRel: 0.1 }
      : primary === "engaged"
        ? { primary: "engaged", guardrails: ["bounce", "conversion"], mdeRel: 0.1 }
        : defaultSuccessSpec("saas");
  const rule: AngelRule = {
    id: `${a.name}-cohort`,
    cohorts: chosen.cohorts,
    action: { kind: "pattern", patternId: realPatterns[0] ?? "trust_bar" },
    status: "approved",
    ramp: 50,
  };

  // 3) serve the chosen cohort's window population through the REAL machinery.
  const N = chosen.visitorsInWindow;
  const acc: Record<"variant" | "control", Record<MetricId, number> & { n: number }> = {
    variant: { n: 0, conversion: 0, cta_click: 0, engaged: 0, form_submit: 0, bounce: 0, deep_scroll: 0 },
    control: { n: 0, conversion: 0, cta_click: 0, engaged: 0, form_submit: 0, bounce: 0, deep_scroll: 0 },
  };
  const visitorCohorts = cohortKeysFromDims({
    trafficSource: segmentKeyForScope(chosen)!,
    isReturning: chosen.cohorts.some((c) => c === "ret:2plus"),
    viewedPricing: chosen.cohorts.some((c) => c === "seen:pricing"),
  });
  for (let i = 0; i < N; i++) {
    const key = `${a.name}-${i.toString(36)}`;
    // Real cohort gate + real ramp bucket.
    if (!ruleMatches(rule, visitorCohorts, null)) continue; // definitional, but exercised
    const served = assignBucket(key, rule.id) < (rule.ramp ?? 100);
    const arm = served ? acc.variant : acc.control;
    arm.n++;
    for (const metric of METRICS) {
      const e = served ? (effect[metric] ?? 0) : 0;
      const rate = Math.min(0.97, Math.max(0, base[metric] * (1 + e)));
      if (rand() < rate) arm[metric]++;
    }
  }

  // 4) arms in the RPC shape → the shared mapping → the calibrated ruling.
  const rpc: ArmsRpcRow[] = (["variant", "control"] as const).map((name) => {
    const s = acc[name];
    return {
      arm: name,
      visits: s.n,
      conversions: s.conversion,
      continuations: Math.max(0, s.n - s.bounce), // bounce = n − continuations
      cta_clicks: s.cta_click,
      form_submits: s.form_submit,
      engaged: s.engaged,
      deep_scrolls: s.deep_scroll,
    };
  });
  const arms = metricArmsFromRpc(rpc, "conversion");
  const ruling = arms ? evaluateRuleWithSpec(spec, arms) : null;

  // 5) the nightly guardrail sweep's decision on these live arms.
  const [sweep] = planGuardrailSweep([
    { id: rule.id, heldReason: null, success: spec, arms },
  ]);

  // ── Verify the planted truth was recovered ───────────────────────────────
  const verdict = ruling?.verdict ?? "inconclusive";
  const held = sweep?.action === "hold";
  let expected: string;
  let pass: boolean;
  let reason: string;
  if (profile === "winner") {
    expected = "win";
    if (verdict === "win") {
      pass = true;
      reason = "planted lift recovered";
    } else if (verdict === "loss" || held) {
      pass = false;
      reason = `FALSE HARM on a true winner (${verdict}${held ? "+hold" : ""})`;
    } else {
      pass = true;
      reason = `underpowered miss (${verdict}) — kept alive, not a false verdict`;
    }
  } else if (profile === "null") {
    expected = "no_effect";
    if (verdict === "win" || verdict === "loss" || held) {
      pass = false;
      reason = `FALSE POSITIVE on A/A (${verdict}${held ? "+hold" : ""})`;
    } else {
      pass = true;
      reason = `no fabricated effect (${verdict})`;
    }
  } else {
    expected = "guardrail hold";
    if (held) {
      pass = true;
      reason = `trap caught — ${sweep.action === "hold" ? sweep.reason : ""}`;
    } else {
      pass = false;
      reason = `TRAP ESCAPED (primary ${ruling?.primary.verdict}, sweep ${sweep?.action})`;
    }
  }

  return {
    ...siteBase,
    outcome: "measured",
    chosenScope: {
      cohorts: chosen.cohorts,
      serveableAs: segmentKeyForScope(chosen),
      visitorsInWindow: chosen.visitorsInWindow,
      daysToVerdict: chosen.estimatedDaysToVerdict,
      brief: cohortBriefLines(chosen),
    },
    variant: {
      id: rule.id,
      requiredCohorts: rule.cohorts,
      designSource: realPatterns.length ? realPatterns : ["(none applied for this site)"],
      success: spec,
    },
    measurement: {
      verdict,
      action: ruling?.action ?? "keep_measuring",
      primary: ruling
        ? {
            metric: spec.primary,
            upliftRel: ruling.primary.upliftRel,
            upliftRelCi: ruling.primary.upliftRelCi,
            pValue: +ruling.primary.pValue.toFixed(5),
            served: ruling.primary.served,
            holdout: ruling.primary.holdout,
          }
        : null,
      guardrails: ruling?.guardrails.map((g) => ({
        metric: g.metric,
        breached: g.breached,
        servedRate: +g.servedRate.toFixed(4),
        holdoutRate: +g.holdoutRate.toFixed(4),
      })),
    },
    guardrailSweep: { action: sweep?.action ?? "keep", reason: sweep?.action === "hold" ? sweep.reason : null },
    verify: { expected, got: held ? `${verdict}+hold` : verdict, pass, reason },
  };
}

function estimateVerdictSanity() {
  // A tiny self-check the report can cite: the same math the cards show.
  const e = estimateVerdictTime({ dailyMatchedVisitors: 300, baseRate: 0.04, mdeRel: 0.3 });
  return { nPerArm: e.nPerArm, days: e.days };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const results = adapt.map(runSite);

  // ── Fleet calibration ────────────────────────────────────────────────────
  const measured = results.filter((r) => r.outcome === "measured");
  const byProfile = (p: Profile) => results.filter((r) => (r.planted as { profile: string }).profile === p);
  const winners = byProfile("winner");
  const nulls = byProfile("null");
  const traps = byProfile("trap");
  const measuredOf = (rs: SiteResult[]) => rs.filter((r) => r.outcome === "measured");

  const winMeasured = measuredOf(winners);
  const winRecovered = winMeasured.filter((r) => (r.measurement as { verdict: string }).verdict === "win").length;
  const winFalseHarm = winMeasured.filter((r) => !(r.verify as { pass: boolean }).pass).length;
  const nullMeasured = measuredOf(nulls);
  const nullFP = nullMeasured.filter((r) => !(r.verify as { pass: boolean }).pass).length;
  const trapMeasured = measuredOf(traps);
  const trapCaught = trapMeasured.filter((r) => (r.guardrailSweep as { action: string }).action === "hold").length;
  const trapEscaped = trapMeasured.filter((r) => !(r.verify as { pass: boolean }).pass).length;

  const daysDist = measured
    .map((r) => (r.chosenScope as { daysToVerdict: number }).daysToVerdict)
    .sort((a, b) => a - b);
  const median = daysDist.length ? daysDist[Math.floor(daysDist.length / 2)] : null;

  const summary = {
    generatedFrom: "fleet-loop over the committed sweep corpus; traffic fabricated, site layer real",
    sites: results.length,
    outcomes: {
      measured: measured.length,
      noMeasurableCohort: results.filter((r) => r.outcome === "no_measurable_cohort").length,
    },
    planted: { winner: winners.length, null: nulls.length, trap: traps.length },
    calibration: {
      winner: {
        measurable: winMeasured.length,
        recoveredWin: winRecovered,
        recoveryPower: winMeasured.length ? +(winRecovered / winMeasured.length).toFixed(3) : null,
        falseHarm: winFalseHarm,
      },
      null: {
        measurable: nullMeasured.length,
        falsePositives: nullFP,
        fpRate: nullMeasured.length ? +(nullFP / nullMeasured.length).toFixed(3) : null,
      },
      trap: {
        measurable: trapMeasured.length,
        caughtAndHeld: trapCaught,
        catchRate: trapMeasured.length ? +(trapCaught / trapMeasured.length).toFixed(3) : null,
        escaped: trapEscaped,
      },
    },
    daysToVerdict: { min: daysDist[0] ?? null, median, max: daysDist[daysDist.length - 1] ?? null },
    // A calibration VIOLATION is the math misbehaving: a true winner falsely
    // harmed, a trap that escaped, or a null-FP rate meaningfully above alpha.
    // A single A/A tripping at ~alpha is calibration CONFIRMED, not a failure —
    // and the sweep pauses it (safe direction, self-heals). Distinguish them.
    calibration_note:
      "null false-positives at ~alpha are EXPECTED and confirm calibration; only excess FPs, winner false-harm, or trap escapes are violations",
    calibrationViolations:
      winFalseHarm + trapEscaped + Math.max(0, nullFP - Math.ceil(2 * ALPHA * nullMeasured.length)),
    calibrationHealthy:
      winFalseHarm === 0 &&
      trapEscaped === 0 &&
      (nullMeasured.length === 0 || nullFP / nullMeasured.length <= 2 * ALPHA),
    estimateVerdictSanity: estimateVerdictSanity(),
  };

  writeFileSync(`${OUT_DIR}/results.json`, JSON.stringify(results, null, 1));
  writeFileSync(`${OUT_DIR}/fleet-summary.json`, JSON.stringify(summary, null, 2));

  // ── Console narrative ─────────────────────────────────────────────────────
  console.log(`Fleet loop over ${results.length} real sites (traffic fabricated, planted truth):\n`);
  console.log(`  measured ${measured.length} · no measurable cohort ${summary.outcomes.noMeasurableCohort}`);
  console.log(
    `  winners:  ${winRecovered}/${winMeasured.length} recovered (power ${(100 * (summary.calibration.winner.recoveryPower ?? 0)).toFixed(0)}%), false-harm ${winFalseHarm}`,
  );
  console.log(
    `  nulls:    ${nullFP}/${nullMeasured.length} false-positive (${(100 * (summary.calibration.null.fpRate ?? 0)).toFixed(1)}%)`,
  );
  console.log(
    `  traps:    ${trapCaught}/${trapMeasured.length} caught+held, escaped ${trapEscaped}`,
  );
  console.log(`  days-to-verdict: min ${daysDist[0]} · median ${median} · max ${daysDist[daysDist.length - 1]}`);
  console.log(
    `  calibration ${summary.calibrationHealthy ? "HEALTHY" : "VIOLATED"} · violations ${summary.calibrationViolations} (null FPs at ~alpha are expected, not violations)`,
  );
  console.log(`\n→ ${OUT_DIR}/results.json + fleet-summary.json`);
  // Surface every A/A that tripped — expected at ~alpha, and the sweep pauses it.
  for (const r of nullMeasured.filter((x) => !(x.verify as { pass: boolean }).pass)) {
    console.log(`  null A/A tripped (expected ~alpha): ${r.name} — ${(r.verify as { reason: string }).reason} → sweep held it (safe)`);
  }
}

main();
