# adaptive-lab — perception / research sandbox

**Not the product.** Per [ADR-001](../../docs/adr-001-go-forward-engine.md) the
go-forward customer engine is **server-decides**: the snippet `public/adaptive.js`
applies ops the server Decision Engine returns via `/api/adaptive/decide`. This
directory is the client-autonomous **lab** — a fast perception + pattern research
sandbox that no customer ever loads.

## What it's for

- **Perception research**: the richest section/proof/structural inventory
  (`inventory.ts` — structural typing, proof→section linking) — the reference the
  product ports from (ADR steps 2–3 were harvested from here).
- **Pattern prototyping**: self-checked reorder (`tryOrderMove`), trust-bar
  surfacing, segment rules — tried here first, against live sites, before the
  product-grade equivalent is designed for the server engine.
- **Fleet evidence**: `scripts/fleet-shots/` (before/after + section-map
  galleries), sweeps, the offline designer-brief (`scripts/designer-brief.ts`).

## Build & run

```
bun run build:lab        # → artifacts/lab/adaptive-lab.js (gitignored artifact)
bun run smoke:adaptive   # prove the bundle self-runs (demo page)
```

The bundle lives in `artifacts/lab/` — deliberately OUT of `public/` (ADR step 4)
so it can never deploy or be loaded by a customer page. Every consumer is a
script; grep `artifacts/lab/adaptive-lab.js` for the current list.

## Rules of the road

- Harvest INTO the product (`src/adaptive/*`, `public/adaptive.js`) — never point
  a customer at the lab.
- The lab may break; the product may not. Product invariants (byte-clean revert,
  owner gating, measurement honesty) are enforced in the product's own tests
  (`scripts/ci/serving-smoke.mjs`, `src/adaptive/runtime/__tests__/`).
