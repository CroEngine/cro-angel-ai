# Fleet shots — live before/after of the engine adapting the fleet sites

**Date:** 2026-07-21 · **Crawl:** `scripts/fleet-shots/run.ts` (Browserbase, live)
**Gallery:** `scripts/fleet-shots/gallery.ts` → `docs/fleet-shots-2026-07-21/gallery.html`
**Data:** `docs/fleet-shots-2026-07-21/{manifest.json, img/}`

## What it is

The fleet report showed the loop's *numbers*; this shows the *pixels*. Each of
the fleet's sites was re-crawled **live** via Browserbase, the real engine
(`public/adaptive-lab.js`) injected, and the page photographed **before** → the
engine adapting for an engaged reader → **after** → then reverted to confirm the
page comes back byte-clean. The gallery is a drag-to-reveal before/after slider
per site.

**Honest scope:** "after" is the engine's **safe primitives** — trust bar, CTA
emphasis, and reorder where eligible — the same reversible vocabulary the product
serves. It is **not** the Claude-designed cohort redesign (that needs the
production API). So this proves the engine safely adapts real pages; the
generative redesign is a separate, API-gated step.

## The result

| | |
|---|---|
| captured live | **99 / 104** |
| visibly adapted | **85** (engine surfaced a safe primitive) |
| reverted byte-clean | **99 / 99** — zero residue on revert |
| flagged by automated visual-acceptance | **2** (pleo, kahoot — a covered element; the engine would refuse to serve there) |
| couldn't capture | 5 (oneflow, voyado, mailerlite, bokio, attio — live load/consent/bot walls) |

The load-bearing number is **99/99 reverted clean**: every page the engine
touched came back exactly as it was. The 2 visual-issue sites are the automated
acceptance doing its job — flagging a covered bar/CTA that the runtime self-check
would refuse rather than serve. "No change" cards (a handful) are honest: the
engine found nothing safe to surface for that visitor, not a failure.

## Reproduce

```
# live crawl (Browserbase; Node + proxy env)
bun build scripts/fleet-shots/run.ts --target=node --format=esm \
  --outfile=fleet-shots.node.mjs --external playwright --external @browserbasehq/sdk
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node fleet-shots.node.mjs
# gallery
bun run scripts/fleet-shots/gallery.ts
```

Companion to `docs/fleet-loop.md` (the loop's numbers on fabricated traffic);
together they are the fleet's numbers and its pixels.
