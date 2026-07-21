# The Claude Designer loop (E3-lite) — LLM-designed reorders, machine-verified

**Date:** 2026-07-21 · **Snippet:** v0.9.0 · **Pipeline:** `scripts/designer-{brief,solve,validate}.ts`
**Directive:** the loop must actually talk to the LLM, look at the page's code, and find
solutions — then prove them.

## Architecture

```
designer-brief   per refused site: sections + auto-ladder refusal trail +
                 STRUCTURE DIGEST (every candidate container with its children:
                 selectors, rects, which sections each child carries)
       │
designer-solve   brief → plan (claude-opus-4-8, schema-enforced JSON via
                 output_config.format, adaptive thinking, invalid-output retry).
                 Round ≥2 feeds the previous plan + its live-page failure
                 reason back to the model — the RELOOP.
       │
planReorder      the snippet executes the plan through the SAME tryOrderMove
                 core as the automatic ladder: a plan can never move anything
                 but the proof section, never above the hero, never below any
                 self-check — it only widens TARGETING (any container,
                 explicit anchors, grid promotion, 2-kid swaps)
       │
designer-validate  live page → apply → self-checks decide → gallery
                 before/after pair on success → revert + byte-clean check →
                 failures become feedback-round<N>.json for the next round
```

**Transport note.** This sandbox's network gateway rejects API-key auth on
anthropic.com (verified: identical 401 + `request-id: null` for real and
garbage keys, direct and via proxy — the key itself was never evaluated).
The pipeline therefore has `--transport=api` (production path, run it where
normal egress exists) and `--transport=file` (identical prompts on disk,
plans supplied out-of-band). This validation used the file transport with
Claude-in-the-loop; every prompt sent is preserved under
`designer/prompts/`.

## Results — 8 refused sites, 8 rounds

| site | outcome | what it took |
|---|---|---|
| **pandadoc** | **APPLIED clean** (round 5) | grid promotion + explicit 100% column |
| **wrike** | **APPLIED clean** (round 8) | + overlap-vs-before acceptance, tag-based container selector |
| **sentry** | **APPLIED clean** (round 8) | + out-of-flow children excluded from envelopes |
| airtable | designer refused (round 1) | detected "proof" is a nav artifact — extractor bug, no safe move |
| clickup | designer refused (round 6) | full-bleed child (100%+padding overflow, −86px squeeze) — structural |
| rippling | designer refused (round 6) | same full-bleed class (−97px) |
| auth0 | designer refused (round 8) | one child grows exactly +175px under every promotion variant — needs DOM moves |
| contentful | harness-blocked | the known intermittent DOM race (task #41) killed every attempt |

Three conversions from the "impossible" pile, four honest refusals with
named structural causes, one harness limitation. Every applied plan restored
byte-clean; every win has a gallery before/after pair (`designer/shots/`).

## What the loop actually fixed (the reloop earning its keep)

Every round's refusal was DATA (per-kid deltas like `check-width-left@5:dw175,dl0`),
and five of the failures were OUR mechanism, not the sites:

1. **Grid needs one explicit 100% column** — the implicit auto track sizes to
   the widest child's max-content and every stretched item inherits it.
2. **Border boxes lie after promotion** — blockified kids ADOPT child margins
   that used to collapse out; height "changes" while screen pixels don't.
   Self-checks now measure content envelopes.
3. **Dormant item properties + `!important`** — site CSS carries
   `justify-items: center` and friends that only activate under our
   promotion; the stretch overrides apply with important priority.
4. **Overlap acceptance is relative** — designs overlap on purpose (negative
   margins); the bar is "no worse than the page already was", not zero.
5. **Out-of-flow children poison envelopes** — a hidden full-page overlay
   inside a 70px banner produced a phantom 1678px "overlap".

Each fix is locked in `check:reorder-lab` (16 cases) and benefits the
AUTOMATIC ladder too — the regression suite over the previously-applied
sites gates that both stay green.

## The twist: the loop's fixes were absorbed by the AUTOMATIC ladder

After the mechanism fixes the designer rounds forced, the verification sweep
showed **sentry, wrike and pandadoc now reorder via the plain automatic
ladder at L0** — no plan needed. The designer's grid plans PROVED the moves;
the check corrections (envelopes, relative overlap, out-of-flow exclusion,
important-priority stretch) then generalized them into the core. The loop's
deepest value was not the three site wins — it was using real pages to
debug the mechanism until the automatic tier got stronger.

Net auto-ladder tally on the tracked set after E3-lite: **16 applied**
(the 13-site regression roster + sentry + wrike + pandadoc, minus two
newly-conservative refusals under the stricter-but-truer rules: sanity — a
real, stable 128px envelope reflow border-box measurement used to mask —
and mercury — a 50px overlap in an adjacency pair the original page never
had). Refusal beats weirdness; both stand.

## The honest boundaries that remain

- **Full-bleed children** (clickup, rippling): a child that overflows its
  container by design cannot survive flex/grid promotion without pixel-
  freezing widths (breaks responsiveness). CSS `order` ends here; DOM moves
  (E4+) are the next tool.
- **Item-context-coupled sizing** (auth0): sizing that changes under any
  item context, immune to stretch + important overrides.
- **Extractor precision feeds the designer** (airtable): a misdetected proof
  section caps what any designer can do — inventory quality is the floor.

## Reproduce

```bash
bun build scripts/designer-brief.ts --target=node --format=esm --outfile=dbrief.node.mjs \
  --external playwright --external @browserbasehq/sdk
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  node dbrief.node.mjs --names=<sites>
node dsolve.node.mjs --transport=api --names=<sites> [--round=N]
node dvalidate.node.mjs --names=<sites> --round=N
```
