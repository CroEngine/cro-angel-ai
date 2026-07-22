# Fleet page-map audit — does the engine map the start page correctly?

**Date:** 2026-07-22 · **Capture:** `scripts/fleet-shots/run.ts` with `FLEET_MAP=1`
**Gallery:** `scripts/fleet-shots/map-gallery.ts` → `docs/fleet-map-2026-07-22/map-part{1,2}.html`
**Data:** `docs/fleet-map-2026-07-22/manifest.json` (`img/` is gitignored — regenerable)

## What it is

Before trusting the engine to *rearrange* a page, we have to know it *maps* the page
correctly. This audit overlays the engine's own detected section map on each live
start page — every section boxed and labeled `#index type · heading` — and reads out
the trust signals it found. It's the same inventory the product runs
(`public/adaptive-lab.js`), just made visible.

## The result — 102 / 104 start pages mapped

| | |
|---|---|
| pages mapped | **102 / 104** (bokio: redirect loop; attio: page crash) |
| **sections typed (not generic `content`)** | **390 / 1111 = 35 %** |
| **sites with proof LINKED to a section** | **0 / 102** |
| sites with a proof-*typed* section (testimonials/logos/stats) | 66 / 102 |

Section-type histogram (1111 sections):
`content:721  testimonials:104  hero:69  header:61  nav:50  footer:48  form:29  faq:16  cards:7  benefits:3  features:3`

## What it proves

**Boundaries are good; typing is not.** The boxes line up with the real visual
sections — boundary detection works. But:

1. **65 % of sections are generic `content`.** The classifier vocabulary is tiny —
   there is **no `logos`, `stats`, `cta`, or `pricing` section type at all**, and
   `features`/`benefits` barely register (3 + 3), so feature grids, logo walls, stat
   strips, and CTA bands all collapse into `content`.
2. **0 / 102 sites link proof to a section** — `containsTrustSignals` is effectively
   never set. The detectors *find* the testimonials/logos/ratings (trust detection is
   98 %/84 %), but nothing marks *which section contains them*. This is the single
   reason `reorderProofFirst` can't find "the proof strip" to move up.
3. **Mislabels:** 22 sites get a mid-page section typed `header` (clickup, basecamp,
   scrive, whereby…); heroes occasionally type as `testimonials` (asana).

## The fix, in leverage order

1. **Link trust signals → their section** (set `containsTrustSignals`, and promote the
   containing section to a proof type). Fixes the 0/102 and directly unblocks reorder.
2. **Grow the type vocabulary** — `logos` / `stats` / `cta_band` / real `features`,
   and capture headline stat numbers (384 % / $3.1M / 85 % …) as proof.
3. **Fix the mislabels** — mid-page `header`, hero-as-`testimonials`.
4. **Re-run this audit** to confirm typing improved — the map is its own regression gate.

## Reproduce

```
bun build scripts/fleet-shots/run.ts --target=node --format=esm \
  --outfile=fleet-shots.node.mjs --external playwright --external @browserbasehq/sdk
FLEET_MAP=1 FLEET_CAP_H=16000 FLEET_RETRIES=1 NODE_USE_ENV_PROXY=1 \
  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node fleet-shots.node.mjs
bun run scripts/fleet-shots/map-gallery.ts
```
