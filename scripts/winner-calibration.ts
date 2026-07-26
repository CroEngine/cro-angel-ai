#!/usr/bin/env bun
// WINNER CALIBRATION — the trust number for the honest-A/B verdict.
//
// winner.test.ts proves the verdict LOGIC on hand-picked cases (a clean win, a
// dead control, a sinking-goal proxy, a degraded secondary…). What unit tests
// can't show is the RATE: over many random draws from a KNOWN ground truth, how
// often does the production evaluator (evaluateWinnerWithGuards — the exact call
// the dashboard + promotion gate use) declare a FALSE winner, and how often does
// it CATCH a real one? That is what a customer's "you only pay when it's real"
// promise actually rests on.
//
// Five planted worlds, each drawn N times with a seeded RNG (binomial arms), all
// run through the REAL evaluator. Pure logic — zero credits, no network.
//
//   A/A null      goal 5.0% vs 5.0%              → recommend_winner is a FALSE POSITIVE
//   true win      goal 6.5% vs 5.0% (+30% rel)   → recommend_winner is a CATCH
//   marginal      goal 5.2% vs 5.0% (+4% rel)    → recommend_winner would be over-calling
//                                                   a below-practical-threshold lift
//   secondary harm goal +30% BUT engaged 40% vs 55% → recommend_winner is an ESCAPE
//   gamed proxy   continuation 60% vs 50% BUT goal 3% vs 5% → recommend_winner is an ESCAPE
//
//   bun run scripts/winner-calibration.ts [trials=500] [seedBase=1000]

import { mulberry32 } from "./sim-rng";

import {
  evaluateWinnerWithGuards,
  type GuardArmCounts,
} from "../src/adaptive/redesign/winner";

const TRIALS = Number(process.argv[2] ?? 500);
const SEED_BASE = Number(process.argv[3] ?? 1000);

/** One binomial draw: k successes in n trials at probability p. */
function binom(n: number, p: number, rnd: () => number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rnd() < p) k++;
  return k;
}

interface World {
  name: string;
  metric: "conversion" | "continuation";
  visits: number;
  /** goal, continuation, engaged success-probabilities per arm. */
  v: { goal: number; cont: number; eng: number };
  c: { goal: number; cont: number; eng: number };
  /** The outcome that means the verdict did its job on THIS world. */
  want: "recommend_winner" | "not_winner";
  /** Label for the "wrong" tally. */
  wrongLabel: string;
}

const WORLDS: World[] = [
  {
    name: "A/A null",
    metric: "conversion",
    visits: 3000,
    v: { goal: 0.05, cont: 0.6, eng: 0.6 },
    c: { goal: 0.05, cont: 0.6, eng: 0.6 },
    want: "not_winner",
    wrongLabel: "FALSE POSITIVE (declared a winner on A/A)",
  },
  {
    name: "true win +30%",
    metric: "conversion",
    visits: 3000,
    v: { goal: 0.065, cont: 0.6, eng: 0.6 },
    c: { goal: 0.05, cont: 0.6, eng: 0.6 },
    want: "recommend_winner",
    wrongLabel: "MISS (failed to catch a real winner)",
  },
  {
    name: "marginal +4%",
    metric: "conversion",
    visits: 3000,
    v: { goal: 0.052, cont: 0.6, eng: 0.6 },
    c: { goal: 0.05, cont: 0.6, eng: 0.6 },
    want: "not_winner",
    wrongLabel: "OVER-CALL (winner on a below-practical lift)",
  },
  {
    name: "secondary harm",
    metric: "conversion",
    visits: 3000,
    v: { goal: 0.065, cont: 0.6, eng: 0.4 }, // goal up, but engagement down 40% vs 55%
    c: { goal: 0.05, cont: 0.6, eng: 0.55 },
    want: "not_winner",
    wrongLabel: "ESCAPE (winner despite degraded engagement)",
  },
  {
    name: "gamed proxy",
    metric: "continuation",
    visits: 3000,
    v: { goal: 0.03, cont: 0.6, eng: 0.6 }, // proxy up (60 vs 50) but GOAL sinks (3% vs 5%)
    c: { goal: 0.05, cont: 0.5, eng: 0.6 },
    want: "not_winner",
    wrongLabel: "ESCAPE (proxy win over a sinking goal)",
  },
];

const draw = (v: World["v"], visits: number, rnd: () => number): GuardArmCounts => ({
  visits,
  conversions: binom(visits, v.goal, rnd),
  continuations: binom(visits, v.cont, rnd),
  engaged: binom(visits, v.eng, rnd),
});

function winnerPctOf(w: World, visits: number): { winnerPct: number; dist: string } {
  const tally: Record<string, number> = {};
  for (let t = 0; t < TRIALS; t++) {
    const rnd = mulberry32(SEED_BASE + t * 7919 + w.name.length + visits);
    const ev = evaluateWinnerWithGuards(draw(w.v, visits, rnd), draw(w.c, visits, rnd), w.metric);
    tally[ev.outcome] = (tally[ev.outcome] ?? 0) + 1;
  }
  const dist = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");
  return { winnerPct: ((tally["recommend_winner"] ?? 0) / TRIALS) * 100, dist };
}

console.log(`WC| winner calibration — ${TRIALS} trials/world, production evaluateWinnerWithGuards`);
console.log(`WC|`);
console.log(`WC| DON'T-LIE guarantees (must stay ≤ tolerance): the "you only pay when it's real" promise`);
// The trust bars that MUST hold: the verdict must not declare a winner when the
// truth is no-real-win. A/A false-positive + secondary/proxy escapes ≤ 5%; the
// marginal +4% over-call ≤ 6% (a true sub-threshold-but-positive lift occasionally
// reading as ≥5% is the inherent noise floor of thresholding observed data).
let allOk = true;
for (const w of WORLDS.filter((x) => x.want === "not_winner")) {
  const { winnerPct, dist } = winnerPctOf(w, w.visits);
  const tol = w.name === "marginal +4%" ? 6 : 5;
  const ok = winnerPct <= tol;
  if (!ok) allOk = false;
  console.log(
    `WC|   ${w.name.padEnd(16)} ${w.wrongLabel.padEnd(48)} ${winnerPct.toFixed(1)}% (≤${tol})  ${ok ? "OK" : "FAIL"}  [${dist}]`,
  );
}
console.log(`WC|`);
console.log(`WC| POWER curve (catch is not pass/fail — it RISES with n; the verdict waits rather than guesses)`);
// A real +30% win: the evaluator only calls it once the sample is statistically
// powered — proof it does not guess early, and that it DOES catch when the
// evidence arrives. Catch must reach ≥95% at a fully-powered n.
const trueWin = WORLDS.find((x) => x.name === "true win +30%")!;
let poweredCatch = 0;
for (const n of [1500, 3000, 6000, 12000]) {
  const { winnerPct } = winnerPctOf(trueWin, n);
  poweredCatch = winnerPct;
  console.log(`WC|   +30% real lift @ ${String(n).padStart(6)} visits/arm → catch ${winnerPct.toFixed(1)}%`);
}
const powerOk = poweredCatch >= 95;
if (!powerOk) allOk = false;
console.log(`WC|   catch @ 12000 ≥95%: ${powerOk ? "OK" : "FAIL"} (a powered real winner is reliably caught)`);
console.log(`WC|`);
console.log(
  `WC| VERDICT: ${allOk ? "TRUSTWORTHY — never lies within bars, and catches real winners once powered" : "OUT OF BARS — see FAIL rows"}`,
);
process.exit(allOk ? 0 : 1);
