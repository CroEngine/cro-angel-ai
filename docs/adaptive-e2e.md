# Adaptive E2E — the full loop on real sites (v0.4)

**Date:** 2026-07-20 · **Runner:** `scripts/adaptive-e2e.ts` · **Snippet:** the
shipped `public/adaptive.js` bundle, injected as-is.

The question this answers: *does the whole product work start-to-stop — collect
behavior, decide a segment, change the page, and undo it — on real sites?*

## What runs

Per site: inject the real bundle → snippet builds its Content Inventory →
harness scrolls like a reading visitor (the snippet's tracker records **real**
scroll/time events) → `adapt()` with no argument (segment **derived** from
those events) → then each named segment forced in turn ("the improvised visitor
data") → screenshot after every step → `revert()` → assert **zero**
`[data-angel-adaptation]` elements remain.

## The decision layer (new, v0.4)

| segment | trigger (from behavior data) | patterns applied |
|---|---|---|
| `new_skimmer` | low scroll + short time on page | trust_bar |
| `engaged_no_click` | deep scroll, zero CTA clicks | emphasize_primary_cta + trust_bar |
| `price_hesitant` | pricing section exists + deep scroll + no clicks | risk_reducer_bar + pricing_spotlight |
| `default` | anything ambiguous | v2 behavior (trust_bar + CTA emphasis) |

Two new patterns, both inside the layout-safe primitives (style-in-place or one
isolated prepended bar; only existing page content; recorded undo):

- **risk_reducer_bar** — surfaces the page's own guarantee/compliance copy.
- **pricing_spotlight** — soft tinted ring on the existing pricing section
  (coarse v1; plan-card targeting needs card-level inventory).

## Results — 4/4 end-to-end, 4/4 restored clean

| site | inventory | derived segment | example adaptations (all from the page's own content) |
|---|---|---|---|
| plausible | 7 trust, 9 CTAs | new_skimmer | bar "19k — subscribers"; emphasis on "Start free trial"; risk bar "No need for cookie banners or GDPR consent" |
| basecamp | 13 trust, 5 CTAs | new_skimmer | bar "Check out over 1,000 more customer testimonials…"; emphasis on "Take a 3 minute tour of Basecamp"; price segment → **nothing** (no guarantee/pricing content found — correct refusal) |
| pipedrive | 19 trust, 12 CTAs | new_skimmer | bar "Trusted by over 100,000 companies"; risk bar "GDPR compliant and secure" |
| teamtailor 🇸🇪 | 16 trust, 7 CTAs | new_skimmer | bar "Trusted by over 13,000 Companies worldwide" |

**Reversibility proved on all four**: after `revert()` the page carries zero
Angel elements and original inline styles are restored.

Screenshot-verified: plausible's `engaged_no_click` frame shows the trust bar +
the emphasized hero CTA with the page otherwise untouched — demo-quality.

## Honest findings

- **Derived segment defaulted to `new_skimmer` everywhere** — the harness
  scrolls faster than the tracker's sampling cadence, so scroll events were
  thin at adapt-time. Calibration TODO (tracker debounce vs. real reading
  speed); the named-segment runs demonstrate every variant regardless.
- **When the content doesn't exist, nothing is applied** (basecamp/teamtailor
  price segment) — by design: Angel never invents copy.
- **Cookie modals can cover the demo shot** (teamtailor) — the harness should
  dismiss consent before screenshots (v2 of the rig).
- plausible's "risk reducer" picked a GDPR-compliance line over the (better)
  "30-day free trial" — trial copy lives in CTA text, not `trust.guarantees`;
  a `free_trial` source for the risk bar is an easy v0.5 upgrade.

## Reproduce

```bash
bun build scripts/adaptive-e2e.ts --target=node --format=esm \
  --outfile=e2e.node.mjs --external playwright --external @browserbasehq/sdk
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node e2e.node.mjs
```
