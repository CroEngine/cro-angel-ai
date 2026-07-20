# Phase 0 findings — shadow measurement on glutenforum.se (+ Phase 0b SaaS rerun)

**Date:** 2026-07-20
**Verdict (glutenforum): gate FAILED on both criteria → do NOT migrate on this evidence.**
**Verdict (Phase 0b, plausible.io): PARTIAL — the CTA-precision edge is real on SaaS;
trust recall missed a textbook testimonial wall.** See [Phase 0b](#phase-0b--saas-rerun-on-plausibleio) below.
**Reproduce:** `scripts/phase0-glutenforum.ts` / `scripts/phase0-saas.ts` (see headers for the Node/Browserbase run).

## What ran

The **real** production engine (v1.18.0 — `COLLECT_SCRIPT` + `runPageAudit`, the
exact calls `replayCorpus` makes) against **7 live glutenforum.se pages** rendered
through a Browserbase remote browser, compared to what the live `angel_*` system
stored in `angel_content_inventory` (captured 2026-07-20). Read-only — nothing was
written to the live product. This is a genuine run, not a hand-approximation.

Pages: `/`, `/registrera`, two recipe pages, a grocery-item page, a profile page,
a restaurant page — chosen to overlap the live inventory's known CTAs.

## The two gate criteria — both failed

### 1. CTA false-positive reduction — target ≥30%. Result: not demonstrated.

The engine's **per-element `category: cta_primary` is over-broad, just like the
live system's.** It reported 8–11 "primary" CTAs per page and kept as `cta_primary`
the same false positives the live system did: cookie-policy links, image-zoom
buttons ("Förstora bild"), "E-post", "Följ på Instagram". Measured head-to-head at
that layer, only 1 of 8 known live FPs was demoted (~13%).

The engine's **precise** layer, `deriveHero` (the single primary-CTA pick), *did*
avoid the gross FPs — it never picked a cookie or image-zoom link. But on this site
its picks were weak:

| page | engine `deriveHero` primary CTA | assessment |
|---|---|---|
| `/` (home) | **"Genom tiderna"** | a nav/menu item — wrong |
| `/registrera` | "Registrera med Google" | reasonable |
| recipe / grocery / profile / restaurant | **"Skapa recept"** (all of them) | generic nav action, not the page's goal |

The live system's site-level `goal_candidates` (LLM) picked *more* contextual goals
("Besök forum", "Skapa inlägg", "Läs recept"). So the engine's single-pick is **not
clearly better** than what's live.

The homepage hero also came out garbled (headline
`"Dazzley glutenfria kladdkaka! Toppen-produkt.Forum"`), i.e. the engine
mis-parses this SPA's structure.

### 2. Trust signals day0 missed — Result: not meaningfully.

Every page returned exactly **one** trust signal, and it was the same site-wide
footer `contact_info` on all 7. **No testimonials, ratings, review counts, or
logos.** glutenforum is full of restaurant reviews and recipe ratings — and the
engine misses them too. So it does not meaningfully refute day0's "No trust
signals"; both systems are blind to this site's actual social proof.

## Why the engine doesn't win here

The engine's measured strengths (trust 98%/84%, CTA pick 85.7%, section F1 ~60%)
were **benchmarked on SaaS / marketing landing pages** — hubspot, linear, stripe,
etc.: English B2B pages with a clear hero, a single conversion CTA, testimonial
blocks, and logo walls. **glutenforum.se is a Swedish community/content SPA**
(recipe views, forum threads, grocery items, profiles). Its structure is nothing
like the benchmark corpus, so the engine's hero/CTA/trust heuristics don't
generalize to it out of the box — and neither the live system nor this engine has
an edge on it.

## Strategic note — this site's goal is bounce/continuation, not CTA clicks

glutenforum's live `test_metric` is **`continuation`** and its business type is
`media`. The lever for a content site is engagement / reduced bounce (internal
linking, content recommendation) — **not** picking the perfect conversion CTA.
This repo's whole edge is CTA/trust *precision*, which is largely **orthogonal to
the metric that matters for this customer**. Even a flawless CTA detector would do
little for glutenforum's bounce rate.

## Recommendation (superseded by Phase 0b below — kept for the record)

**Stop.** The decision gate exists to prevent sunk cost, and it says no: the
detection edge that justified the migration is not present on the actual live
customer's site.

If the idea is still worth exploring later, do it in this order, cheapest first:

1. **Re-run Phase 0 on a SaaS-type customer site** (the engine's home turf) before
   any live integration. The engine may well win there; it just doesn't on a
   Swedish content SPA. Don't generalize from — or to — glutenforum.
2. **Fix the live system's actual CTA bugs directly** — `intent:"trial"` on every
   element, cookie/image-zoom links as `cta_primary` — with a small targeted rule
   in the live codebase. That's far cheaper than adopting this whole engine and
   captures most of the observable quality gap.
3. For glutenforum specifically, invest in **engagement/bounce** signals, not CTA
   precision — that's where its `continuation` goal actually moves.

---

# Phase 0b — SaaS rerun on plausible.io

Step 1 of the recommendation, executed same day. plausible.io is the live
product's own "Plausible Lab" site, so the live LLM baseline exists
(`angel_sites.goal_candidates`, 2026-07-20): rank 1 **"Start free trial"**,
rank 2 "View live demo", rank 3 "Contact us". Engine run: 3 live pages
(`/`, `/vs-google-analytics`, `/register`) via Browserbase, read-only, with
full-page screenshots as ground truth (`scripts/phase0-saas.ts`).

## CTA / hero — PASS, convincingly

| page | engine hero headline | engine `deriveHero` pick | junk in `cta_primary` |
|---|---|---|---|
| `/` | "Easy to use and privacy-friendly Google Analytics alternative" (clean parse) | **"Start free trial"** = live LLM rank 1 | **none** (9 primaries, all genuine: trial/demo/contact) |
| `/vs-google-analytics` | clean | "Start free trial" | none |
| `/register` | "Start your 30-day free trial" | "Start my free trial" (the form submit — correct) | none |

On its home turf the engine matches the live LLM's top goal **deterministically
and per-page** (no LLM call, no cost), with zero cookie/nav/social junk in the
primary set — the exact failure class the live system shows on glutenforum. The
CTA-precision edge is **real for SaaS-type pages**.

## Trust — FAIL on recall, and the evidence trail says why

The homepage visibly carries (verified in the full-page screenshot):
a **"People ❤️ Plausible" section with six testimonial cards** (DHH/37signals,
Clem Delangue/Hugging Face, John O'Nolan/Ghost, Cyrus Shepard, Rob Hope, Laura
Roeder) and a **stats row: 19k paying subscribers · 260B pageviews · 99.99%
uptime**.

The engine found **1** trust signal (`certification` — the "Made and hosted in
the EU" badge). The trust-debug trail shows the testimonial cards **never became
candidates at all** (only two prose paragraphs reached the text-pattern stage;
both correctly rejected). Root cause: plausible's testimonials are **quote-less
avatar cards** (no quotation marks / blockquote), a markup shape the detector
doesn't key on. Consistently, the section classifier typed that section `content`,
not `testimonials`.

So the 98%/84% benchmark numbers do **not** transfer to this common modern
markup — the benchmark corpus under-represents quote-less card testimonials.

## Refined conclusion (replaces "stop")

1. **The migration idea is alive but conditional.** The engine's CTA layer beats
   the live system's known failure modes on SaaS pages and matches the LLM's top
   goal without an LLM. Its trust layer is **not** ready to claim superiority in
   the wild.
2. **Next engineering step is in THIS repo, not the live product:** add
   quote-less avatar-card testimonial detection (and the stats-row pattern), put
   plausible.io in the trust-eval + structure-eval corpora, fix, re-measure —
   the same CI-gated hardening loop used for v1.12–v1.18.
3. **The live product's cheap win stands:** fix `intent:"trial"`-on-everything
   and cookie/zoom-links-as-primary directly in the live codebase regardless of
   any migration.
4. **glutenforum:** unchanged — its lever is bounce/continuation, not CTA
   precision; neither engine addresses that today.
