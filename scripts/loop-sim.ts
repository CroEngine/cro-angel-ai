#!/usr/bin/env bun
// E5 LOOP SIMULATION — the whole product cycle on fabricated data, with a
// PLANTED ground truth the measurement must find (and nothing more).
//
//   population  30 000 seeded synthetic visitors: cohort mix with distinct
//               behavior (the "hitta på data" step)
//   aggregate   per-cohort stats — the designer-brief data E3 wants
//   serve       through the REAL rule machinery (ruleMatches + assignBucket
//               at ramp 50) — no mocks
//   truth       sentry-proof-linkedin: +30% RELATIVE conversion, planted.
//               search-null-control: ZERO effect (A/A) — the trap.
//   measure     the REAL measureRule math. Must call the win where +30% is
//               hidden, no_effect where nothing is, and never serve the
//               unapproved rule.
//   calibrate   200 seeds: false-positive rate on the null ≈ alpha, power on
//               the planted effect — the numbers that say the math can be
//               trusted before any real visitor.
//   E5 tick     writes rules-measured.json + the next designer brief snippet.
//
//   bun run scripts/loop-sim.ts

import { writeFileSync, mkdirSync } from "node:fs";

import { mulberry32 } from "./sim-rng";

import { assignBucket, ruleMatches, type AngelRule } from "../src/adaptive/rules";
import { measureRule, ALPHA, type ArmStats } from "../src/adaptive/measure";

const OUT_DIR =
  "/tmp/claude-0/-home-user-cro-angel-ai/c11460d4-452b-5901-aaf1-829bf613facc/scratchpad/loop-sim";
const RUN_DIR = "docs/designer-runs/2026-07-21";

// Deterministic RNG — the whole simulation replays byte-identically per seed.

type SimVisitor = {
  key: string;
  cohorts: string[];
  scroll: number;
  clickedCta: boolean;
  baseConv: number;
};

// Cohort universes with DISTINCT fabricated behavior — the differences the
// aggregation step must surface for the designer brief.
const COHORT_MIX = [
  { key: "linkedin", share: 0.35, cohorts: ["ch:social", "src:linkedin"], scrollMean: 74, ctaRate: 0.022, baseConv: 0.04 },
  { key: "google", share: 0.3, cohorts: ["ch:search", "src:google"], scrollMean: 55, ctaRate: 0.045, baseConv: 0.05 },
  { key: "direct", share: 0.35, cohorts: ["ch:direct"], scrollMean: 48, ctaRate: 0.05, baseConv: 0.045 },
] as const;
const SEEN_PRICING_SHARE = 0.25;

const RULES: AngelRule[] = [
  {
    id: "sentry-proof-linkedin",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "reorder_proof_first" },
    status: "approved",
    ramp: 50,
  },
  {
    id: "search-null-control",
    cohorts: ["src:google"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "approved",
    ramp: 50,
  },
  {
    id: "never-approved",
    cohorts: ["src:linkedin"],
    action: { kind: "pattern", patternId: "trust_bar" },
    status: "proposed",
  },
];

// PLANTED TRUTH — what the measurement must recover.
const TRUE_RELATIVE_EFFECT: Record<string, number> = {
  "sentry-proof-linkedin": 0.3,
  "search-null-control": 0,
};

const POPULATION = 30_000;

function makePopulation(rand: () => number): SimVisitor[] {
  const out: SimVisitor[] = [];
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
    const cohorts = [...mix.cohorts, rand() < 0.3 ? "ret:2plus" : "ret:new"];
    if (rand() < SEEN_PRICING_SHARE) cohorts.push("seen:pricing");
    out.push({
      key: `sim-${i.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`,
      cohorts,
      scroll: Math.max(5, Math.min(100, mix.scrollMean + (rand() - 0.5) * 40)),
      clickedCta: rand() < mix.ctaRate,
      baseConv: mix.baseConv,
    });
  }
  return out;
}

type Assignment = { served: boolean };

function runOnce(seed: number) {
  const rand = mulberry32(seed);
  const pop = makePopulation(rand);

  // Serve through the REAL machinery.
  const arms = new Map<string, { served: ArmStats; holdout: ArmStats }>();
  const assign = new Map<string, Map<string, Assignment>>();
  for (const rule of RULES) {
    arms.set(rule.id, { served: { n: 0, conversions: 0 }, holdout: { n: 0, conversions: 0 } });
    assign.set(rule.id, new Map());
  }
  let unapprovedServed = 0;

  for (const v of pop) {
    // Conversion probability: base, lifted only by rules that actually SERVE
    // this visitor and carry a planted effect.
    let rate = v.baseConv;
    for (const rule of RULES) {
      if (!ruleMatches(rule, v.cohorts, null)) continue;
      const ramp = rule.ramp === undefined ? 100 : rule.ramp;
      const served = assignBucket(v.key, rule.id) < ramp;
      if (rule.status !== "approved") {
        if (served) unapprovedServed++;
        continue;
      }
      assign.get(rule.id)!.set(v.key, { served });
      if (served) rate = rate * (1 + (TRUE_RELATIVE_EFFECT[rule.id] ?? 0));
    }
    const converted = rand() < rate;
    for (const rule of RULES) {
      const a = assign.get(rule.id)!.get(v.key);
      if (!a) continue;
      const arm = a.served ? arms.get(rule.id)!.served : arms.get(rule.id)!.holdout;
      arm.n++;
      if (converted) arm.conversions++;
    }
  }

  const results = RULES.filter((r) => r.status === "approved").map((rule) => ({
    rule,
    measured: measureRule(arms.get(rule.id)!.served, arms.get(rule.id)!.holdout),
  }));
  return { pop, results, unapprovedServed };
}

function aggregate(pop: SimVisitor[]) {
  const byCohort = new Map<string, { n: number; scrollSum: number; clicks: number; seenPricing: number }>();
  for (const v of pop) {
    const src = v.cohorts.find((c) => c.startsWith("src:")) ?? v.cohorts.find((c) => c.startsWith("ch:"))!;
    const row = byCohort.get(src) ?? { n: 0, scrollSum: 0, clicks: 0, seenPricing: 0 };
    row.n++;
    row.scrollSum += v.scroll;
    if (v.clickedCta) row.clicks++;
    if (v.cohorts.indexOf("seen:pricing") !== -1) row.seenPricing++;
    byCohort.set(src, row);
  }
  return Array.from(byCohort.entries()).map(([cohort, r]) => ({
    cohort,
    visitors: r.n,
    avgScrollPct: Math.round(r.scrollSum / r.n),
    ctaClickRate: +(r.clicks / r.n).toFixed(4),
    seenPricingShare: +(r.seenPricing / r.n).toFixed(3),
  }));
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── Main run: one seed, full narrative ────────────────────────────────
  const seed0 = 42;
  const { pop, results, unapprovedServed } = runOnce(seed0);
  const agg = aggregate(pop);

  console.log("Per-cohort aggregates (the designer-brief data):");
  for (const row of agg) {
    console.log(
      `  ${row.cohort.padEnd(13)} n=${String(row.visitors).padStart(6)} · scroll ${row.avgScrollPct}% · CTA ${(row.ctaClickRate * 100).toFixed(1)}% · seen pricing ${(row.seenPricingShare * 100).toFixed(0)}%`,
    );
  }

  console.log("\nPlanted truth vs measured verdict (seed 42):");
  const verdictRows: Array<Record<string, unknown>> = [];
  let ok = true;
  for (const { rule, measured } of results) {
    const planted = TRUE_RELATIVE_EFFECT[rule.id] ?? 0;
    const expected = planted > 0 ? "win" : "no_effect";
    const pass = measured.verdict === expected;
    ok = ok && pass;
    console.log(
      `  ${pass ? "PASS" : "FAIL"} ${rule.id.padEnd(24)} planted ${planted > 0 ? "+" + planted * 100 + "% rel" : "ZERO"} → ` +
        `measured ${measured.verdict} (uplift ${(100 * (measured.upliftRel ?? 0)).toFixed(1)}% rel, p=${measured.pValue.toFixed(4)}, ` +
        `served ${measured.served.n}/${measured.served.conversions}c vs holdout ${measured.holdout.n}/${measured.holdout.conversions}c)`,
    );
    verdictRows.push({ ruleId: rule.id, planted, ...measured });
  }
  console.log(`  ${unapprovedServed === 0 ? "PASS" : "FAIL"} unapproved rule served ${unapprovedServed} visitors (must be 0)`);
  ok = ok && unapprovedServed === 0;

  // ── Calibration: does the math hold across many worlds? ───────────────
  const SEEDS = 200;
  let nullFalsePositives = 0;
  let truePositives = 0;
  let nullVerdicts = 0;
  let trueVerdicts = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const { results: r } = runOnce(s);
    for (const { rule, measured } of r) {
      const planted = TRUE_RELATIVE_EFFECT[rule.id] ?? 0;
      if (planted === 0) {
        nullVerdicts++;
        if (measured.verdict === "win" || measured.verdict === "loss") nullFalsePositives++;
      } else {
        trueVerdicts++;
        if (measured.verdict === "win") truePositives++;
      }
    }
  }
  const fpRate = nullFalsePositives / nullVerdicts;
  const power = truePositives / trueVerdicts;
  console.log(`\nCalibration over ${SEEDS} seeds:`);
  console.log(
    `  null rule (A/A): false-positive rate ${(fpRate * 100).toFixed(1)}% (alpha ${(ALPHA * 100).toFixed(0)}% — must be in the same neighbourhood)`,
  );
  console.log(`  planted +30%:   power ${(power * 100).toFixed(1)}% (should comfortably exceed 80%)`);
  const calOk = fpRate <= ALPHA * 2 && power >= 0.8;
  ok = ok && calOk;
  console.log(`  ${calOk ? "PASS" : "FAIL"} calibration gates`);

  // ── E5 tick: measured results flow back into the artifacts ────────────
  const measuredRules = results.map(({ rule, measured }) => ({
    ...rule,
    measured: {
      verdict: measured.verdict,
      upliftRel: measured.upliftRel,
      pValue: +measured.pValue.toFixed(5),
      served: measured.served,
      holdout: measured.holdout,
      simulated: true,
      seed: seed0,
    },
  }));
  writeFileSync(`${RUN_DIR}/rules-measured.json`, JSON.stringify(measuredRules, null, 1));

  const nextBrief = {
    generatedFrom: "loop-sim seed 42 (fabricated population, planted truth)",
    cohortAggregates: agg,
    ruleOutcomes: measuredRules.map((r) => ({
      ruleId: r.id,
      cohorts: r.cohorts,
      verdict: r.measured.verdict,
      upliftRel: r.measured.upliftRel,
    })),
    designerGuidance:
      "Iterate on winners (extend proof-first to adjacent cohorts?), retire or redesign no_effect rules, propose for cohorts with engagement but no rule yet (direct: high CTA, no treatment).",
  };
  writeFileSync(`${OUT_DIR}/next-designer-brief.json`, JSON.stringify(nextBrief, null, 1));
  writeFileSync(`${OUT_DIR}/sim-report.json`, JSON.stringify({ agg, verdictRows, fpRate, power }, null, 1));

  console.log(`\nE5 tick → ${RUN_DIR}/rules-measured.json + ${OUT_DIR}/next-designer-brief.json`);
  if (!ok) {
    console.error("\nLOOP SIM FAILED");
    process.exit(1);
  }
  console.log("loop sim: all assertions pass");
}

main();
