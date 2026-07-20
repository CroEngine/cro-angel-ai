# Adaptive sweep — the write-side loop on 101 real sites, driven by fabricated visitor data

**Date:** overnight 2026-07-20→21 · **Runner:** `scripts/adaptive-sweep.ts` ·
**Snippet:** the shipped `public/adaptive.js` (v0.4 + the time-unit fix)
**Dataset:** `adaptive-sweep-FINAL.json` (scratchpad) · per-site before/after screenshots

The question: *given visitor data, does the whole write side work — segment
decision, page adaptation, clean restore — across the full day-0 site list?*
The "improvised user data" is four fabricated personas injected as real
tracker-shaped event streams; `adapt()` is called with **no** argument so the
segment is **derived from that data** — decision layer and patterns are tested
together, end to end.

| persona (fabricated events) | expected segment | derived correctly |
|---|---|---|
| skimmer (scroll 12 %, 8 s) | new_skimmer | **97/97** |
| reader_no_click (scroll 88 %, 95 s, 0 clicks) | engaged_no_click | **97/97** |
| price_checker (scroll 72 %, 60 s) | price_hesitant *or* fallback | **97/97** (all fell back — see finding 1) |
| clicker_control (clicked a CTA) | default | **97/97** |

## Headline results

| metric | result |
|---|---|
| sites run end-to-end | **97 / 101** (4 failures, all harness-class, named below) |
| segment derivation correct | **388 / 388 persona-runs (100 %)** |
| restored byte-clean after revert | **97 / 97 (100 %)** |
| trust_bar found real social proof | 84 / 97 (87 %) |
| CTA emphasis applied | 78 / 97 (80 %) |
| honest refusals (no content → no change) | 13 sites got no trust bar; 0 fabricated texts |

Demo-quality bar texts, all from the pages' own content: monday *"Trusted by
over 60 % of the Fortune 500"*, clickup *"RATED 4.7/5 BY 10,000+ USERS ON
G2"*, scrive 🇸🇪 *"Trusted by 13 000+ customers"*, deel *"4.8/5 | 14K+
Reviews"*, render *"TRUSTED BY OVER 6 MILLION BUILDERS"*, netlify *"10M+
developers"*. Screenshot-verified: monday and deel look native with the bar +
emphasized hero CTA; pages remain visually intact.

## Fördelar (proven advantages)

1. **The decision layer is deterministic and correct** — 100 % of persona
   streams derived the expected segment after the ms/seconds fix. Data in,
   right segment out.
2. **Reversibility holds at scale** — 97/97 pages back to byte-clean. The core
   product promise ("allt är ångrabart") is now measured, not asserted.
3. **The safety stance works** — on content-poor pages the system applies
   *nothing* rather than inventing copy (13 honest refusals, 0 fabrications).
4. **Cross-site robustness** — one pattern set produced native-looking
   adaptations on 97 wildly different SaaS designs without breaking layout
   (the two v2 primitives — style-in-place + isolated top bar — carry it).
5. **The full loop is fast** — inject → inventory → decide → adapt in ~2-4 s
   per page in-browser; nothing server-side in the hot path.

## Nackdelar (proven disadvantages, with fixes)

1. **price_hesitant never fires on homepages: 0/97 pricing sections found.**
   Pricing lives on /pricing subpages, not the front page. The price patterns
   are correctly built but aimed at the wrong surface — the loop must run on
   pricing pages (and cross-page visitor profiles must carry "visited
   pricing") before this segment earns its keep. Biggest product insight of
   the night.
2. **Bar-text quality needs a gate.** A few of the 84 picks are weak: trustly
   *"“Case Study”"* (label, not proof), funnel *"Widget rating"* (internal
   caption), kahoot truncated mid-word ("loved by billi…"). Fix: minimum
   length, no label-only strings, prefer numeric claims, truncate on word
   boundaries.
3. **13/97 pages got no trust bar** despite most having social proof somewhere
   — carousel-hidden or non-text proof the inventory misses. Recall work.
4. **4 harness failures, all one class:** sites that reload/navigate
   mid-run (oneflow, bokio: delayed consent-reload; contentful: the known
   intermittent DOM race; personio: modal delayed settle past timeout). Fix is
   a navigation-aware retry in the harness — the snippet itself is unaffected
   (in production it loads with the page, not injected mid-session).
5. **Only one bar slot.** trust_bar and risk_reducer_bar share the top slot by
   design (no banner stacking), which caps how much one segment can show.

## Reproduce

```bash
bun build scripts/adaptive-sweep.ts --target=node --format=esm \
  --outfile=asweep.node.mjs --external playwright --external @browserbasehq/sdk
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  node asweep.node.mjs --from=0 --to=104
```

## Next steps this measurement justifies

1. Run the loop on **/pricing pages** so price_hesitant + pricing patterns get
   a fair test (and add "visited pricing" to the cross-page profile).
2. Bar-text quality gate (cheap, high demo value).
3. Navigation-aware harness retry for the 4-site class.
4. Free-trial copy as a risk_reducer source (plausible's "30-day free trial").

---

# Addendum (night 2): pricing pages, visual acceptance as code, site-aware theming

## Pricing insight — proven on the right surface

31 real /pricing pages (27 audited; 4 network-class failures incl. bokio's
self-navigating page). **price_hesitant now fires: 12/27** (vs 0/97 on
homepages) — airtable, webflow, posthog, hotjar, amplitude, ahrefs, front,
dropbox, todoist, smartsheet, mercury, mentimeter-plans. pricing_spotlight
applied 24 times, risk_reducer_bar 8.

**New honest findings:** (a) the section classifier detects a pricing section
on only 12/27 genuine pricing PAGES — plan-card grids without a "pricing"
label heading are a recall gap (next classifier fix); (b) risk-bar sources
picked weak texts ("HIPAA Compliance", a FAQ *question* "What is your refund
policy?") — FAQ-headings must be excluded (trailing "?") and plan-card
microcopy ("No credit card required" — visible on posthog's cards) must become
a source; the hero/heading fields alone miss it.

## "Nothing may look off" — now enforced by code, not eyeballs

Every applied adaptation is hit-tested in-page (bars: full-width, sane
height, visible at own midpoint via elementFromPoint; emphasized CTAs:
hit-testable at center). Plus a new guard: bar patterns REFUSE when a
viewport-wide position:fixed top header would paint over the bar (sticky/
static headers are pushed correctly — screenshot-verified on monday/deel).

Results: pricing runs 52/56 visually clean; homepage QA sample (incl. dark
sites sentry/railway/posthog with the new theme palette) 38/44 clean. The
checks CAUGHT real issues: mercury + mailchimp emphasis covered by overlay
elements; mentimeter/deel late-mounting cookie modals covering the page
(harness dismiss timing, not a pattern bug). Dark-theme bars render natively
on all three dark sites.

## Section REORDERING — the direct answer

Angel deliberately does NOT reorder sections today: pattern-library v1 moved
DOM nodes and broke real grids (HubSpot), so v2 restricted primitives to
style-in-place + one isolated top bar. If reordering returns it will be as
CSS `order` swaps *inside flex/grid parents only* (no DOM moves), gated by
the same visual acceptance checks — roadmap, not shipped.

---

# Addendum (night 3): the reorder primitive across all 101 sites

**v0.6 → v0.6.1** (`reorder_proof_first`): the testimonials section is moved
to sit right after the hero for the engaged_no_click segment — CSS `order`
only, never DOM moves. Block parents are promoted to flex-column; v0.6.1
generalized targeting to the nearest COMMON ANCESTOR (sections usually sit in
per-section wrappers). The pattern self-checks every sibling rect after
applying and ROLLS ITSELF BACK on any deviation (width/left ±2px, height
±12px, no overlaps, page height ±3%); every refusal reports a named reason.

## Numbers (95/101 sites ran; 0 dirty restores anywhere)

| | count |
|---|---|
| reorder-eligible (testimonials detected, sitting late) | 42 |
| **applied, provably clean** | **13** (monday, asana, zapier, deel, fortnox 🇸🇪, funnel 🇸🇪, sanity, amplitude, semrush, surferseo, mercury, framer, calcom) |
| refused: wrapper carries other sections (structurally impossible without DOM surgery) | 10 |
| refused: sections share one wrapper child | 9 |
| refused: self-check caught visual deviation → auto-rollback | 8 |
| selector miss | 1 |

31% of eligible sites reorder cleanly; the rest REFUSE with named reasons —
the two wrapper classes (19) are the honest boundary of what CSS `order` can
do safely; crossing it means framework-aware DOM moves (future work, E4+).

## Gallery (user-facing proof)

`scripts/showcase-reorder.ts` produced identical-condition full-page
BEFORE/AFTER pairs — consent dismissed/hidden (photo rig only), lazy sections
scroll-rendered: zapier (Superhuman quote + 42%/87% stats now directly after
hero), funnel 🇸🇪, framer, semrush, surferseo, mercury. Screenshot-verified:
same design, no banner, only the order differs.

Honest note: 7 of the sweep's 13 applied sites refused in the showcase pass —
post-scroll animation state (translateY transitions) makes the self-check
extra conservative right after scrolling. Correct behavior (refusal beats
risk), logged as a calibration item: settle-wait before adapt in post-scroll
contexts.
