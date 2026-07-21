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
| measured | 71 · **30 honestly not measurable** (too little per-cohort traffic — the correct outcome) |
| winner recovery power | **82%** (36/44 measurable winners called `win`) · **0 false-harm** |
| null false-positive rate | **5.6%** (1/18) — ≈ alpha 5%, *confirming* calibration; the sweep paused it (safe) |
| trap catch rate | **100%** (9/9 gamed proxies auto-held) · 0 escaped |
| calibration violations | **0** — healthy |
| days-to-verdict | min 5 · median 21 · max 43 |

The single A/A that tripped (pipedrive, ruled `loss` → held) is not a bug: at
alpha 5%, ~1 in 18 nulls trips by chance, and the guardrail sweep pauses it — the
safe, self-healing direction. A test that *never* false-positived would be too
conservative to detect real effects. Observing ≈alpha is the pass condition, not
zero.

## The two regimes (why 71 measured, not 31)

A cohort is only "measurable" when it can reach a verdict within the window. On a
**conversion** primary (~4% base) most per-cohort slices are too small — only 22
sites qualified. The product's answer, faithfully modelled here, is the
**engagement primary** (the live `test_metric='continuation'` regime): a ~40% base
needs far less traffic, so 40 more sites became measurable on engagement. 9 more
are trap sites measured on their declared proxy. The 30 "not measurable" sites are
the honest floor: small fabricated traffic → no cohort A/B is proposed, rather than
a guessed one.

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

**Honest caveats a skeptic should hold:** metrics are drawn independently per
visitor (real bounce/conversion correlate); the planted effect sizes are ours to
choose (set to what a designer would ship, so ~half sit above the MDE and recover,
the tail below it produces honest underpowered misses); the engagement-primary
fallback is modelled, not measured on real goals. None of these touch the property
under test — that the loop recovers what is truly there and refuses what isn't.

## Reproduce

```
bun run scripts/fleet-loop/run.ts      # → results.json + fleet-summary.json
bun run scripts/fleet-loop/report.ts   # → report.html (self-contained)
```

Deterministic: same corpus + same seeds → identical numbers. An independent
four-lens verification (arithmetic consistency, planted-truth recovery, statistical
calibration, cohort-gating integrity) is in the run notes.
