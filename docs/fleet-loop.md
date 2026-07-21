# Fleet loop — the whole loop across ~100 real sites, on fabricated traffic

**Date:** 2026-07-21 · **Engine:** `scripts/fleet-loop/run.ts` (pure bun, no browser/API/DB)
**Report:** `scripts/fleet-loop/report.ts` → `docs/fleet-loop-2026-07-21/report.html`
**Data:** `docs/fleet-loop-2026-07-21/{results.json, fleet-summary.json}`

## What this is

The request: *run the whole loop over all ~100 sites, fabricate a bit of user
data, let me see the results later.* That is the E5-sim philosophy — real
visitors are only needed for "does the new design convert better?", everything
else is provable now on fabricated data — scaled from one world to the whole
corpus.

Every site is run through the **real** loop functions end to end, no mocks:

```
real inventory + reorder outcome (from the live crawls)
  + fabricated seeded traffic (mulberry32 from the site name — reproducible)
  + a planted per-site truth (winner / null-A/A / trap)
      → planCohortScopes        which cohorts can reach a verdict in-window
      → cohort-scoped rule       required_cohorts + success contract
      → ruleMatches + assignBucket   the real cohort gate + ramp/holdout
      → evaluateRuleWithSpec     the calibrated measurement (Wilson, MDE, gates)
      → planGuardrailSweep       the nightly auto-pause decision
  → verify: did the measurement recover exactly what was planted?
```

- **Real site layer** (not fabricated): `docs/day0-sweep-final.json` (inventory —
  trust/CTA/section counts per site) + `docs/adaptive-sweep-final.json` (what the
  engine actually derived and applied per persona, restore-clean). The live crawls.
- **Fabricated traffic**: a seeded population per site — window volume spread wide
  (~500–60 000 exposed/30 d), a cohort mix over real source tokens, per-metric base
  rates nudged by the site's real trust density. Seeded from the site name, so the
  whole run replays byte-identically.
- **Planted truth**, deterministic per site: **winner** (a real lift on the primary),
  **null** (A/A, zero everywhere), or **trap** (a gamed proxy — cta_click lifts but
  bounce rises and engagement falls). The measurement MUST recover it.

## The result (101 sites)

| | |
|---|---|
| sites | 101 (all with real reorder outcomes) |
| measured | 72 · **29 honestly not measurable** (too little per-cohort traffic — the correct outcome) |
| winner recovery power | **76%** (35/46 measurable winners called `win`) · **0 false-harm** |
| null false-positives | **2/20** — expected ≈1 at alpha 5%, plausibly up to 4 (binomial); *consistent*, sweep paused them |
| trap catch rate | **100%** (6/6 measurable gamed proxies auto-held) · 0 escaped |
| calibration violations | **0** — healthy, independently re-verified |
| days-to-verdict | min 4 · median 20 · max 44 |

The A/As that tripped are not bugs: at alpha 5%, ~1 in 20 nulls trips by chance
(this draw got 2, well within the binomial range), and the guardrail sweep pauses
each — the safe, self-healing direction. A test that *never* false-positived would
be too conservative to detect real effects. The right pass condition is "FP count
within the binomial range for alpha," not zero — which is why the calibration check
uses that bound, not a raw-rate threshold.

## The two regimes (why 72 measured, not ~20)

A cohort is only "measurable" when it can reach a verdict within the window. On a
**conversion** primary (~4% base) most per-cohort slices are too small — only 19
sites qualified. The product's answer, faithfully modelled here, is the
**engagement primary** (the live `test_metric='continuation'` regime): a ~40% base
needs far less traffic, so 47 sites became measurable on engagement; 6 more are trap
sites measured on their declared proxy. The 29 "not measurable" sites are the honest
floor: small fabricated traffic → no cohort A/B is proposed, rather than a guessed
one. Each site draws its own acquisition mix, so the chosen cohort varies across the
fleet (LinkedIn-led sites test `src:linkedin`, search-led test `src:google`, etc.).

## Independent verification (four adversarial lenses)

The results were re-checked by four independent agents that recomputed everything
from the raw rows (ignoring the summary's own numbers): **arithmetic consistency**
(served + holdout = window exactly, conversions ≤ n, p in [0,1], uplift signs, CI
order — 0 violations over 71 rows), **planted-truth recovery** (0 winner false-harm,
0 trap escapes, 0 phantom verdicts; power and FP reproduce exactly),
**statistical calibration** (all three headline rates reproduce; the null FP count
is within the binomial bound), and **cohort-gating integrity** (every measured
variant carries a valid `src:` cohort matching its chosen scope; no not-measurable
site carries a verdict). **No lens found a real violation.**

The gating lens also caught a genuine weakness in an earlier draft — every site had
converged on the same `src:google` cohort — which is now fixed with per-site
acquisition profiles.

## What it proves / what it can't

**Proved on fabricated data, across the whole fleet:** measurable-cohort planning,
cohort-gated serving through the real ramp/holdout, the calibrated measurement math
and its verdict gates, the MDE keep-measuring layer (underpowered winners stay
alive, never a false verdict), the guardrail auto-pause, and honest refusal when
traffic is thin. The run would have surfaced any of these misbehaving — that is the
point of planting the truth and verifying recovery.

**Not provable here, by construction:** whether a *real* design change moves *real*
visitors. The planted effect stands in for reality; that one question is what live
traffic is for, and the machinery that will answer it is exactly what this run
exercised on all 101 sites.

**Honest caveats a skeptic should hold** (several surfaced by the verification):

- **This is a self-consistency test of the statistics + guardrail plumbing.**
  "Recovery" means the estimator read back a signal *we injected into a distribution
  we also wrote* — not that `trust_bar`/`emphasize_primary_cta` lifts a real buyer.
- **The effect sizes are ours.** Winner lifts (~+24–30% rel) were chosen to be
  detectable at the fabricated volumes, so 76% power is power against our planting,
  not against whatever real effects sites have. Subtler effects would recover less.
- **The engagement-primary fallback softens the win bar:** 47 of 72 measured sites
  judged on `engaged` (a proxy), an easier signal to move than revenue-proximate
  conversion. On conversion alone, far fewer cohorts are measurable.
- **Trap coverage is partial:** of 16 planted traps only 6 were ever *measurable*;
  the rest fell into "no measurable cohort" and were never put in front of the
  guardrail. "100% caught" is 6/6 of the *testable* traps, not all planted traps.
- **The null FP is one draw.** 2/20 here; a different seed could give 0 or 3 and
  still be healthy. Don't read a single fleet FP rate as a fixed property — the
  tight calibration lives in `docs/metric-hierarchy.md` (200 seeded worlds).

Metrics are also drawn independently per visitor (real bounce/conversion correlate).
None of these touch the property actually under test here — that the loop recovers
what is truly there, refuses what isn't, and auto-pauses harm — but they are exactly
why this is a pre-flight for the measurement spine, not a claim about real lift.

## Reproduce

```
bun run scripts/fleet-loop/run.ts      # → results.json + fleet-summary.json
bun run scripts/fleet-loop/report.ts   # → report.html (self-contained)
```

Deterministic: same corpus + same seeds → identical numbers. An independent
four-lens verification (arithmetic consistency, planted-truth recovery, statistical
calibration, cohort-gating integrity) is in the run notes.
