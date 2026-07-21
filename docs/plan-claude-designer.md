# Plan — the Claude Designer loop: data → Claude → per-cohort redesign → measured

**Status:** proposed 2026-07-21, awaiting go
**Vision (the user's, verbatim intent):** change sites and move things around
depending on WHO is visiting, informed by data on previous visitors who arrived
the same way; send all needed data to Claude, let Claude redesign, serve it.

## The architecture in one picture

```
 visitor lands ──▶ snippet: inventory + behavior ──▶ collector/DB (cohorts)
                        ▲                                    │
                        │                          nightly/weekly, per site
                  applies the plan                           ▼
                  for THIS visitor's                 CLAUDE DESIGNER (API)
                  cohort, instantly,          reads: content inventory, section
                  client-side                 map, cohort aggregates (sources,
                        ▲                     drop-offs, segment outcomes),
                        │                     + the SAFE-PRIMITIVE CATALOG
                  plan store (per site        writes: adaptation PLANS — JSON
                  × cohort, validated) ◀──    programs composed ONLY of safe
                        ▲                     primitives on EXISTING content
                        │                                    │
                  visual-acceptance harness ◀────────────────┘
                  (auto-verifies every plan on the real page
                   before it may serve; rejects "looks off")
```

**The key design decision — where Claude sits.** Claude designs **per cohort,
offline** (nightly/weekly), not per individual pageview. Live per-visitor
API calls would add seconds of latency, per-view cost, and privacy exposure;
pre-designed per-cohort plans applied client-side are instant, cheap, and the
visitor's raw behavior never leaves the browser at decision time. The visitor
still gets a personally chosen experience — the snippet derives their cohort
locally in milliseconds and applies that cohort's Claude-designed plan.

**The second key decision — Claude composes, primitives constrain.** Claude
gets full creative freedom over WHAT to change (order, emphasis, which proof
to surface, what to tone down) but can only express it in the safe-primitive
vocabulary. It can never inject copy, never do raw DOM surgery. That is how
"Claude redesigns the page" and "nothing may ever look broken" coexist — and
every plan must additionally PASS the visual-acceptance harness on the real
page before it is allowed to serve.

## Etapper

### E1 — The reorder primitive + a richer vocabulary (unlocks "flytta runt")
CSS `order` swaps between sibling sections inside flex/grid parents — visual
reordering with NO DOM moves (framework-safe, one-line revert, no hydration
risk). Plus: `deemphasize_section` (soft-collapse a low-value section for a
cohort, style-only), `spotlight_section` (exists), `anchor_jump` (jump-link to
an existing section). Every new primitive ships with visual-acceptance checks
and the 100-site sweep as its regression gate.
*Effort ~2-3 nights. No dependencies — can start now.*

**STATUS: shipped through v0.7.** v0.6 (self-checking `order` reorder) →
v0.6.1 (common-ancestor targeting) → v0.7 (the attempt loop: a ladder of
candidate containers tried under strict self-checks with pre-paint rollback,
full per-attempt diagnostics in `__angelReorderWhy`, byte-identical restores
proven by outerHTML equality in `check:reorder-lab`). Validated across the
101-site corpus; see `docs/adaptive-sweep.md` day-4 addendum. The remaining
refusal classes (single-child wrapper chains, flex-promotion drift) are the
documented boundary that E4+ DOM moves would cross.

### E2 — Cohort profiles ("people who arrived the same way before")
Extend the collector schema: visitor profile keyed by first-party visitorKey —
source/UTM/referrer class, landing page, pages seen (visited-pricing!),
return count, past segment outcomes. Aggregate into COHORTS (e.g. "organic →
recipe page → returning", "ad → pricing → bounced"). The snippet gets a tiny
profile read (or client-side accumulation first — localStorage already carries
visitorKey). This is what makes price_hesitant fire on the homepage: the
profile knows the visitor saw /pricing yesterday.
*Effort ~3-4 nights. Needs the collector deployed (reference exists) or
integration with the live angel_* events (they already store visitor_hash).*

**STATUS: client-side half shipped (v0.10, `src/adaptive/profile.ts`).**
Touch history (first/last, UTM-over-referrer), 30-min-session visit counts,
pages-seen ring buffer, sticky seenPricing — journey-proven on four real
sites (price_hesitant now derives on homepages; cohort keys `ch:/src:/ret:/
seen:` exposed for E4b). See `docs/cohort-profiles.md`. The server-side
half (cross-DEVICE aggregation + past segment outcomes) still needs the
collector or angel_* integration.

### E3 — The Claude Designer job
An offline job per site: assemble the design brief (content inventory, section
map with screenshots, cohort aggregates, past plan performance) → Claude API →
per-cohort adaptation plans as schema-validated JSON in the primitive
vocabulary. Rejected-by-schema = regenerate; the model never free-hands DOM.
(Implementation note: load the repo's claude-api skill before writing the API
integration; use the latest model tier for design quality.)
*Effort ~3-4 nights. Depends on E1 (vocabulary) + E2 (cohort data).*

### E4b — Owner approval & consent tiers (the trust chain)

A proposal may only go live after the SITE OWNER approves it. The approval
unit is the RULE, not the pageview: the owner sees a concrete card —
before/after screenshots, the cohort ("visitors arriving from LinkedIn"), the
data rationale ("proof-early converts better for this cohort, N visits"), and
after launch the measured result — and one click approves the rule, which then
serves every matching visitor without further asks. Consent is tiered and
owner-controlled: per-proposal approval (default for reorders and anything
layout-affecting) → auto-approve within pattern classes the owner whitelists
(bars/emphasis) → full autopilot per site. Maps directly onto the live
product's existing flags (adaptations_enabled, serving_enabled, ramp_pct).

An approval is NOT forever-valid: the per-pageview self-checks keep running
(a site redesign that makes an approved reorder unsafe → that view refuses
automatically and the rule is flagged for re-review), and detected inventory
drift (the live product already emits inventory_drift events) pauses the rule
until re-validated. "Use it as much as we want" = unlimited within the
approved rule, never a day past it still provably holding.

**E4b STATUS: chain executable (v0.11).** Rule format + approval state
machine (`approve-rule.ts`, card queue via `approval-cards.ts` — published
as the E4b artifact), cohort-AND matching, deterministic holdout, per-view
self-checks re-run on every serve, `rule_*` measurement events. Live-proven
on sentry (all five gates). See `docs/serving-e4.md`. Remaining: the product
UI for the button and the server-side plan store/goal join (integration
decision).

### E4 — Validate → store → serve → measure
Each generated plan auto-runs through the visual-acceptance harness against
the live page (the night-2 harness, productized): reject on any visual issue.
Approved plans land in a plan store; the snippet fetches its site's plans
(one small cached JSON) and applies the matching cohort's plan. Measured
through a holdout exactly like the live product does (or through the live
product's own serving if we integrate instead of parallel-building).
*Effort ~1 week incl. pilot on one real site. Depends on E1-E3.*

### E5 — The learning loop
Outcomes per cohort×plan flow back into the next design brief; Claude sees
what won and iterates. This is the moat: every night the designs get more
site-specific and cohort-specific, grounded in that site's own measured data.
*Continuous once E4 is live.*

**STATUS: mechanics simulation-proven (E5-sim).** The full tick — fabricated
population → cohort aggregates → the real rule machinery serving at ramp 50
with deterministic holdout → the real measurement math
(`src/adaptive/measure.ts`) → verdicts → `rules-measured.json` + the next
designer brief — runs end-to-end with a PLANTED ground truth and recovers
it: win where +30% relative was planted, no_effect on the A/A null control,
zero serves of the unapproved rule. Calibration over 200 seeded worlds:
false-positive rate 2.5% (≤ alpha), power 81% at the design point. See
`docs/loop-sim.md`. Remaining, by construction: real conversion outcomes —
the one question that needs live visitors — via the collector/goal join.

## Honest constraints carried forward

- Reordering stays inside flex/grid siblings (the safe subset) until measured
  demand justifies more; tab/reader order diverges from visual order on
  reordered pages (a11y note — keep swaps local and few).
- Claude's plans are only as good as the inventory (93/100 CTA, 94/100 trust
  on the sweep) — engine recall work continues in parallel.
- Per-cohort, not per-individual: individuals inherit their cohort's plan.
  True 1:1 would require on-device models or unacceptable latency/cost today.
- The live angel_* product already has serving/holdout/variants — E4 should
  reuse it if the codebases are joined (see migration docs); parallel-build
  only if staying separate is a deliberate product choice.
