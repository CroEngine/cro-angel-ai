<!-- Genererad av wave8-pattern-design-workflown (3 förslagslinser → domarpanel → syntes),
     källverifierad mot patterns.ts/decide.ts/types.ts/crawler-inventory.ts + frusna arketyper.
     Implementationen i denna våg följer specen; avvikelser dokumenteras i PR-texten. -->

# Wave 8 Pattern Spec — Vertical Coverage for Non-SaaS Goal Kinds (FINAL)

Synthesized from the psychology + implementability lens proposals and judge verification. Source constraints verified against `/home/user/cro-angel-ai/src/adaptive/patterns.ts`, `decide.ts`, `types.ts`, `crawler-inventory.ts` (MICROCOPY_PATTERNS L240, trust-text→textPool L836), `src/lib/tests/robustness/runner.server.ts`, `corpus/README.md`.

**Selected: 6 patterns. Rejected/deferred: 9 (incl. 3 merges).**

---

## 0. Shared engine prerequisite (ships first, in this wave)

### W8-E1 — Goal-anchored `inject_badge` (required by S2, S3, S6)
Judge-confirmed defect: the `inject_badge` branch of `resolve()` (decide.ts L343-360) hardcodes `target: '[data-angel-slot="cta"]'` with no `anchorText`, so every badge pattern silently fails to render on un-instrumented (crawled) pages while still logging exposure.

Change, in `resolve()` only (no new op, no snippet change — `resolveNodes` already handles selector+anchorText, same mechanism as `inject_sticky`/`inject_secondary`):
- When `goal?.selector || goal?.text` exists: emit `target = goal.selector ?? ""`, `anchorText = goal.text ?? undefined`, keep `slot: "cta"` as drift fallback. When no goal: keep the current slot-convention target (instrumented demo pages unaffected).
- Let the badge's **text source** be `pattern.slot` when it is not `microcopy` (needed by S2, which draws from `trust_badge`), with a per-pattern `pickItem` predicate + shape guard. Microcopy-sourced badges keep the strict `MICROCOPY_KIND` match.

Side benefit: fixes the three **existing** badge patterns (`show_no_credit_card`, `show_2min_setup`, `continue_where_left_off`) on all crawled sites. Regression assert: hubspot robustness run, `paid_high_intent` persona — `show_no_credit_card` now renders beside the goal and reverses.

### W8-E2 — Filtered secondary-CTA variant (required by S4, S5)
Generalize the `show_secondary_cta` branch: `SECONDARY_TEXT: Partial<Record<PatternId, RegExp>>` — same `isAcquisition` + `href` + `!= goal` + no-`javascript:` guards verbatim, plus a required text match. Decline `no_secondary_alternative` when no CTA matches.

### Plumbing (mechanical)
`PatternId` union in types.ts +6 ids; `PATTERNS` entries; new `RULES` entries in decide.ts (priorities below — note: priority lives on the **nominating rule**, not the Pattern); `MICROCOPY_KIND` +2; `MICROCOPY_PATTERNS` +1 kind, +1 variant on `guarantee`.

---

## 1. Selected patterns

### S1. `move_reviews_up` — judge 8.0 (highest of wave)
- **appliesTo:** `["booking","purchase","start_flow","subscribe","lead","quote"]`
- **Rule/priority:** new rule `first_time_social_proof`, priority **58**, `when: !c.isReturning` (below `google_organic` 60, above `cold_soft_path` 55).
- **Ops:** `move_up` on slot `testimonial`. Identical mechanics to `move_faq_up`/`surface_pricing` — generic resolve path, zero engine change.
- **Inventory/microcopy:** none new. Verified: testimonials/reviews sections + testimonial trust type map to the slot with selectors on live harvest; present at position 18/24 (cdon), 8/15 (bokadirekt-service), 7/35 (sector-alarm), plus elskling, nextory.
- **Test plan:** robustness run on **bokadirekt-service** (booking) and **cdon** (purchase), personas `linkedin_desktop` + `google_mobile`: targetingRate 1 via harvested selector, layout-shift under warn threshold, zero residue after `reset()`. Decline correctness: **cancerfonden** → `no_inventory_for_slot`; donate → `goal_kind_mismatch`.
- **Accepted risk (judge caveat, carried into the spec):** `touchesLcp` guards only the moved element — hoisting a section can push the LCP hero down. Same profile as existing move patterns; the layout-shift assertion is the watchdog.

### S2. `show_rating_near_goal` — judge 7.5 (absorbs `show_review_rating_early`, 6.0)
- **appliesTo:** `["booking","start_flow"]`
- **Rule/priority:** new rule `decision_point_proof`, priority **62**, `when: !c.isReturning`. Deliberately below `mobile_sticky_goal` (72): sticky wins the injection budget on `google_mobile`; the badge fires on desktop personas.
- **Ops:** `inject_badge` (via W8-E1) drawing text from the `trust_badge` slot, goal-anchored. `pickItem` predicate restricted to `meta.trustType ∈ {review_rating, stars, stars_aggregate}` (the `show_enterprise_testimonial` lesson — a GDPR cert must never surface under a rating label), plus text-shape guard `/^\d[\d\s.,·]*\s*(betyg|omd[öo]men|reviews?|av 5)/i` (implementationen vidgar spec-utkastets klass med interpunkt `·` — "4.8 · 2138 betyg" är standardformen på ratingsammanfattningar; pinnad i decide.test.ts). Requires `selector`+`text` on the item (live harvest); declines otherwise.
- **Inventory/microcopy:** none new, nothing invented — badge text is the site's own harvested rating verbatim (bokadirekt-service publishes "2138 betyg", judge-verified).
- **Test plan:** robustness run on **bokadirekt-service**, confirmed `kind=booking` (goal "Boka"): exactly one badge, textContent equals the page's own rating text, anchored beside the goal, budget respected vs sticky on mobile, zero residue. Secondary: **elskling** (`start_flow`) exercising the shape guard both ways. Negative unit: cert-only trust inventory declines, never renders.

### S3. `show_payment_security` — judge 7.5 (absorbs `show_secure_payment_early`, 7.0)
- **appliesTo:** `["purchase","subscribe","booking","donate"]`
- **Rule/priority:** new rule `payment_trust`, priority **64**, `when: !c.isReturning || c.trafficSource === "google_ads"`.
- **Ops:** `inject_badge` (W8-E1), goal-anchored, from new microcopy kind.
- **Inventory/microcopy:** new `MICROCOPY_PATTERNS` kind `payment_security`: `/s[äa]ker betaln|trygga? betaln|secure (payment|checkout)|s[äa]kra betalningar/i` + `MICROCOPY_KIND` entry. Judge-verified path: `mapAuditToInventory` pushes every trust-signal text into the microcopy textPool (crawler-inventory.ts L836), and cdon's `secure_payment` signal carries "Säker betalning" verbatim — the phrase materializes on replay of the existing frozen capture with only the regex addition.
- **Test plan:** unit — `extractMicrocopy` over the cdon replay textPool yields exactly one `payment_security` item. Robustness on **cdon** (purchase, goal "Köp nu"), `paid_high_intent` + first-time: one badge, verbatim published text near the goal, one-inject budget, reversible. Declines: **nextory**/**hubspot** → `no_microcopy` (never fabricates security copy); **hubspot** `kind=signup` / **sector-alarm** `kind=lead` → `goal_kind_mismatch`.
- **Why the badge, not the security-slot move:** judge finding — within-parent `move_up` of a (typically footer) payment-icons row does not deliver proximity to the decision; the goal-anchored badge does. The still-unconsumed `security` slot is noted as a future move target, not part of wave 8.

### S4. `show_monthly_giving_option` — donate representative (impl-lens; frozen-capture evidence verified in proposal)
- **appliesTo:** `["donate"]`
- **Rule/priority:** new rule `donate_recurring_path`, priority **56**, `when: !c.isReturning && c.visitCount === 0` (cold first-timers, same trigger as `cold_soft_path`). At 56 it deterministically beats generic `show_secondary_cta` (55) for the single injection slot on donate sites — the specialized offer wins.
- **Ops:** `inject_secondary` on slot `cta` via W8-E2, filter = the already-shipped donate `KIND_TEXT` recurring vocabulary (`(bli )?månadsgivare|monthly (donor|giving)`), href must differ from the goal. Reuses `isAcquisition` + href guards verbatim.
- **Inventory/microcopy:** none new. cancerfonden's "Bli månadsgivare" is a curated acquisition CTA with href `/stod-oss/bli-manadsgivare` (verified in the frozen MHTML); goal is "Ge en gåva".
- **Test plan:** robustness on **cancerfonden**, confirmed `kind=donate`, first-time persona: exactly one `.angel-secondary-cta`, href is the site's own monthly-giving URL, text verbatim "Bli månadsgivare", budget one, zero residue. Gate: `goal_kind_mismatch` on every non-donate archetype; `no_secondary_alternative` when the recurring CTA is itself the goal.
- **Safety:** both options are the org's own published offers; no guilt-framing, no urgency.

### S5. `show_callback_option` — lead/quote/contact representative (impl-lens)
- **appliesTo:** `["lead","quote","contact"]`
- **Rule/priority:** new rule `high_consideration_channel`, priority **56**, `when: !c.isReturning && c.visitCount === 0`. Same beats-generic-secondary logic as S4.
- **Ops:** `inject_secondary` via W8-E2, filter = lead `KIND_TEXT` callback vocabulary (`vi ringer upp|ring mig|bli uppringd|boka (ett )?samtal|kontakta (mig|dig|oss)|request a call(back)?`), href ≠ goal.
- **Inventory/microcopy:** none new except one `KIND_TEXT` variant: `kontakta dig` — evidence: sector-alarm frozen capture ("Låt oss kontakta dig!" is the top curated CTA on the golden) **plus** a `vocab-harvest-2026-07-06.json` re-check to clear the documented ≥2-independent-sites bar before merging (corpus/README.md rule).
- **Test plan:** robustness on **sector-alarm**, confirmed `kind=quote` (goal "Få pris på larm"), first-time desktop: one secondary link with the site's own callback text/href beside the goal, interaction probe clean, reversible. Declines: `no_secondary_alternative` when the callback CTA is the goal; `goal_kind_mismatch` on **cdon**/**bokadirekt-service**.

### S6. `show_cancel_anytime` — merged (psych 5.0 + impl duplicate; kept per judge: "right idea, wrong facts" — facts fixed here)
- **appliesTo:** `["subscribe","trial"]` — **signup dropped** per judge ("cancel anytime" with nothing to cancel).
- **Rule/priority:** new rule `subscription_risk_reversal`, priority **60**, `when: !c.isReturning || c.trafficSource === "google_ads"`. Deterministic badge fallback chain on subscribe sites: `show_payment_security` (64) wins where its microcopy exists; this fires where it doesn't (nextory).
- **Ops:** `inject_badge` (W8-E1), goal-anchored, consuming the **existing** microcopy kind `guarantee` — currently produced by `extractMicrocopy` but consumed by no inject pattern. Needs only a `MICROCOPY_KIND` entry plus the catalog/rule.
- **Inventory/microcopy:** extend the `guarantee` rx (crawler-inventory.ts L249) with `|avsluta n[äa]r du vill` (nextory's actual published phrasing, which the shipped rx misses — judge-confirmed). Clear the ≥2-site vocab bar for the variant.
- **Test plan (staged, honest about the corpus gap the judge found):** (1) unit — `extractMicrocopy` with the extended rx matches "Avsluta när du vill"-class texts and the new consumption path fires on synthetic inventory. (2) Robustness on **nextory**, confirmed `kind=subscribe`: assert the badge fires **iff** the phrase reaches the harvest textPool (judge flagged it as hero-adjacent prose — if replay confirms it is outside the CTA/hero/trust pool, the archetype assertion is `declined: no_microcopy`, not a forced green, and positive archetype coverage waits on the wave-9 harvest-reach work below). (3) Counter-asserts (judge-verified green): `goal_kind_mismatch` on **cancerfonden** and **cdon**.

---

## 2. Explicitly REJECTED / deferred proposals

| Proposal | Score | Disposition — one line |
|---|---|---|
| `show_free_cancellation` (booking) | 4 | Dropped (<5 implementability): bokadirekt-service publishes only "Avboka med kod" (utility), so the positive test cannot run on the only strict booking archetype; revisit when a capture with published "avboka gratis" joins the corpus. |
| `show_flow_time` | 4 | Dropped (<5): thin evidence (misfit goal-gradient citation) and elskling's "2 minuter" is flow prose outside the harvest textPool — fires nowhere. |
| `show_response_time` | 4 | Dropped (<5): Oldroyd et al. citation misapplied (fast response ≠ displaying a promise), and sector-alarm's phrases are body prose — no archetype fires. |
| `show_shipping_returns` (purchase) | 5 | Deferred to wave 9: best evidence in the batch, but cdon's "Fri Frakt" is USP-bar prose that never reaches `extractMicrocopy` — blocked on the harvest-reach extension; purchase meanwhile covered by S1+S3. |
| `show_no_obligation` (quote/lead/contact/start_flow) | 5 | Deferred to wave 9: correct gap diagnosis, but "Kostnadsfri…" phrases on sector-alarm/elskling live in prose outside the textPool — no positive frozen test possible; those kinds get S5 this wave. |
| `show_donation_impact` | 5 | Parked: the frozen cancerfonden homepage contains no impact phrase (it lives on deeper pages) — regex matches nothing on our only donate archetype; needs a nonprofit capture with published impact copy. |
| `show_review_rating_early` | 6 | Merged: its trustType-predicate safety idea is absorbed into S2; its section-move value is delivered by S1; its cdon test leg was factually wrong (no rating-typed trust signal on frozen cdon). |
| `show_secure_payment_early` | 7 | Merged into S3: same psychology, but the goal-anchored badge delivers "trust near the payment decision"; within-parent move of a footer icons row does not, and its "never a silent no-op" claim was wrong (move_up has no noop guard). |
| `show_cancel_anytime` (psychology-lens variant) | 5 | Merged into S6: id collision; its "already harvested, no change needed" and nextory-positive claims were false (rx miss + textPool miss + hardcoded badge target); signup dropped from appliesTo. |

**Wave-9 dependency named by three rejections:** harvest-reach extension — widen the `extractMicrocopy` textPool (USP-bar/short-prose texts, length-capped, chrome-filtered) or re-freeze with those elements captured as trust signals. Not in wave 8; it unblocks `show_shipping_returns`, `show_no_obligation`, and S6's positive archetype leg.

---

## 3. Coverage matrix (thin goal kinds → wave-8 positive-fire archetype)

| Goal kind | Patterns | Positive frozen-archetype fire |
|---|---|---|
| purchase | S1, S3 | cdon (both) |
| booking | S1, S2 | bokadirekt-service (both) |
| donate | S4, S3 | cancerfonden (S4; S3 declines honestly) |
| lead / quote / contact | S5, S1 | sector-alarm (both) |
| start_flow | S2, S1 | elskling (S2 guard-dependent; S1 yes) |
| subscribe / trial | S6, S3, S1 | nextory (S1 yes; S6 pending textPool verification) |

Every pattern re-surfaces only site-published content, declines with a typed `DeclineReason` instead of no-oping, respects the one-inject budget and `MAX_ADAPTATIONS`, and is fully reversible via `reset()` — no urgency, no scarcity, no fabricated claims anywhere in the wave.