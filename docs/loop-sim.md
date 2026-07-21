# E5-sim — the whole loop on fabricated data, with a planted truth

**Date:** 2026-07-21 · **Script:** `scripts/loop-sim.ts` (pure bun, no browser)
**Math:** `src/adaptive/measure.ts` (10 unit tests) · **Serving:** the REAL
`ruleMatches` + `assignBucket` from `src/adaptive/rules.ts` — no mocks

## Why this exists

The user's framing, taken literally: real visitors are only needed for ONE
question — *after we create a new design, does it convert better?* Everything
else in the loop can be proven **now** by fabricating data and checking the
system recovers what we planted. So this simulation runs the full cycle —

```
fabricate population → aggregate per cohort (designer-brief data)
      → serve through the real rule machinery (ramp 50, deterministic holdout)
      → plant a ground-truth effect on one rule, zero on another
      → measure with the real math → verdicts must match the plant
      → write rules-measured.json + the next designer brief   (the E5 tick)
```

If the loop cannot find an effect we planted ourselves, it has no business
claiming effects on real visitors. This is the pre-flight for the measurement
spine, run to completion before a single real pageview is on the line.

## The fabricated world

30 000 seeded visitors (mulberry32 — byte-identical replay per seed), three
cohorts with deliberately distinct behavior, 25% having seen pricing:

| cohort | share | scroll | CTA rate | base conversion |
|---|---|---|---|---|
| `src:linkedin` (ch:social) | 35% | 74% | 2.2% | 4.0% |
| `src:google` (ch:search) | 30% | 55% | 4.5% | 5.0% |
| `ch:direct` | 35% | 48% | 5.0% | 4.5% |

Three rules go through the machinery:

- **`sentry-proof-linkedin`** — approved, ramp 50, planted **+30% relative**
  conversion effect on served visitors. The measurement must call **win**.
- **`search-null-control`** — approved, ramp 50, planted **ZERO** (an A/A
  test). The trap: the measurement must call **no_effect**, not invent a win.
- **`never-approved`** — status `proposed`. Must serve **0** visitors.

The planted effect is applied *only* to visitors the real `assignBucket`
actually puts in the served arm — so bucketing bias, cohort matching, and the
holdout split are all under test, not just the arithmetic.

## What the measurement found (seed 42)

| rule | planted | verdict | measured uplift | p | arms (n / conv) |
|---|---|---|---|---|---|
| sentry-proof-linkedin | +30% rel | **win** ✓ | +46.8% rel | 0.00002 | 5231/295 vs 5180/199 |
| search-null-control | zero | **no_effect** ✓ | −0.6% rel | 0.944 | 4770/244 vs 4332/223 |
| never-approved | — | **0 served** ✓ | — | — | — |

Cohort aggregates recovered the planted behavior differences (scroll 74/55/48,
CTA 1.9/4.8/4.8%) — the exact numbers a designer brief needs to say "linkedin
reads far but doesn't click; direct clicks but doesn't read".

**Honest note — the winner's curse.** The win's point estimate (+46.8%)
overstates the planted +30%. That is expected: conditioning on significance
inflates measured effect sizes, especially near the power boundary. Verdicts
are trustworthy; *point estimates on fresh wins run hot* and must be treated
as upper-ish estimates until re-measured. This is why `rules-measured.json`
carries the full arms and intervals, not just the headline percentage.

## Calibration — 200 independent worlds

Re-running the whole simulation across 200 seeds:

| gate | result | requirement |
|---|---|---|
| false-positive rate on the A/A null | **2.5%** | ≈ alpha (5%); below it because the verdict gates (MIN_ARM_N=300, ≥10 conversions) are deliberately conservative |
| power on the planted +30% | **81.0%** | ≥ 80% |

The power number is load-bearing for expectations: at ~5 200 visitors/arm and
a 4% base rate, +30% relative sits *just* above the 80% power line. Smaller
sites, lower base rates, or subtler effects need proportionally more traffic —
`measureRule` will keep answering `inconclusive` until the data is there,
which is the correct behavior, not a bug. (Hand math: detecting +30% on a 4%
base at 80% power needs roughly 5 000/arm; +10% would need ~40 000/arm.)

## The E5 tick — outcomes feed the next brief

The run writes measured results back into the run artifacts:

- `docs/designer-runs/2026-07-21/rules-measured.json` — the proposed-rules
  format extended with a `measured` block (verdict, uplift, p, both arms with
  Wilson intervals, `simulated: true`, seed).
- `next-designer-brief.json` (scratch) — cohort aggregates + rule outcomes +
  guidance: iterate on the winner, retire/redesign the no_effect rule, and
  the observed gap (direct: highest CTA rate, no rule yet) as the next
  design opportunity. This is the E5 loop closing: measured outcomes become
  the data the next designer round reads.

## What this proves / what it can't

Proved on fabricated data: cohort aggregation, rule matching, approval
gating, deterministic ramp/holdout split, the measurement math, verdict
gates, calibration (FP ≈ alpha, power ≥ 80% at the design point), and the
feedback artifact. The simulation would have FAILED if any of these lied —
that's the point of planting the truth.

Not provable here, by construction: whether a *real* design change moves
*real* visitors — the planted +30% stands in for reality. That single
question is what live traffic is for, and the machinery that will answer it
is exactly what this simulation just exercised end-to-end.

**Follow-up:** a site is after many more things than one conversion goal —
bounce, engagement, proxy clicks. How the loop measures many metrics without
lying to itself (one primary, guardrails that can only pause, the 20-metric
dashboard fallacy, the MDE/keep-measuring layer) is proven the same way —
planted traps, 200-seed calibration — in `docs/metric-hierarchy.md` /
`scripts/guardrail-sim.ts`.
