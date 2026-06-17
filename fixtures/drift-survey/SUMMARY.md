# Mechanism Inventory — Non-Determinism Mechanisms Observed Present (Not Drift Evidence)

**Status:** authored 2026-06-17 from the 45-site Grind 0 survey.
**Source:** `scripts/drift-survey.ts` (capture) + `scripts/mechanism-inventory.ts` (per-MHTML pattern scan).

## What this file is — and is not

This is a **presence inventory** of non-determinism mechanisms (A/B
frameworks, CMPs, ad injection, CDN cache-busting, session/security tokens)
detected in the frozen MHTMLs of the 45-site breadth survey.

It is **not** drift evidence. The survey captured each site once. Mechanism
presence is a-priori knowledge that the mechanism CAN drift between captures
— actual two-freeze drift is observed only by
`scripts/freeze-determinism-check.ts` (Grind 1, hubspot only).

The whitelist in `fixtures/determinism/WHITELIST.md` is motivated by
"mechanism X varies by design" + presence evidence from this inventory.
Adding a whitelist row because a field drifted in one calibration run, with
no a-priori cause, is the vacuous-green failure mode the substrate exists to
prevent.

## Two success-rate metrics — reported separately

These count different things and must never be collapsed into one number.

| Metric | Numerator / Denominator | Value | Definition |
|---|---|---|---|
| Capture-fidelity | 37 / 45 | 82% | Freeze produced a valid MHTML AND `assertCaptureValid` passed AND A2 font-embed gate passed. |
| Score-validity | 40 / 45 | 89% | Freeze produced a valid MHTML AND `assertCaptureValid` passed. Score is render-free → `font-embed-failed` (3 sites) is no-canary but score-valid. |

The 3-site gap is the `font-embed-failed` class: site froze, MHTML was
produced, `assertCaptureValid` passed — but A2's font-embedding gate
rejected the capture because some external font URLs failed to embed
(replay would fall back to OS fonts → render-canary drift). Score does
not depend on render → still valid for scoring.

## Failure breakdown (8 of 45)

Per-row columns (T = true, F = false):

| Site | scoreValid | canaryValid | failureClass | manual disposition |
|---|---|---|---|---|
| saas-landing/figma | T | F | font-embed-failed | 2 unembedded font URLs after rewrite. Score unaffected. |
| ecommerce/everlane | T | F | font-embed-failed | 9 unembedded font URLs. Score unaffected. |
| media/nytimes | T | F | font-embed-failed | 3 unembedded font URLs (392 embedded). Score unaffected. |
| media/guardian | F | F | mhtml-capture-failed | CDP `-32000 Failed to generate MHTML`. Page rendered, MHTML serializer rejected. New class. |
| media/bbc | F | F | mhtml-capture-failed | Same CDP `-32000`. New class. |
| media/techcrunch | F | F | timeout | `waitForMainLoadState(load)` >60s. Expected for heavy site; not fixed. |
| iframe-heavy/medium | F | F | captured-wrong-page → auth-gate (manual) | textLen=229ch, interactive=25, hero heading present, no challenge markers. Pattern matches "promo / log-in-to-read landing". Routed to `auth-gate` manually; no MHTML on disk to confirm via byte-inspection (mhtmlKb=0). |
| iframe-heavy/stackoverflow | F | F | captured-wrong-page (stays) | textLen=265ch, interactive=2 (very low), hero heading present, no challenge markers. Insufficient evidence to promote to a more specific class without MHTML on disk. |

The (F,F) cells are disambiguated by `failureClass`; the row is never
silently collapsed into a single "failed" count.

## Score-impact axis — per mechanism, not per site

| Score-impact | Meaning | Default treatment |
|---|---|---|
| `neutral` | Instrumentation the extractor ignores (CSRF, nonce, cache-bust, MHTML `Date:`, session-recording telemetry). Two freezes scored identically. | Whitelisted with `confidence: confirmed-by-design` (a-priori benign) or `potential-presence` (presence-only). |
| `sample-defining` | Content varies (A/B frameworks, personalization, ad injection). Two freezes scored differently is legitimate. | Whitelisted conservatively on presence. Qualifier: "conservative overestimate of variance; actual hero impact unconfirmed until determinism-check observes drift there." Presence on a site does NOT prove the hero is affected — the framework may run on checkout / account / search, not the scored landing. |

Confidence is **four-state**:

- `confirmed-by-design` — variance is known a-priori benign (RFC, integration spec, security standard). Oracle does not up/downgrade these. **Envelope enforced:** drift outside the documented shape (e.g. nonce-format change — length, alphabet, attribute name) still surfaces as RED. The label masks the *expected drift shape*, not arbitrary drift on the same mechanism name.
- `potential-presence` — pattern matched in MHTML, no determinism-check evidence.
- `confirmed-drift` — determinism-check observed drift in a scored field attributable to this mechanism.
- `present-no-observed-impact` — mechanism present, N≥3 determinism-check passes observed zero drift in scored fields. Determinism-check downgrades.

The determinism-check is the oracle for the latter three: it upgrades
`potential-presence` to `confirmed-drift`, OR downgrades it to
`present-no-observed-impact`. Both moves are evidence-driven.
`confirmed-by-design` is outside oracle motion but inside envelope enforcement.

## Inventory tables

Auto-generated by `scripts/mechanism-inventory.ts` to `MECHANISM-INVENTORY.md`.
Re-run that script after re-capturing the survey. Categories covered:

- consent / CMP (OneTrust + others)
- A/B experimentation (Optimizely, VWO, Adobe Target)
- personalization (Dynamic Yield, Monetate)
- ad injection (Google Ad Manager, Prebid, Amazon APS)
- session / security tokens (CSRF, CSP nonce)
- CDN / build-hash artifacts (query cache-bust, filename hashes)
- session-recording instrumentation (Contentsquare, Usabilla, FullStory, Hotjar, Mouseflow, MS Clarity) — neutral, easy to mis-classify as A/B.

## What we deliberately did not do

- Did not promote any `mhtml-capture-failed` site to corpus. Capture-determinism (N≥3 consecutive freezes, 0 unexpected-drift) is a promotion criterion for ALL sites — see `corpus/README.md` "Promotion criteria". The two `mhtml-capture-failed` rows may be intermittent; demonstrating capture-determinism is a separate prerequisite.
- Did not isolate the `-32000` root cause. Failure is classified, not explained. Re-running the survey will tell us whether it reproduces.
- Did not fix `font-embed-failed` — reclassified as `valid-score, no-canary` on the fidelity axis.
- Did not fix `timeout` on TechCrunch. 60s `load`-state is already generous.
- Did not auto-fill "Unclassified". Mechanism set is closed-list; expanding it is a human decision per row.
