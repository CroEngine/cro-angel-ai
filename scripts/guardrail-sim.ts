#!/usr/bin/env bun
// GUARDRAIL SIM — proves the metric HIERARCHY (one primary, few guardrails,
// everything else diagnostics) on fabricated data with planted traps.
//
// Three planted worlds, all served through the REAL rule machinery:
//   clean    proof-first-linkedin: conversion +30%, bounce/engagement improve
//            → must rule WIN / extend.
//   null     null-control-google: zero everywhere (A/A)
//            → must rule no_effect, no breach — and its 20 junk dashboard
//            metrics show WHY free-for-all metric mining lies.
//   trap     popup-teaser-direct: primary is a PROXY (cta_click +35%) but
//            bounce +20% and engagement −12% — the gamed-proxy case.
//            Primary alone says "win"; the hierarchy must say PAUSE.
//
// Calibration re-runs every world across 200 seeds: guardrail catch rate,
// escape rate, false-pause rates, dashboard-fallacy rate.
//
//   bun run scripts/guardrail-sim.ts [narrativeSeed=42]

import { writeFileSync, mkdirSync } from "node:fs";

import { assignBucket, ruleMatches, type AngelRule } from "../src/adaptive/rules";
import {
  ALPHA,
  GUARDRAIL_ALPHA,
  evaluateRuleMetrics,
  measureRule,
  type ArmStats,
  type MetricDirection,
  type RuleRuling,
} from "../src/adaptive/measure";

const OUT_DIR =
  "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad/guardrail-sim";
const RUN_DIR = "docs/designer-runs/2026-07-21";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-visitor binary metrics. Drawn independently — real bounce/conversion
// correlate, but each guardrail/primary test is marginal per metric, so the
// demonstration is unaffected (noted honestly in docs/metric-hierarchy.md).
const METRICS = ["conversion", "bounce", "cta_click", "engaged"] as const;
type MetricId = (typeof METRICS)[number];

const COHORT_MIX = [
  {
    key: "linkedin",
    share: 0.35,
    cohorts: ["ch:social", "src:linkedin"],
    base: { conversion: 0.04, bounce: 0.42, cta_click: 0.05, engaged: 0.52 },
  },
  {
    key: "google",
    share: 0.3,
    cohorts: ["ch:search", "src:google"],
    base: { conversion: 0.05, bounce: 0.48, cta_click: 0.045, engaged: 0.4 },
  },
  {
    key: "direct",
    share: 0.35,
    cohorts: ["ch:direct"],
    base: { conversion: 0.045, bounce: 0.45, cta_click: 0.05, engaged: 0.38 },
  },
] as const;

const RULES: AngelRule[] = [
  {
    id: "proof-first-linkedin",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "reorder_proof_first" },
    status: "approved",
    ramp: 50,
  },
  {
    id: "null-control-google",
    cohorts: ["src:google"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "approved",
    ramp: 50,
  },
  {
    id: "popup-teaser-direct",
    cohorts: ["ch:direct"],
    action: { kind: "pattern", patternId: "emphasize_primary_cta" },
    status: "approved",
    ramp: 50,
  },
];

// The success definition PER RULE — declared up front, as it would be on the
// approval card. The trap rule's primary is a PROXY, with conversion demoted
// to a guardrail: exactly the configuration that needs protecting.
const SPEC: Record<
  string,
  { primary: MetricId; guardrails: Array<{ metric: MetricId; direction: MetricDirection }> }
> = {
  "proof-first-linkedin": {
    primary: "conversion",
    guardrails: [
      { metric: "bounce", direction: "down" },
      { metric: "engaged", direction: "up" },
    ],
  },
  "null-control-google": {
    primary: "conversion",
    guardrails: [
      { metric: "bounce", direction: "down" },
      { metric: "engaged", direction: "up" },
    ],
  },
  "popup-teaser-direct": {
    primary: "cta_click",
    guardrails: [
      { metric: "bounce", direction: "down" },
      { metric: "engaged", direction: "up" },
      { metric: "conversion", direction: "up" },
    ],
  },
};

// PLANTED TRUTH — relative effect on served visitors, per rule per metric.
const TRUE_EFFECT: Record<string, Partial<Record<MetricId, number>>> = {
  "proof-first-linkedin": { conversion: 0.3, bounce: -0.08, engaged: 0.08 },
  "null-control-google": {},
  "popup-teaser-direct": { cta_click: 0.35, bounce: 0.2, engaged: -0.12 }, // conversion: ZERO — the proxy is a lie
};

// The dashboard fallacy: 20 metrics nobody pre-declared, all with ZERO
// planted effect, evaluated on the null rule's own arms as if each were
// allowed to call wins at the primary's alpha.
const JUNK_COUNT = 20;
const junkBase = (i: number) => 0.08 + i * 0.022;

const POPULATION = 30_000;

type Arms = { served: ArmStats; holdout: ArmStats };
const newArms = (): Arms => ({ served: { n: 0, conversions: 0 }, holdout: { n: 0, conversions: 0 } });

type SimOutcome = {
  rulings: Record<string, RuleRuling>;
  trapPrimaryAlone: "win" | "loss" | "no_effect" | "inconclusive";
  junkVerdicts: Array<"win" | "loss" | "no_effect" | "inconclusive">;
};

function runOnce(seed: number): SimOutcome {
  const rand = mulberry32(seed);
  const metricArms = new Map<string, Record<MetricId, Arms>>();
  const junkArms: Arms[] = Array.from({ length: JUNK_COUNT }, newArms);
  for (const rule of RULES) {
    metricArms.set(rule.id, {
      conversion: newArms(),
      bounce: newArms(),
      cta_click: newArms(),
      engaged: newArms(),
    });
  }

  for (let i = 0; i < POPULATION; i++) {
    const r = rand();
    let acc = 0;
    let mix: (typeof COHORT_MIX)[number] = COHORT_MIX[0];
    for (const m of COHORT_MIX) {
      acc += m.share;
      if (r <= acc) {
        mix = m;
        break;
      }
    }
    const key = `sim-${i.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;

    for (const rule of RULES) {
      if (!ruleMatches(rule, [...mix.cohorts], null)) continue;
      const ramp = rule.ramp === undefined ? 100 : rule.ramp;
      const served = assignBucket(key, rule.id) < ramp;
      const effects = served ? TRUE_EFFECT[rule.id] : {};
      const arms = metricArms.get(rule.id)!;
      for (const metric of METRICS) {
        const rate = Math.min(0.95, mix.base[metric] * (1 + (effects[metric] ?? 0)));
        const hit = rand() < rate;
        const arm = served ? arms[metric].served : arms[metric].holdout;
        arm.n++;
        if (hit) arm.conversions++;
      }
      if (rule.id === "null-control-google") {
        for (let j = 0; j < JUNK_COUNT; j++) {
          const hit = rand() < junkBase(j); // zero effect in BOTH arms
          const arm = served ? junkArms[j].served : junkArms[j].holdout;
          arm.n++;
          if (hit) arm.conversions++;
        }
      }
    }
  }

  const rulings: Record<string, RuleRuling> = {};
  for (const rule of RULES) {
    const spec = SPEC[rule.id];
    const arms = metricArms.get(rule.id)!;
    rulings[rule.id] = evaluateRuleMetrics(spec.primary, arms[spec.primary], [
      ...spec.guardrails.map((g) => ({ ...g, ...arms[g.metric] })),
    ]);
  }
  const trapArms = metricArms.get("popup-teaser-direct")!;
  const trapPrimaryAlone = measureRule(trapArms.cta_click.served, trapArms.cta_click.holdout).verdict;
  const junkVerdicts = junkArms.map((a) => measureRule(a.served, a.holdout).verdict);
  return { rulings, trapPrimaryAlone, junkVerdicts };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const narrativeSeed = Number(process.argv[2] ?? 42);
  let ok = true;
  const gate = (pass: boolean, label: string) => {
    console.log(`  ${pass ? "PASS" : "FAIL"} ${label}`);
    ok = ok && pass;
  };
  // Per-seed verdicts on probabilistic outcomes are EXPECTATIONS, not gates:
  // a single world can land in the calibrated miss band (1−power) or the FP
  // band (alpha) without anything being wrong. The contract is calibration.
  const expectLine = (matched: boolean, label: string, note: string) => {
    console.log(`  ${matched ? "OK  " : "NOTE"} ${label}${matched ? "" : ` — ${note}`}`);
  };

  // ── Narrative run ─────────────────────────────────────────────────────
  console.log(`Narrative run (seed ${narrativeSeed}) — planted truth vs hierarchy ruling:\n`);
  const one = runOnce(narrativeSeed);
  const fmtCi = (ci: [number, number] | null) =>
    ci ? `${(100 * ci[0]).toFixed(0)}%…${(100 * ci[1]).toFixed(0)}%` : "n/a";

  const clean = one.rulings["proof-first-linkedin"];
  console.log(`  proof-first-linkedin   planted: conversion +30%, guardrails genuinely improve`);
  console.log(
    `    ruling: ${clean.verdict} → ${clean.action} (primary p=${clean.primary.pValue.toFixed(4)}, uplift ${(100 * (clean.primary.upliftRel ?? 0)).toFixed(1)}% rel, CI ${fmtCi(clean.primary.upliftRelCi)})`,
  );
  expectLine(
    clean.verdict === "win" && clean.action === "extend",
    "expected win/extend",
    `this world landed in the miss band (1−power; see calibration) — MDE layer must keep it alive, got "${clean.action}"`,
  );
  // Hard floor even in an unlucky world: a true winner may NEVER be retired
  // or paused by noise — keep_measuring is the worst allowed outcome.
  gate(
    clean.action === "extend" || clean.action === "keep_measuring",
    "clean winner never retired/paused by an unlucky world",
  );

  const nul = one.rulings["null-control-google"];
  console.log(`\n  null-control-google    planted: ZERO everywhere (A/A)`);
  console.log(
    `    ruling: ${nul.verdict} → ${nul.action} (primary p=${nul.primary.pValue.toFixed(4)}, CI ${fmtCi(nul.primary.upliftRelCi)})`,
  );
  expectLine(
    (nul.verdict === "no_effect" || nul.verdict === "inconclusive") && !nul.guardrails.some((g) => g.breached),
    "expected no_effect (or inconclusive), no breach",
    `this world landed in a calibrated tail band, got "${nul.verdict}"`,
  );
  const junkSig = one.junkVerdicts.filter((v) => v === "win" || v === "loss").length;
  console.log(
    `    the same rule's 20-metric dashboard (naive, alpha ${ALPHA}): ${junkSig} metric(s) "significant" by luck alone`,
  );

  const trap = one.rulings["popup-teaser-direct"];
  console.log(`\n  popup-teaser-direct    planted: cta_click +35% (proxy) BUT bounce +20%, engaged −12%, conversion ±0`);
  console.log(`    primary alone would say: ${one.trapPrimaryAlone}${one.trapPrimaryAlone === "win" ? " — would have shipped" : ""}`);
  console.log(
    `    hierarchy ruling: ${trap.verdict} → ${trap.action} (${trap.guardrails
      .filter((g) => g.breached)
      .map((g) => `${g.metric} z=${g.z.toFixed(1)}`)
      .join(", ")})`,
  );
  // Hard gate: the planted harm is ~9σ on bounce — missing it would mean the
  // guardrail machinery itself is broken, not an unlucky draw.
  gate(trap.verdict === "guardrail_breach" && trap.action === "pause", "trap PAUSED, not shipped");

  // ── Calibration: the same worlds, 200 times ───────────────────────────
  const SEEDS = 200;
  let cleanWins = 0;
  let cleanKept = 0;
  let cleanRetiredOrPaused = 0;
  let nullPrimaryFp = 0;
  let nullFalseBreach = 0;
  let trapCaught = 0;
  let trapEscapedCleanWin = 0;
  let trapNaiveWin = 0;
  let dashboardFooled = 0;
  let junkSigTotal = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const r = runOnce(s);
    const c = r.rulings["proof-first-linkedin"];
    if (c.verdict === "win") cleanWins++;
    if (c.action === "keep_measuring") cleanKept++;
    if (c.action === "retire_or_redesign" || c.action === "pause") cleanRetiredOrPaused++;
    const n = r.rulings["null-control-google"];
    if (n.primary.verdict === "win" || n.primary.verdict === "loss") nullPrimaryFp++;
    if (n.verdict === "guardrail_breach") nullFalseBreach++;
    const t = r.rulings["popup-teaser-direct"];
    if (t.verdict === "guardrail_breach") trapCaught++;
    if (t.verdict === "win") trapEscapedCleanWin++;
    if (r.trapPrimaryAlone === "win") trapNaiveWin++;
    const sig = r.junkVerdicts.filter((v) => v === "win" || v === "loss").length;
    junkSigTotal += sig;
    if (sig > 0) dashboardFooled++;
  }
  const pct = (x: number) => `${((100 * x) / SEEDS).toFixed(1)}%`;
  const junkFp = junkSigTotal / (SEEDS * JUNK_COUNT);

  console.log(`\nCalibration over ${SEEDS} seeds:`);
  console.log(
    `  clean winner:  win/extend ${pct(cleanWins)}, missed→keep_measuring ${pct(cleanKept)}, wrongly retired/paused ${pct(cleanRetiredOrPaused)}`,
  );
  console.log(
    `  null (A/A):    primary FP ${pct(nullPrimaryFp)} (alpha ${ALPHA}), false-pause ${pct(nullFalseBreach)} (2 guardrails @ one-sided ${GUARDRAIL_ALPHA})`,
  );
  console.log(
    `  trap:          caught+paused ${pct(trapCaught)}, escaped as clean win ${pct(trapEscapedCleanWin)}; primary-alone would have shipped it ${pct(trapNaiveWin)}`,
  );
  console.log(
    `  dashboard:     ≥1 fake "significant" among 20 junk metrics in ${pct(dashboardFooled)} of worlds (theory ≈ 1−0.95^20 = 64%); per-metric FP ${(100 * junkFp).toFixed(1)}%`,
  );
  console.log("");
  gate(cleanWins / SEEDS >= 0.75, "clean win power ≥ 75%");
  gate(
    cleanRetiredOrPaused / SEEDS <= 0.02,
    "true winner wrongly retired/paused ≤ 2% (unlucky worlds land in keep_measuring)",
  );
  gate(nullPrimaryFp / SEEDS <= ALPHA * 2, "null primary FP ≤ 2×alpha");
  gate(nullFalseBreach / SEEDS <= 0.05, "null false-pause ≤ 5%");
  gate(trapCaught / SEEDS >= 0.98, "trap caught ≥ 98%");
  gate(trapEscapedCleanWin === 0, "trap NEVER escapes as clean win");
  gate(trapNaiveWin / SEEDS >= 0.9, "…while primary-alone would ship it ≥ 90% (the fallacy is real)");
  gate(dashboardFooled / SEEDS >= 0.3, "dashboard mining fooled ≥ 30% of worlds (why hierarchy exists)");
  gate(junkFp >= 0.02 && junkFp <= 0.08, "junk per-metric FP ≈ alpha (math sane)");

  // ── Artifacts ─────────────────────────────────────────────────────────
  const report = {
    narrativeSeed,
    rulings: one.rulings,
    trapPrimaryAlone: one.trapPrimaryAlone,
    calibration: {
      seeds: SEEDS,
      cleanWinPower: cleanWins / SEEDS,
      cleanMissedKeptMeasuring: cleanKept / SEEDS,
      cleanWronglyRetiredOrPaused: cleanRetiredOrPaused / SEEDS,
      nullPrimaryFp: nullPrimaryFp / SEEDS,
      nullFalsePause: nullFalseBreach / SEEDS,
      trapCaught: trapCaught / SEEDS,
      trapEscapedCleanWin: trapEscapedCleanWin / SEEDS,
      trapNaiveWin: trapNaiveWin / SEEDS,
      dashboardFooledRate: dashboardFooled / SEEDS,
      junkPerMetricFp: junkFp,
    },
  };
  writeFileSync(`${OUT_DIR}/report-seed${narrativeSeed}.json`, JSON.stringify(report, null, 1));
  if (narrativeSeed === 42) {
    const ruled = RULES.map((rule) => ({
      ...rule,
      successSpec: SPEC[rule.id],
      ruling: {
        verdict: one.rulings[rule.id].verdict,
        action: one.rulings[rule.id].action,
        reason: one.rulings[rule.id].reason,
        guardrails: one.rulings[rule.id].guardrails.map((g) => ({
          metric: g.metric,
          breached: g.breached,
          servedRate: +g.servedRate.toFixed(4),
          holdoutRate: +g.holdoutRate.toFixed(4),
        })),
        simulated: true,
        seed: narrativeSeed,
      },
    }));
    writeFileSync(`${RUN_DIR}/rules-ruled.json`, JSON.stringify(ruled, null, 1));
    console.log(`\nruling artifact → ${RUN_DIR}/rules-ruled.json`);
  }

  if (!ok) {
    console.error("\nGUARDRAIL SIM FAILED");
    process.exit(1);
  }
  console.log("guardrail sim: all assertions pass");
}

main();
