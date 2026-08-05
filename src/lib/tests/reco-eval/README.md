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
| **oracle hit-rate** | `argmax(observed)` recovering gold — the best a behaviour engine could do on the same noisy signal (the **ceiling**) |
| **headroom** | ceiling − floor — the measured, non-circular room step 7 must close |
| **behaviour hit-rate** (step 7) | the same floor with the `BehaviorInput` seat fed `observed` — must sit at the ceiling |
| **headroom closed** | (behaviour − baseline) / headroom — step 7's success metric |

Step 7's seat (`generateCandidates(content, {sectionWeight})`) is gated here on
three invariants besides the hit-rate: **byte-identical** default (no input →
same catalog), **rerank-only** (behaviour never adds/removes a candidate —
`catalogDrift === 0`), and insert candidates **anchored to their source
section's** engagement. `BEHAVIOR_GAIN` was chosen by the CLI's gain sweep
(`gainSweep`) — measured, not opined: hit-rate is monotone in gain and saturates
at the oracle; 40 is within noise of 100 while keeping the prior as tiebreak.

Plus a **D1/D2 no-fabrication** tally: over every randomized world, each
candidate the catalog can emit is checked to be in the production vocabulary
`{move_up, insert_snippet}`, every insert verbatim page text, every move onto a
real section. `generate.test.ts` proves the _validator_ rejects violations; this
fuzzes the _generator_ so a violation never even arises.

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
