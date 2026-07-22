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

> The numbers in this section are the **baseline discovery** (v0.14) that motivated
> the fix. The committed manifest now reflects **v0.15** (fix #1) — see *The fix* below
> for the before → after. The gallery renders the current (v0.15) maps.

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

1. **Link trust signals → their section** — ✅ **SHIPPED (v0.15).** `assembleInventory`
   now matches every proof signal's centre to the smallest section that contains it,
   setting `containsTrustSignals` from geometry (not the never-set detector flag) and
   promoting a generic `content` section to a proof type (`logos` / `stats` /
   `testimonials`). **Measured fleet-wide before → after:**

   | | baseline (v0.14) | v0.15 |
   |---|---|---|
   | sites with proof **linked to a section** | **0 / 102** | **92 / 101** |
   | sections typed | 35 % | **42 %** |
   | `logos` / `stats` sections | 0 / 0 | **46 / 27** |

   The load-bearing move: reorder can now find the proof strip on 91 % of the fleet
   (it couldn't on any). Confirmed on the real clickup DOM — the "Trusted by the best"
   wall → `logos [TRUST]`, the 384 %/$3.1M and 85 %/3M+ strips → `stats [TRUST]`.
2. **Grow the type vocabulary** — ✅ **SHIPPED (v0.16).** `structuralType` in
   `assembleInventory` categorises each still-`content` section by DOM structure (not
   heading — headings are marketing copy): `<video>`/video-iframe → **video**,
   `<details>`/accordion → **faq**, `<table>` → **comparison**, ≥6 imgs + apps/integration
   heading → **integrations**, repeating card grid → **cards**, short headline+button →
   **cta**. Genuine prose stays `content`. **Measured fleet-wide: `content` 65% → 31%**
   (typed 35% → **69%**). Histogram: `cards:166 · video:64 · cta:49 · logos:44 · faq:35 ·
   stats:26 · integrations:17 · comparison:2` (+ testimonials/hero/form). Every section
   now has a real category — the "koll" the founder asked for.
3. **Fix the mislabels** — 22 mid-page `header`s, hero-as-`testimonials` (asana).
4. **Re-run this audit** to confirm — the map is its own regression gate (as above).

## Reproduce

```
bun build scripts/fleet-shots/run.ts --target=node --format=esm \
  --outfile=fleet-shots.node.mjs --external playwright --external @browserbasehq/sdk
FLEET_MAP=1 FLEET_CAP_H=16000 FLEET_RETRIES=1 NODE_USE_ENV_PROXY=1 \
  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node fleet-shots.node.mjs
bun run scripts/fleet-shots/map-gallery.ts
```
