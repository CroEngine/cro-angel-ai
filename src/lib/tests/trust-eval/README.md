# Trust-signal ground-truth benchmark

An external, hold-out-validated benchmark that measures **how accurate trust
detection actually is** — precision/recall against labels marked from the
rendered page, independent of the detector — rather than only whether output is
*deterministic*. It is the standing regression gate for `scripts/trustSignals.ts`.

## What it measures

For each capture, the runner replays it through the real `runPageAudit`, maps
emitted signals to 10 trust types, and compares to hand-labeled ground truth:

`testimonial · customer_logos · rating · certification · guarantee ·
secure_payment · press_mention · trusted_by · social_proof_count · review_badges`

Every `(site × type)` cell is a TP / FP / FN / TN → precision, recall, F1.

## How the labels were made (integrity)

Labels in `labels.json` are marked from the **rendered page** — a full-page
screenshot plus a raw DOM evidence sheet (headings, footer, short-text blocks,
logo-wall inventory, blockquote/star/badge counts) — **independent of the
detector**, including cells where the detector is wrong. The corpus was grown in
hold-out waves (12 → 18 → 32), each new wave labeled *before* the detector was
touched, so a fix has to generalize to unseen sites rather than overfit the set
it was derived from. The 32-site wave deliberately added the adversarial cases a
SaaS-heavy set never exercises: news/media (Der Spiegel, Le Monde, Aftonbladet,
The Verge), a marketplace (Tradera), SE e-commerce (IKEA), SPAs (Spotify,
Airbnb), and consent walls. Borderline calls are noted inline per site.

One label has been **corrected** since first marking, documented in full here for
integrity: `linear.social_proof_count` 0 → 1. The original above-fold pass missed
a first-party adoption claim — *"Linear powers over 33,000 product teams"* — whose
count sits in a `<strong>` at y≈9208, deep below the fold. It was re-confirmed
straight from the rendered DOM (not from detector output) and is the same claim
class already labeled `1` on hubspot/loom/hibob/dev-to. Labels are corrected only
when the rendered page is independently verified to disagree with the mark —
never to make a number look better.

## Latest results (extractor v1.14.0)

Scored over all 32 captures present on disk:

| metric | v1.13.0 | v1.14.0 |
|---|---|---|
| precision | 90.0% | **98.0%** |
| recall | 80.4% | **84.2%** |
| F1 | 84.9% | **90.6%** |
| TP / FP / FN | 45 / 5 / 11 | 48 / 1 / 9 |

v1.14.0 fixed the five defects the 32-site wave exposed: testimonial FPs from
quote-marked news headlines (Der Spiegel) and "- Title" music slides (Spotify),
a product-card-as-testimonial FP and a payment-strip-as-customer-logos FP (IKEA),
plus two recall misses ("Returns/Exchanges" + "Refund policy"; an adjective
between a number and its unit). See `extractor-version.ts` for the full entry.

The single remaining FP is honestly kept: vercel *"Mintlify powers documentation
for 20,000+ companies on Vercel"* — a third-party customer's stat in a case-study
card, indistinguishable from a first-party claim without overfitting. The 9
remaining recall misses are structural (carousel-hidden copy, number/label split
across DOM nodes, bare "4.7" ratings, text-only "#1 (G2)" award badges) — not
regex coverage; see the per-site `_note`s.

## Running it

```bash
# all captures present on disk (committed corpus + any local fixtures)
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chrome> bun run src/lib/tests/trust-eval/run.ts
# a subset
bun run src/lib/tests/trust-eval/run.ts hubspot linear
```

`corpus/{hubspot,linear,hibob}` are committed, so the gate runs in CI against
them (the `trust-eval.test.ts` floor). The other 29 captures live under the
gitignored `fixtures/` (freezes are large); the runner **skips any capture not
on disk**, so the same harness scores 3 sites in CI and all 32 locally.

## Extending the gate

1. Freeze a capture (`bun run freeze …`) to `corpus/<name>/` or `fixtures/…`.
2. Add its path to `captures` and its hand-marked labels to `labels` in
   `labels.json` — **label from the page, not from detector output.**
3. Re-run; commit the capture only if it's small enough for the repo budget.

## Files

- `labels.json` — captures + ground-truth labels (+ per-site evidence notes)
- `run.ts` — replay + score (library `evalAvailable()` and a CLI)
- `__tests__/trust-eval.test.ts` — CI floor gate on the committed corpus
