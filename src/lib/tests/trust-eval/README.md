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
detector**, including cells where the detector is wrong. 6 of the 18 fixture
sites were added and labeled *after* the first 12 were analyzed, as a hold-out
set to test generalization rather than overfitting. Borderline calls are noted
inline per site.

## Latest results (extractor v1.13.0)

| set | precision | recall | F1 |
|---|---|---|---|
| All 18 fixture sites | 96.4% | 77.1% | 85.7% |
| Original 12 | 95.0% | 90.5% | 92.7% |
| Hold-out 6 (fresh) | 100% | 57.1% | 72.7% |

The remaining recall gap is structural (carousel-hidden copy, number/label split
across DOM nodes, bare "4.7" ratings) or label nuance — not regex coverage; see
the per-site `_note`s.

## Running it

```bash
# all captures present on disk (committed corpus + any local fixtures)
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<chrome> bun run src/lib/tests/trust-eval/run.ts
# a subset
bun run src/lib/tests/trust-eval/run.ts hubspot linear
```

`corpus/{hubspot,linear,hibob}` are committed, so the gate runs in CI against
them (the `trust-eval.test.ts` floor). The other 15 captures live under the
gitignored `fixtures/` (freezes are large); the runner **skips any capture not
on disk**, so the same harness scores 3 sites in CI and all 18 locally.

## Extending the gate

1. Freeze a capture (`bun run freeze …`) to `corpus/<name>/` or `fixtures/…`.
2. Add its path to `captures` and its hand-marked labels to `labels` in
   `labels.json` — **label from the page, not from detector output.**
3. Re-run; commit the capture only if it's small enough for the repo budget.

## Files

- `labels.json` — captures + ground-truth labels (+ per-site evidence notes)
- `run.ts` — replay + score (library `evalAvailable()` and a CLI)
- `__tests__/trust-eval.test.ts` — CI floor gate on the committed corpus
