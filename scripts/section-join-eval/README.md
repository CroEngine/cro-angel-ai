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
- **Side A (server)** — production's exact path (`auto-generate.ts`):
  visible-DOM serialization (`serializeVisibleHtml`) → `extractContentModel` →
  sections with `sec-N-type` ids, plus `generateCandidates` to mark the
  sections the seat actually ranks (the move targets).
- **Join rule** — mirrors the production serving locator
  (`applier.ts findByLocator`, CI-pinned into `public/adaptive.js`): pass 1
  exact normalized heading, pass 2 the 24-char prefix substring. Verdict per A
  section borrows the atlas grading:
  - `UNIK` — exactly one census match: engagement can be credited to the id
  - `FLERTYDIG` — several matches: crediting would be a guess (counts as miss)
  - `OUPPLÖST` — no match: the signal can never reach the id

Reported per site and aggregated: A-section coverage, **candidate-target
coverage** (the number step 8's rollup stands on), and reverse coverage (census
sections whose engagement could never be credited to any A id — lost signal,
not an error).

## Run it

```bash
bun run join-eval                    # full corpus (corpus/* + labeled drift-survey pages)
bun run join-eval hubspot linear     # subset
```

Corpus: every `corpus/*/page.mhtml` (auto-discovered) + 10 labeled marketing
pages from `fixtures/drift-survey/`. Cookie-wall/iframe/media controls are
deliberately excluded (labeled with zero section types; nothing to credit).

## The committed gate

`__tests__/section-join.test.ts` runs in the CI unit sweep:

- pure-function tests for the two-pass join rule (exact, prefix rescue of
  rotator garble, FLERTYDIG on duplicate headings, OUPPLÖST),
- a chromium replay over the ten `corpus/` captures with floors just under the
  measured level (skips honestly where chromium can't launch).

## Honest limits

- The join is measured against the **harvest census** headings. The applier's
  h2 census (the other production census) is graded separately by
  `scripts/section-atlas/atlas.ts` (`UNIK/FLERTYDIG/OUPPLÖST` per binding);
  both use the same heading normalization + prefix rule, which is why the join
  rule here mirrors `applier.ts` byte for byte.
- Reverse misses (census sections with no A counterpart) are expected — the
  census sees headingless/structural sections `extract.ts` deliberately never
  models. They mean *lost signal*, not *wrong credit*.
- Frozen pages can't measure live drift between a visitor's DOM and the frozen
  copy; that is the applier's 24-char prefix pass's job, and it is part of the
  rule measured here.
