# Attribution rollup — design spec

> Increment 1 of the optimization loop: **measure** which adaptations actually
> drive conversions, per segment — the input to increment 2 (let `decide` prefer
> the winners / bandit).

## What already exists

- `adaptation_shown` carries `{ patterns[], trafficSource, device, country, browser, language, campaign }` + `decisionId`.
- `cta_click` / `scroll_depth` / `conversion` carry the same `decisionId`, and every client event carries `visitorHash`.
- The dashboard (`aggregate.ts`) already computes `conversionRate` + segments.

## The attribution key

A conversion usually happens on a **later page** than where the adaptation was shown, and each page load gets a new `decisionId` — so `decisionId` doesn't span pages. The real key is **`visitorHash`**: link a visitor's `adaptation_shown` (patterns + segment) to a later `conversion` within an attribution window (e.g. same visit / 24 h).

> ⚠️ `visitorHash` is a persistent id → **consent-gated** (see `consent-gate.md`). On our own site it's fine now; for third parties the consent gate governs it. In anonymous mode we lose cross-page attribution and fall back to `decisionId` (same page) / session signals.

## Prerequisites (without these there's nothing to measure)

1. **Conversion trigger** — the snippet needs a way to fire `conversion`:
   - Public API `window.AngelAdaptive.convert(value?, meta?)` (thank-you page, purchase), and/or
   - config-driven: a conversion URL pattern or a CSS selector to watch.
   - Carries `visitorHash` + the last `decisionId`.
2. **Holdout** — to measure causal **lift** (not correlation) we need a control group: a deterministic control bucket per visitor, `hash(visitorHash) % 100 < holdoutPct`. Control visitors get **no** adaptations, but we still log `adaptation_withheld` with the patterns that *would* have shown + segment. Default `holdoutPct = 0` (off) — opt-in per site.

## The rollup (this increment)

A scheduled aggregation over `angel_events`, per `(site, path, segment, pattern, variant∈{adapted,control})`:

- `exposures` = distinct visitors who saw (`adaptation_shown`) or were withheld (`adaptation_withheld`) that pattern in the window.
- `conversions` = distinct of those who later fired `conversion` within the attribution window (joined on `visitorHash`).
- `conversionRate` = conversions / exposures.
- **`lift`** = adaptedRate − controlRate (+ n / significance).

Materialize into `adaptation_performance` (site, path, segment, pattern, day, exposures, conversions) or extend `events_rollup`.

## Dashboard surface

A **"What's working"** view: per pattern × segment → exposures, conversion rate, **lift vs control**, significance. This is where you see which adaptations to trust — the input to increment 2.

## Increment boundaries

- **Increment 1a (first):** conversion trigger + holdout + `adaptation_withheld` logging (with `visitorHash` + segment). Verifiable end-to-end.
- **Increment 1b:** the rollup table/query + the "What's working" dashboard view.
- **Increment 2:** feed lift back into `decide` (prefer winners → multi-armed bandit).

## Open questions

- Attribution window length + model (last-touch vs any-touch).
- Consent dependency for cross-page (`visitorHash`) attribution.
- Significance threshold before acting on a result.
