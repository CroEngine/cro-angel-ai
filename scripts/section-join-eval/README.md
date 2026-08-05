# section-join-eval — steg 5: bevisa sektions-joinen offline

Step 5 of the CRO recommendation plan (`docs/cro-recommendation-plan.md`).
Answers the last unknown before building behaviour collection (steps 8–9):

> Can engagement observed by the **production runtime census** be credited back
> to the `extract.ts` section ids (`sec-N-type`) — the exact keys the behaviour
> seat (`BehaviorInput`, step 7) ranks on?

If this join is weak, step 8's rollup would trip its own "high join-miss ⇒
null" gate more often than the seat ever gets data — better to know now, on
frozen pages, for free.

## What is measured, end to end

- **Side B (runtime)** — the **real** harvest census: `runPageAudit` evaluates
  the same `SECTIONS_SCRIPT` string that `public/adaptive-harvest.js` serves to
  real visitors (no TS re-import), against the frozen DOM in pinned chromium.
- **Side A (server)** — **production's serialization policy**: nightly/
  auto-generate run `extractContentModel` on freeze-page output, which is raw
  `"<!doctype html>\n" + document.documentElement.outerHTML` — hidden subtrees
  and all. (A review round caught an earlier version using
  `serializeVisibleHtml` here, which measured a *cleaner* model than production
  actually has.) Then `generateCandidates` marks the sections the seat actually
  ranks (the move targets).
- **Join rule** — mirrors the production serving locator
  (`applier.ts findByLocator`, CI-pinned into `public/adaptive.js`): pass 1
  exact normalized heading, pass 2 the 24-char prefix substring. One deliberate
  divergence, stated plainly: where the applier picks the **first** match (it
  must serve something), this eval grades >1 matches `FLERTYDIG` and counts it
  as a **miss** — crediting engagement, unlike serving, must never guess.
  An **injectivity pass** then guarantees one census heading can be the unique
  target of at most one A section (exact beats prefix, then document order) —
  without it, one section's engagement could be double-credited.
  - `UNIK` — exactly one census match, uniquely owned: creditable
  - `FLERTYDIG` — ambiguous (or lost an injectivity collision): counts as miss
  - `OUPPLÖST` — no match: the signal can never reach the id

Reported per site and aggregated: A-section coverage, **candidate-target
coverage** (the number step 8's rollup stands on), and the **credit rate** —
census sections that are some A section's unique target under the *same*
two-pass rule (an earlier exact-only reverse metric falsely labeled
prefix-rescued headings, hubspot's hero among them, "never creditable").

## Measured (2026-08-05, production-faithful side A)

Full sweep — 28 sites (corpus/ + every drift-survey page with section labels):

| metric | result |
| --- | --- |
| **candidate move targets → unique join** (the number step 8 stands on) | **81.0 % (17/21)** |
| all A sections → unique join | 61.2 % (218/356; 8 FLERTYDIG, 130 OUPPLÖST) |
| creditable census headings | 64.7 % (218/337) |

Committed-gate corpus (the ten `corpus/` captures): candidates 85.7 % (6/7),
all sections 68.0 % (102/150), credit rate 66.7 % (102/153).

The four missed candidates (hibob 1/2, supabase 0/1, booking 0/2) are all
sections whose headings the census never surfaces — exactly the miss class the
rollup's per-page null gate exists for.

The all-section number is dragged by two honest finding classes, not by the
join rule: extract **over-segments** list pages (bokadirekt-service: every
service item is an h2) and the census **under-segments** some pages
(cancerfonden sees 2 of 13). Raw side A also surfaces hidden sections the
census can never see (sector-alarm's `display:none` video section) — real
production phantoms, kept in the denominator on purpose. Rotator garble is
rescued by the prefix pass in practice (hubspot 7/7 despite the garbled hero).

## Run it

```bash
bun run join-eval                    # full 28-site sweep
bun run join-eval hubspot linear     # subset
```

Corpus: every `corpus/*/page.mhtml` (auto-discovered) + **all** drift-survey
pages with section labels in `structure-eval/labels.json` (18 of them — an
earlier selection omitted 8, six of them ecommerce, precisely the
over-segmenting class). Excluded: only the labeled zero-section controls
(cookie-wall/iframe/media/spa feeds). Exit code is 1 if any site fails to
measure — an empty sweep can never read as success.

## The committed gate

`__tests__/section-join.test.ts` runs in the CI unit sweep:

- pure-function tests for the two-pass rule (exact, prefix rescue with the real
  hubspot pair, FLERTYDIG on duplicates, OUPPLÖST, injectivity collisions,
  credit-rate consistency),
- a chromium replay over the ten `corpus/` captures with **population gates**
  (every expected site measured, none silently skipped — corpus shrinkage,
  e.g. a capture crossing the 9 MB externalization threshold, fails loudly
  instead of recalibrating the floors) and coverage floors with **stated
  discrete margins**: candidate ≥ 0.70 tolerates one flipped candidate of
  today's 6/7 and catches two; overall ≥ 0.62 is ~9 sections of margin under
  today's 102/150.
- Chromium-launch failure is probed separately and skips with a warning; any
  other harness error fails the test (an earlier catch-all silently skipped).

## Honest limits

- The join is measured against the **harvest census** headings. The applier's
  h2 census (the other production census) is graded separately by
  `scripts/section-atlas/atlas.ts` — note atlas grades **exact-only** binding
  (no prefix pass), so its verdicts are stricter than the serving locator.
- Production's redesign freeze renders at 390×844 (mobile); the corpus mhtml
  was frozen at desktop viewports and replayed at 1280×900. The join should be
  re-validated on real freeze-page output when step 8 wires live data.
- Production's nightly can run the LLM section re-typer after extraction; it
  re-suffixes `sec-N-type` ids but never touches the heading (the join key).
  Consumers must resolve ids via the model's *current* sections, never via
  stored id strings.
- Frozen pages can't measure live drift between a visitor's DOM and the frozen
  copy; that is what the applier's 24-char prefix pass exists for, and the rule
  measured here includes it.
