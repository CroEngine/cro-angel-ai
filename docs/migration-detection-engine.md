# Migration plan — put this repo's detection engine behind the live product

**Status:** ⚠️ **conditional** (updated 2026-07-20). Phase 0 on glutenforum FAILED
the gate (content-SPA — engine adds no edge there). Phase 0b on plausible.io
showed the **CTA-precision edge is real on SaaS pages** (deriveHero = live LLM
rank-1, zero junk primaries) but **trust recall missed a quote-less testimonial
wall** — fix that in this repo's benchmark loop before any live integration.
See [`migration-detection-engine-phase0.md`](./migration-detection-engine-phase0.md).
**Author:** engineering (Claude Code session)
**Date:** 2026-07-20

## TL;DR

There are two Angel implementations sharing one Supabase project
(`upvthvbhqzqqimsyjpxw`):

- **The live product** (`angel_*` schema, a separate codebase) — actively
  serving adaptations to a real customer (`glutenforum.se`, 50% ramp), with a
  mature **serving + telemetry** stack: holdout, ramp, variants, 1,379
  conversions tracked, rage-clicks, form funnels, inventory-drift.
- **This repo** (`cro-angel-ai`) — a rigorous, **CI-gated detection engine**:
  trust-signal detection (98% precision / 84% recall), section/structure
  classification, primary-CTA selection (85.7% pick accuracy), all measured
  against hand-labelled corpora.

**Do not migrate the collector or the M0/M2 schema** — the live plumbing already
works and the M0/M2 tables are empty and unused (see
`supabase/functions/collect/README.md`). **Do migrate the detection layer**: the
live per-element content detection is measurably noisy, and this repo is built to
fix exactly that. The migration is **incremental, shadow-first, and additive** —
it never touches the serving hot path until the data proves a win.

This is a **hybrid**, not a replacement: this repo's deterministic detectors take
over trust / section / per-element CTA precision; the live LLM layer stays for
what it's genuinely good at (site-level goal ranking).

## Why — the evidence

All observed directly in the live `angel_content_inventory` / `angel_sites` on
2026-07-20 (read-only).

### 1. Per-element CTA classification is noisy

Real rows for `glutenforum.se`, with the live `meta.category` / `meta.intent`:

| CTA text | live `category` | live `intent` | reality |
|---|---|---|---|
| `Läs mer i vår cookiepolicy` | `cta_primary` | `trial` | cookie-policy link |
| `Förstora bild` / `Förstora bild 2` | `cta_primary` | `trial` | image-zoom buttons |
| `Kommentera` | `cta_primary` | `trial` | comment button |
| `Följ på Instagram` | `cta_primary` | `trial` | social follow |
| `E-post` | `cta_primary` | `trial` | mailto |

- `intent` is degenerate — it is `"trial"` on **every** row, including cookie,
  social, and image-zoom links.
- `category: cta_primary` is over-assigned to utility/nav/social/engagement
  elements.
- A secondary LLM pass (`meta.llmRole` = `legal` / `social` / `nav` / `other`)
  *partially* rescues this, but the deterministic `category`/`intent` fields — the
  ones a rules-based targeting engine would key on — are unreliable.

**This repo's detector rejects exactly these classes** (cookie / nav / utility /
social / weak-link) and is CI-gated at **85.7% primary-CTA pick accuracy**
(`src/lib/tests/structure-eval/`). Better CTA precision → the (good) serving
engine targets the right element instead of promoting a cookie link.

### 2. Trust-signal detection is missing

`glutenforum.se` day0 report concluded: **"No trust signals in the page copy."**
For a community site full of restaurant reviews (`Skriv en recension`), member
profiles (`Månadens glutenfria profil`), and comment threads, zero trust signals
is implausible — it points to a detection gap, not an empty page.

This repo ships a dedicated, CI-gated **trust detector at 98% / 84%**
(`src/lib/tests/trust-eval/`) covering testimonials, ratings, review counts, and
customer-logo walls (img + inline-SVG). Phase 0 will confirm the gap quantitatively.

### 3. Section typing is coarse

Live inventory carries a 3-way `section` (`header` / `hero` / `content`). This
repo classifies hero / testimonials / cards / features / pricing / faq / … with a
measured structure benchmark, giving the serving engine richer slots to adapt.

### What is already good (leave it alone)

- **Site-level goal ranking** (`angel_sites.goal_candidates`, LLM) is reasonable
  — for glutenforum it ranked "Besök forum", "Skapa inlägg", "Läs recept"
  sensibly. Keep the LLM here; the deterministic engine is weaker at open-ended
  multi-goal ranking.
- **Serving + telemetry** (holdout, ramp, variants, conversion attribution, rage
  clicks, form funnels, inventory drift) — mature and revenue-critical. **Out of
  scope. Do not touch.**

## Scope

| Migrate | Leave as-is |
|---|---|
| Trust-signal detection | Serving engine (holdout / ramp / variants) |
| Section / structure typing | Behavior telemetry + event schema |
| Per-element CTA precision (reject cookie/nav/utility/social) | Conversion attribution |
| Content-inventory enrichment | Site-level LLM goal ranking (keep as hybrid fallback) |
| day0 report findings (real trust signals) | Billing / notifications / members |
| | The `collect` Edge Function + M0/M2 schema (stay reference-only) |

## Integration architecture

This repo's engine already runs two ways — reuse both:

1. **Server-side** (`freeze` → `deriveHero` / `classifyType` / trust detection via
   the audit runners). Lower risk: runs in the crawl/day0 pipeline, writes better
   classifications. **This is the first integration point.**
2. **Client-side** (the eval-free detector bundle in `public/adaptive.js`,
   generated by `scripts/gen-detectors.ts`). Higher effort — it replaces the live
   snippet's "harvest" step at source. **Deferred to the last phase.**

**Adapter needed:** this repo emits a `ContentInventory` shape; the live store
uses `angel_content_inventory` rows (`site_slug`, `slot`, `item_id`, `selector`,
`meta` jsonb, `path`). A thin mapping layer writes engine output into `meta.*`
without changing the table.

## Phased plan

Each phase has an explicit gate; stop if the gate fails.

### Phase 0 — Shadow measurement (no writes) — **the gate**

Run this repo's engine over the live sites and compare to what the live system
already stored. **Nothing is written to the live product.**

- Freeze the real `glutenforum.se` pages already in `angel_content_inventory`
  (reuse the paths — recipes, forum threads, `/registrera`, restaurant pages).
- Run trust-eval + structure-eval + CTA selection on each.
- Produce a delta report:
  - CTA precision: how many current `cta_primary` rows this engine reclassifies as
    non-primary (cookie/nav/social/utility) — i.e. false-positive reduction.
  - Trust: how many trust signals this engine finds that day0 reported as zero.
  - Sections: richer typing coverage vs the 3-way live `section`.

**Gate:** proceed only if the engine eliminates a material share of CTA
false-positives **and** finds real trust signals day0 missed. If the deltas are
marginal, stop here — the migration isn't worth the risk.

*Effort: ~1–2 days. Fully reversible (read-only).*

### Phase 1 — Additive server-side enrichment

Wire the engine into the live crawl/day0 pipeline as an **enrichment pass** that
writes into **new** `meta` fields (e.g. `meta.v2Role`, `meta.v2Category`,
`meta.v2Trust`) **alongside** the existing ones — never overwriting. Regenerate
day0 with real trust findings.

- Serving still reads the old fields → **zero behavior change**, fully reversible
  (drop the new fields).
- Lets you compare v2 vs live classifications on live traffic without risk.

**Gate:** enrichment runs clean on all live sites; v2 fields visibly better on
spot-check. *Effort: ~3–5 days. Requires access to the live product's repo.*

### Phase 2 — Flip goal/CTA selection to the engine (per-site flag, hybrid)

Behind a per-site flag, point conversion/CTA selection at the engine's output,
with the **LLM as fallback** for low-confidence or novel-phrasing cases. Roll out
one site (glutenforum) first; measure conversion impact through the **existing
holdout** — no new measurement infra needed.

**Gate:** conversion rate for the engine-selected variant ≥ the LLM baseline over
a real sample, via holdout. Roll back = flip the flag. *Effort: ~1 week + a
measurement window.*

### Phase 3 — Client-side harvest swap (optional)

Replace the live snippet's harvest step with this repo's eval-free detector
bundle so inventory is high-quality **at source** (and cheaper — no per-crawl LLM
for the classes the detector covers). Only if Phases 0–2 prove the value.

**Gate:** client bundle size + CSP + SPA behavior verified on the live sites;
inventory parity or better vs Phase 1. *Effort: ~1–2 weeks, highest risk (touches
the live serving snippet).*

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Deterministic detector regresses on cases the LLM handles (novel CTA phrasings) | Hybrid: LLM fallback for low-confidence; Phase 0 quantifies where each wins |
| Cross-repo — the live detection code isn't in this repo | Phase 1+ needs access to the live product's repo; Phase 0 needs only read access to the DB |
| Touching a revenue pipeline | Phases 0–1 are read-only / additive; Phase 2 is per-site + holdout-measured + flag-reversible |
| Schema drift (`ContentInventory` ↔ `angel_content_inventory`) | Thin adapter into `meta.*`; additive fields first |
| Two schemas cause confusion | The M0/M2 collector stays explicitly reference-only (already documented) |

## Decision gate (what makes this worth doing)

Green-light the full migration only if **Phase 0** shows, on real glutenforum
pages:

1. **≥ 30%** reduction in `cta_primary` false-positives (cookie/nav/social/utility
   currently tagged primary), **and**
2. **real trust signals** found where day0 reported zero.

Both are directly measurable in Phase 0 at read-only risk. If either fails, the
detection edge is smaller than assumed and we stop.

## What I need from you

1. **Go/no-go on Phase 0** (read-only, ~1–2 days) — I can start immediately; it
   needs nothing but the DB access already in this session.
2. For Phase 1+: **access to the live product's repo** (the codebase that writes
   `angel_*`) — it's not in this session's scope yet.
