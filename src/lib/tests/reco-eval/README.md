# reco-eval — the CRO recommendation facit (ground-truth ruler)

Step 6 of the CRO recommendation plan (`docs/cro-recommendation-plan.md`). It
answers one question with a number the owner asked for — _"vi måste mäta mot
facit!"_:

> Does today's recommendation ranking actually pick the section visitors
> engaged with — and how much better _could_ a behaviour-aware engine do?

There is no real A/B winner data yet. A hand-written "right answer" that the
engine then ranks against would be **circular** — it would measure plumbing, not
judgement. So this eval builds a **synthetic hidden truth + noise** world (same
family as `winner-calibration` / `guardrail-sim`) and measures recovery of that
truth from noisy observed behaviour.

## Why it is not circular

For each seeded world (`simulator.ts`):

- A hero + 3–4 below-the-fold proof sections are built. Each proof section gets
  a **hidden true value drawn _independently_ of its type** — the core trick.
- Thousands of visits are simulated as `observed = hidden + gaussian·noise`.
- **Gold** = the section with the highest hidden truth (the facit).
- **Prior** = the section today's type weights would pick (highest
  `PROOF_TYPE_WEIGHT`). Because the truth is independent of type, the prior holds
  **no information** about gold — its hit-rate is chance (`mean(1/k)`).

The engine only ever sees the noisy signal; the facit is the hidden truth. So
"does behaviour beat the type-prior?" cannot be an artefact of the generator.

## The numbers (`facit.ts` → `runFacit`)

Every world runs through the **real** catalog → floor pipeline
(`generateCandidates → applyProbe → floorSelection`), never a re-implementation:

| number | meaning |
| --- | --- |
| **baseline hit-rate** | today's engine (floor's top `move_up` = the type-prior) recovering gold — expected ≈ chance |
| **oracle hit-rate** | `argmax(observed)` recovering gold — the **reference ceiling** (an argmax with alphabetical tiebreak; at saturated/near-ties the seat's prior-tiebreak can win the coin flip, so the seat may land ±1pp *above* it and `headroomClosed` can exceed 100%) |
| **headroom** | ceiling − floor — the measured, non-circular room a behaviour engine can win |
| **behaviour hit-rate** (step 7) | the same floor with the `BehaviorInput` seat fed `observed` — must reach the reference ceiling |
| **headroom closed** | (behaviour − baseline) / headroom |

**Honest reading of the step-7 number (review finding 2026-08-05):** the seat is
fed a *perfect* per-section signal — the exact map the oracle argmaxes over —
so reaching the ceiling is expected **by construction**. What the number proves
is a **plumbing test**: the real `generateCandidates → applyProbe →
floorSelection` machinery transports the signal losslessly (and the gain is
strong enough for behaviour to lead over the prior). What it does **not** prove
is that real engagement data predicts conversions — that is steps 8–10,
measured on this same rig when the rollup's imperfect input (aggregation,
join coverage, thin data) replaces the oracle-perfect one.

Step 7's seat (`generateCandidates(content, {sectionWeight})`) is gated here on
three invariants besides the hit-rate: **byte-identical** default (no input →
same catalog), **rerank-only** (behaviour never adds/removes a candidate —
`catalogDrift === 0`), and **term anchoring measured per candidate**
(`anchorViolationCount === 0`): every world's catalog is diffed with vs without
behaviour — moves carry exactly their target section's term, heading-inserts
their section's term, a section-bound trust line its home section's term, and
the "body" line exactly 0. The worlds contain both insert classes (a bound
trust line + a "body" line), and `extract.ts` now binds a signal's home section
on real pages (it used to hard-code `"body"`, which made insert anchoring dead
code in production — the review caught it). `BEHAVIOR_GAIN` was chosen by the
CLI's gain sweep (`gainSweep`) — measured, not opined: hit-rate rises with gain
up to saturation (beyond it differences are seed noise, ±1pp between seed
bases); 40 sits on the plateau while keeping the prior as tiebreak.

Plus a **D1/D2 no-fabrication** tally: over every randomized world, each
candidate the catalog can emit is checked to be in the production vocabulary
`{move_up, insert_snippet}`, every insert verbatim page text, every move onto a
real section. `generate.test.ts` proves the _validator_ rejects violations; this
fuzzes the _generator_ so a violation never even arises.

## The step-8 rollup gate (`runRollupFacit`)

Step 7's plumbing test fed the seat a perfect signal. Step 8 measures the real
chain **step-9 events → rollup → seat** on the same worlds, with imperfect
input — deterministically derived from each world, no new random draws:

- **clean** heading-keyed observations → the rollup-mediated pick must equal
  the direct seat's pick (lossless resolution),
- **garbled** census headings (suffix drift, the rotator class) → the shared
  join's 24-char prefix pass must rescue them (same pick),
- **thin** worlds (below `MIN_VISITS`) → the rollup must answer `null`,
- **majority unattributable mass** (consent/list-noise class) → `null`, and the
  caller's null path (no behaviour input) must give exactly the baseline pick.

All four gates hold 2000/2000 in the CLI and 300/300 in the committed test.
The rollup itself lives in `src/adaptive/redesign/engagement-rollup.ts` and
resolves headings through `section-join.ts` — the SAME rule the offline
join eval (`scripts/section-join-eval/`) measures on frozen pages, moved to
`src/` so production and measurement can never diverge.

## Run it

```bash
bun run reco-eval           # 2000 worlds (default)
bun run reco-eval 5000      # more worlds
bun run reco-eval 2000 500  # worlds, seed base
```

The CLI exits non-zero if the facit breaks its bars (baseline off chance, no
headroom, or any fabrication), so it doubles as a quick sanity gate.

## The committed gate

`__tests__/reco-eval.test.ts` runs in the normal CI unit suite (pure + fast) and
asserts the scientific claims on locked seeds:

- floor's move-pick **is** the type-prior on every world,
- baseline sits at chance (`|baseline − mean(1/k)| < 0.06`),
- oracle clears baseline by a wide margin (real headroom exists),
- **zero** fabrication across all worlds,
- reproducible (same seeds → identical report),
- and D2 holds through the **real** `extractContentModel` on an HTML fixture —
  every insert is verbatim raw page text after the actual tidy transforms.

## Files

- `prng.ts` — seeded mulberry32 + gaussian + Fisher–Yates (no `Math.random`).
- `simulator.ts` — `makeWorld(seed)`: the hidden-truth + noise world.
- `facit.ts` — `runFacit(seeds)`: the scoring + D1/D2 invariant, pure.
- `run.ts` — CLI report.
- `__tests__/reco-eval.test.ts` — the committed regression gate.
