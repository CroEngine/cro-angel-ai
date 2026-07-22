# Fleet shots — live before/after of the engine adapting the fleet sites

**Date:** 2026-07-21 · **Crawl:** `scripts/fleet-shots/run.ts` (Browserbase, live)
**Gallery:** `scripts/fleet-shots/gallery.ts` → `docs/fleet-shots-2026-07-21/gallery-part{1..4}.html`
**Data:** `docs/fleet-shots-2026-07-21/{manifest.json, img/}`

## What it is

The fleet report showed the loop's *numbers*; this shows the *pixels*. Each fleet
site was re-crawled **live** via Browserbase, the engine (`artifacts/lab/adaptive-lab.js`)
injected, and the page photographed **before** → the engine adapting → **after** →
then reverted to confirm it comes back byte-clean.

This run captures the **whole start page** (not just the fold) with cookie banners
removed, **plus each site's pricing page** where one exists. The gallery pairs the
two pages behind a Home/Pricing tab and shows before/after as **synced scrollable
panes** — scroll one, both move — so you can compare the entire page at any point.

**Honest scope:** "after" is the engine's **safe primitives** — trust bar (proof
*not already shown*), CTA emphasis, reorder where eligible, and on pricing pages a
risk-reducer bar / pricing spotlight — the same reversible vocabulary the product
serves. It is **not** the Claude-designed cohort redesign (that needs the
production API). And note: `adaptive-lab.js` is the **research/lab engine**; the
customer-facing snippet is `public/adaptive.js`, a separate codebase not yet
unified with the lab line (see `docs/investigation-2026-07-21.md`, Part 2 #2). So
this proves the lab engine safely adapts real pages; the generative redesign and
the engine consolidation are separate steps.

## The result

| | |
|---|---|
| targeted | **134** pages (104 home + 30 pricing) |
| captured live | **128 / 134** |
| pricing pages captured | **29** |
| visibly adapted | **108** (engine surfaced a safe primitive) |
| reverted byte-clean | **127 / 128** — the sole residue is `n8n/home` |
| flagged by automated visual-acceptance | **2** (teamtailor, quinyx — `emphasis-covered`: a CTA the runtime self-check would refuse to serve) |
| couldn't capture | 6 (voyado, amplitude, surferseo, bokio home+pricing, attio — live load/consent/bot walls) |

The load-bearing number is **127/128 reverted clean**: nearly every page the engine
touched came back exactly as it was. `n8n/home` is the one honest exception —
flagged as RESIDUE in the gallery, worth a look before this primitive ships there.
The 2 visual-issue sites are the automated acceptance doing its job — flagging a
covered CTA the runtime would refuse rather than serve. "No change" cards are
honest: the engine found nothing safe to surface for that visitor, not a failure.

## Reproduce

```
# live crawl (Browserbase; Node + proxy env) — full start pages + pricing pages
bun run build:lab   # bygger artifacts/lab/adaptive-lab.js (gitignored) som run.ts läser
bun build scripts/fleet-shots/run.ts --target=node --format=esm \
  --outfile=fleet-shots.node.mjs --external playwright --external @browserbasehq/sdk
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node fleet-shots.node.mjs
# gallery (auto-splits into loadable ~4.5 MB parts)
bun run scripts/fleet-shots/gallery.ts
```

Companion to `docs/fleet-loop.md` (the loop's numbers on fabricated traffic);
together they are the fleet's numbers and its pixels.
