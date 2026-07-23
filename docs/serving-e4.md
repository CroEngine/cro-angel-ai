# E4b/E4 — Approval-gated rule serving

**Date:** 2026-07-21 · **Snippet:** v0.12.0 · **Module:** `src/adaptive-lab/rules.ts`
**Proof:** 11 unit tests + `scripts/serve-e2e.ts` on sentry.io (live) ·
**Cards:** `scripts/approval-cards.ts` → published approval-queue artifact

**v0.12 addendum:** the rule now carries its `success` contract (primary
metric + guardrails + MDE, validated by `validateRules`), the card renders
it with a time-to-verdict estimate, `approve-rule.ts` approves it together
with the change, and the snippet observes the ingredients (owner-declared
goals via `data-goal-click`/`data-goal-url`, form submits,
`__angelAdaptive.metrics()`). See `docs/metric-hierarchy.md`.

## The trust chain, now executable

```
designer plan / pattern ──▶ RULE (the approval unit)
                              id · cohorts (AND) · optional segment gate ·
                              action · status · ramp · evidence
                                   │  owner approves THE RULE, once
                                   ▼  (proposed → approved; CLI today,
                              rules store (JSON)   card button in product)
                                   │
snippet serve() ──▶ per visitor: cohort match → deterministic holdout
                    (FNV(visitorKey+ruleId) vs ramp) → apply through the
                    STANDARD appliers → per-view self-checks decide →
                    rule_served / rule_holdout / rule_refused events
```

Nothing serves without three yeses: the owner's approval (status), the
visitor's cohort membership, and the pageview's own self-checks. Learn mode
stays inert even with a rules source configured.

## Verified on a live page (sentry.io, LinkedIn-campaign arrival)

| gate | result |
|---|---|
| approved + matching cohort + ramp 100 (pattern) | **served** |
| approved + matching cohort (planned reorder) | **served** — "Loved by developers worldwide" after hero; an earlier load refused with `check-overlap@…` on a campaign page variant, which is the drift protection working, not a failure |
| approved + wrong cohort (`src:facebook`) | not_matched |
| approved + ramp 0 | **holdout** + `rule_holdout` event |
| proposed (not yet approved) | not_matched |
| after revert() | zero angel attributes left |

`rule_served`/`rule_holdout`/`rule_refused` land in `angel.events`, so the
existing collector path ships measurement data the day an endpoint is
configured — holdout vs served is the A/B spine.

## The approval surface

`scripts/approval-cards.ts` renders the owner-facing queue from real
validation artifacts: per rule — cohort chip, rationale, ramp, the exact
rule JSON, the per-view safety contract, and scrollable full-page
BEFORE/AFTER evidence. `scripts/approve-rule.ts` is the state machine
(proposed → approved / paused / retired); in the product the card's button
calls the same transition. Three proposed rules for the designer wins live
in `docs/designer-runs/2026-07-21/rules-proposed.json`.

## Honest boundaries

- **Composition:** serve() and the segment auto-adapt are separate paths;
  adapt() still begins with a full revert (documented sequencing contract).
  Production wiring (which runs when both would act) is an integration
  decision for the live product.
- **Rules transport:** `data-rules-src` fetch is validated and size-capped,
  but the real plan store (per-site endpoint, caching, signatures) is E4
  server work — same integration decision as the collector.
- **Measurement:** events exist; the conversion outcomes they must be joined
  with (goals) live in the collector/live-product pipeline.
