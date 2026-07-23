# E2 — Cohort profiles: "people who arrived the same way before"

**Date:** 2026-07-21 · **Snippet:** v0.10.0 · **Module:** `src/adaptive-lab/profile.ts`
**Proof:** 30 unit tests + `scripts/journey-e2e.ts` on four real sites

## What it is

A first-party, pseudonymous **journey memory** in localStorage. Per visitor:

- **Touch history** — how they arrived: channel + source (search/google,
  social/linkedin, ads, email, referral, direct), both **first touch**
  (preserved forever) and **last touch** (updated per arrival). UTM and
  click-id parameters outrank the referrer; internal navigation preserves
  the standing touch.
- **Visit count** — sessions split on a 30-minute gap.
- **Pages seen** — ring buffer (≤30) of paths with their detected section
  types, plus a **sticky `seenPricing` flag** (by path or by detected
  pricing section).

Bounded and safe by construction: 90-day TTL, 6KB size cap with oldest-page
eviction, versioned schema (unknown versions reset cleanly), and throw-proof
— storage failure (private mode, quota) degrades to "no profile", never to a
host-page error. First-party only; the profile never leaves the browser in
this milestone.

## What it unlocks

**1. price_hesitant on the homepage.** The night-1 sweep's biggest product
finding was that price patterns aimed at the wrong surface: 0/97 homepages
could ever fire `price_hesitant` (pricing lives on subpages). The profile
closes it: `seenPricing` counts as pricing context in `deriveSegment`.
Journey-proven on four real sites — google-referred `/pricing` visit, then a
LinkedIn-campaign homepage landing in the same browser context:

| site | homepage has own pricing section | derived on homepage |
|---|---|---|
| monday | no | **price_hesitant** |
| asana | no | **price_hesitant** |
| posthog | no | **price_hesitant** |
| ahrefs | no | **price_hesitant** (+ risk_reducer_bar applied) |

Touch history asserted end-to-end: firstTouch stayed `search/google`,
lastTouch became `social/linkedin`, restores byte-clean.

**2. The cohort vocabulary for E4b.** `deriveCohorts()` emits stable keys —
`ch:social`, `src:linkedin`, `ret:new|2plus`, `seen:pricing` — exposed as
`__angelAdaptive.cohorts`. These are the identifiers owner-approved rules
("visitors arriving from LinkedIn see proof first") will be scoped to, and
the grouping key for the Claude Designer's per-cohort briefs (E3 → E4).

## Honest findings

- **The segment now fires; the patterns need homepage sources.** Three of
  four journey sites applied nothing for price_hesitant on the homepage:
  `risk_reducer_bar` wants guarantee/trial copy (present on ahrefs, absent
  on the others) and `pricing_spotlight` wants an on-page pricing section.
  A homepage-appropriate price pattern (e.g. surfacing the pricing LINK, or
  cross-page proof) is follow-up work — the decision layer is no longer the
  blocker.
- **Consent posture is a product decision still ahead:** the profile is
  functional first-party storage (same class as the existing visitorKey),
  but serving cohort-personalized content in the EU should go through the
  site's consent mode before GA. Flagged for the pilot checklist.
- `ret:` semantics are session-based (30-minute gap), so a pricing→home hop
  within one session is `ret:new` — correct, and worth remembering when
  reading cohort data.
