# Metric hierarchy — one primary, few guardrails, everything else diagnostics

**Date:** 2026-07-21 · **Math:** `src/adaptive-lab/measure.ts` (22 unit tests)
**Proof:** `scripts/guardrail-sim.ts` — planted traps + 200-seed calibration,
run under four narrative seeds (42, 7, 1234, 777), all green

## The question this answers

*"Vi mäter ju bara mot målet, konvertering — men det finns hundratals saker
varje sida är ute efter, t.ex. mindre bounce rate."* Correct — and the math
already doesn't care what the goal is: `measureRule` takes any binary
per-visitor outcome. The danger is the opposite one: **testing hundreds of
metrics as equals guarantees fake wins.** At alpha 5%, twenty metrics give a
64% chance that at least one looks "significant" on a rule that does nothing.
A loop that learns from that learns noise, confidently.

So metrics form a declared hierarchy, fixed when the rule is proposed (it
belongs on the approval card, next to the cohort and the screenshots):

| tier | role | may produce |
|---|---|---|
| **primary** (exactly 1) | what this site is actually after — owner's pick | the verdict: win / loss / no_effect / inconclusive |
| **guardrails** (2–4) | bounce, engagement, conversion-when-primary-is-a-proxy | only harm: a breach **pauses** the rule, never a win |
| **diagnostics** (the other hundreds) | understanding, hypothesis generation | nothing |

Guardrails are tested one-sided in the harm direction at a **stricter** alpha
(`GUARDRAIL_ALPHA = 0.01` vs primary 0.05): a breach only ever pauses (the
safe direction), but pausing good rules costs too, so claiming harm takes
more evidence than claiming effect.

Proxy primaries (clicks, scroll) are allowed deliberately — they have far
higher base rates, so small sites reach verdicts ~20× sooner. The trade is
that proxies can be **gamed**: a popup can raise clicks while chasing
visitors away. Guardrails are what make that trade safe to offer — which is
exactly what the planted trap below tests.

## The planted worlds (30 000 fabricated visitors, real serving machinery)

Everything runs through the real `ruleMatches` + `assignBucket` at ramp 50 —
no mocks. Planted truth per rule:

- **clean** `proof-first-linkedin` — primary conversion **+30%**, guardrails
  genuinely improve (bounce −8%, engagement +8%). Must rule win/extend.
- **null** `null-control-google` — zero everywhere (A/A). Must not invent
  anything — and its arms also carry **20 junk metrics** (zero effect,
  never pre-declared) evaluated naively, to show the dashboard fallacy.
- **trap** `popup-teaser-direct` — primary is the proxy `cta_click` **+35%**,
  but bounce **+20%**, engagement **−12%**, conversion **±0**. The gamed
  proxy. Primary alone says "ship it"; the hierarchy must say **pause**.

## Results — four independent narrative worlds

| seed | clean (+30% planted) | null (A/A) | trap (gamed proxy) |
|---|---|---|---|
| 42 | no_effect → **keep_measuring** (p=0.28 — the 1-in-8 miss world; see below) | no_effect, no breach | **breach → pause** (bounce z=9.3) |
| 7 | **win → extend** (+26.1%, p=0.010) | no_effect, no breach | **breach → pause** (bounce z=9.7) |
| 1234 | **win → extend** (+44.9%, p<0.0001) | no_effect, no breach | **breach → pause** (bounce z=8.0) |
| 777 | **win → extend** (+27.8%, p=0.008) | no_effect, no breach | **breach → pause** |

In every world the trap's primary alone said **win** — it would have shipped
on a clicks dashboard. The hierarchy paused it every time.

## Calibration — 200 seeds (the contract; identical across runs)

| what | result | gate |
|---|---|---|
| clean: ruled win/extend | **87.5%** | ≥ 75% (theory ≈ 82–87% at this n) |
| clean: unlucky world → keep_measuring | 12.5% | — (the miss band, kept alive) |
| clean: wrongly retired or paused | **0.0%** | ≤ 2% |
| null: primary false positive | 4.0% | ≤ 2×alpha |
| null: false pause (guardrail noise) | 1.0% | ≤ 5% (theory ≈ 2% at 2×1%) |
| trap: caught and paused | **100.0%** | ≥ 98% |
| trap: escaped as clean win | **0.0%** | = 0 |
| trap: primary-alone would have shipped it | 96.0% | ≥ 90% — the fallacy is real |
| dashboard: ≥1 fake "significant" among 20 junk metrics | **66.0%** | ≥ 30% (theory 1−0.95²⁰ = 64%) |
| junk per-metric FP (4 000 null tests) | 5.1% | 2–8% (≈ alpha — the math is sane) |

The last two rows are the punchline pair: per metric the math is perfectly
calibrated (5.1% ≈ alpha), **and** mining 20 of them still fools you two
worlds out of three. Calibration doesn't save a dashboard — only
pre-declaration does.

## What the test itself caught (and changed)

First run, seed 42: the clean +30% winner landed in its miss band
(measured +10.4%, p=0.28 — happens in 1−power ≈ 12.5% of worlds) and the
then-current policy ruled **retire_or_redesign**. Retiring a true winner
because one world was unlucky is a real product bug — found by the test on
its first execution. Fix, now in `measure.ts`: "no_effect" only becomes
*retire* when the uplift CI **excludes** effects the site would care about
(`MDE_REL = 0.1`); a CI that still allows ±10% means *underpowered* →
**keep_measuring**. After the fix: wrongly-retired rate across 200 seeds is
0.0%, and misses land in keep_measuring where more traffic can rescue them.
Rules that stay underpowered forever are ended by loop policy (a time-box in
the designer brief), not by pretending the data said "no".

## From math to contract (v0.12)

The hierarchy is now an executable contract end-to-end, not just verdict math:

- **`src/adaptive-lab/metrics.ts` — the catalog.** Eight well-defined binary
  metrics (conversion, form_submit, cta_click, pricing_view, engaged,
  deep_scroll, return_visit, bounce), each with its good-direction and where
  it is observed (client / profile / owner-declared goal / collector).
  Site-type presets (saas/leadgen/ecommerce/content) give the default answer
  to "what is THIS site after".
- **`AngelRule.success` — the declaration.** `{ primary, guardrails[],
  mdeRel }` rides on the rule itself, validated + normalized by
  `validateRules` (unknown metric ⇒ the rule is rejected). Serving ignores
  it; measurement is bound by it (`evaluateRuleWithSpec` pulls guardrail
  directions from the catalog). `guardrail-sim` now runs its planted worlds
  through exactly this path — same result, format proven.
- **The approval card shows it.** Each card renders the success block:
  primary + MDE, guardrail chips ("Bounce ↑ ⇒ paus"), and a time-to-verdict
  line from `estimateVerdictTime` (standard 80%-power sample size at the
  card's stated traffic assumption) — plus the early-signal line: engagement
  gives direction in days, the verdict is only ever the primary's.
  `approve-rule.ts` prints the contract on approval and fills in the
  site-type default when missing — no rule activates with an undefined
  definition of winning.
- **The snippet observes it (v0.12).** `data-goal-click` / `data-goal-url`
  let the owner declare conversion on the script tag (click target or
  thank-you URL); form submits are tracked; `__angelAdaptive.metrics()`
  derives the client-decidable catalog booleans for any pageview. Verified
  in a real browser: goal click → conversion, thank-you load → conversion,
  submit → form_submit, full scroll → engaged + deep_scroll, and
  same-session pageviews correctly NOT counted as return visits. Bounce
  stays collector-derived (it is a session-level fact) — the snippet ships
  the ingredients.

## Honest boundaries

- Metrics are drawn independently per visitor in the sim; real bounce and
  conversion correlate. Every test here is marginal per metric, so the
  demonstration is unaffected — but cross-metric structure (e.g. mediation)
  is future diagnostics work, not verdict math.
- Continuous metrics (time on page, revenue/visitor) don't fit the
  two-proportion machinery — binarize first ("engaged > 30 s"); a revenue
  test needs different math and much more traffic.
- The guardrail false-pause cost is real (~1% per rule at two guardrails)
  and is the price of trap protection; it is calibrated, not hidden.
- Winner's-curse still applies to point estimates on fresh wins (seed 1234
  measured +44.9% where +30% was planted) — arms and intervals ship with
  every verdict for exactly this reason.
