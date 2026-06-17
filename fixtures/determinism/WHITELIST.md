# Determinism Whitelist — Grind 1 (locked)

**Status:** locked. Edits require explicit review — adding a row without a
stated a-priori cause defeats the determinism gate.

## Epistemic rule

The whitelist enumerates fields that are **legitimately non-deterministic
across captures of the same URL**, with a documented cause per field. A
field that drifts between two freezes and is **not** on this list fails the
determinism check.

A field is **not** added because "it drifted in the calibration run". A
field is added because there exists a prior-to-observation reason it must
drift (timestamps, nonces, slot-IDs, cache-busters, identified A/B
frameworks present in `fixtures/drift-survey/MECHANISM-INVENTORY.md`).

## Row schema

Every row carries four columns:

| col | meaning |
|---|---|
| `mechanism` | The identified non-determinism source. Each row MUST also declare its **envelope** (regex / structural shape) the drift is allowed to take — drift outside that envelope is RED even on a `confirmed-by-design` row. |
| `presence-evidence` | Where we know it varies (RFC, integration spec, mechanism inventory). |
| `score-impact` | `neutral` (extractor ignores; two freezes scored identically) or `sample-defining` (content varies; two freezes scored differently is legitimate). |
| `confidence` | Four-state — see below. |

### Confidence taxonomy (four-state)

| value | meaning | oracle behaviour |
|---|---|---|
| `confirmed-by-design` | A-priori benign variance documented by RFC, integration spec, or security standard (MHTML transport, CSRF, nonce, helmet ordering, cache-bust). | Oracle does NOT up/downgrade these. **But:** determinism-check still runs against them — variance **outside the documented envelope** (e.g. nonce-format change: length, alphabet, attribute name) surfaces as RED, not as a silent pass under this label. The label masks the *expected shape* of the drift, not arbitrary drift on the same mechanism. |
| `potential-presence` | Pattern matched in MHTML, no determinism-check evidence yet. | Promotes to `confirmed-drift` on observed drift; demotes to `present-no-observed-impact` on N≥3 zero-drift. |
| `confirmed-drift` | Determinism-check observed drift in a scored field attributable to this mechanism. | Stable label — re-validated each run. |
| `present-no-observed-impact` | Mechanism present, N≥3 determinism-check passes observed zero drift in scored fields. | Can re-promote to `confirmed-drift` if a later run drifts. |

`sample-defining` rows carry an implicit qualifier: *"conservative
overestimate of variance; actual hero impact unconfirmed until
determinism-check observes drift there."* Presence on a site does not
prove the scored surface is affected — the framework may run on checkout
/ account / search rather than the landing hero.

The determinism-check is the oracle: it promotes
`potential-presence → confirmed-drift` OR demotes it to
`present-no-observed-impact`. `confirmed-by-design` is not subject to
oracle promotion/demotion but IS subject to envelope enforcement —
otherwise the label is a smuggling vector for ostraffad drift.

## Whitelisted fields

### MHTML transport layer (Chromium / RFC 2557)

| mechanism | presence-evidence | score-impact | confidence |
|---|---|---|---|
| Top-level `Date:` header | Chromium MHTML serializer, RFC 2557 | neutral | confirmed-by-design |
| `boundary=` parameter in `Content-Type: multipart/related` header | RFC 2557, per-snapshot random token | neutral | confirmed-by-design |
| Body separator lines matching `^------MultipartBoundary--[A-Za-z0-9]+----$` | Body-side complement of the boundary= header param — same random token, repeated between parts | neutral | confirmed-drift (hubspot 2026-06-17) |
| Inline body occurrences of `boundary="----MultipartBoundary--…----"` | Re-quoted boundary token inside body | neutral | confirmed-drift (hubspot 2026-06-17) |
| `Content-ID:` header per part (e.g. `<frame-…@mhtml.blink>`) | Chromium synthesized per-part ID, per-snapshot random | neutral | confirmed-by-design |
| `cid:<type>-<uuid>@mhtml.blink` references in body href/src | Body-side complement of the `Content-ID:` header — UUIDs rotate per snapshot. Extractor-neutral: cares about the referenced part's CONTENT, not its synthesized ID. | neutral | confirmed-drift (hubspot 2026-06-17 — widened from header-only to body references after observed AMBER/RED pair-diff) |
| `Content-Location:` query params matching `/[?&](t\|ts\|cb\|v\|_\|cache\|version\|build)=[a-z0-9.-]+/i` | CDN cache-busting; see inventory `cdn-bust:hash-query` | neutral | confirmed-by-design |


### HTML body — per-session / per-request server output

| mechanism | presence-evidence | score-impact | confidence |
|---|---|---|---|
| `<meta name="csrf-token" content="…">` | Security-by-design; inventory `session-token:csrf` | neutral | confirmed-by-design |
| `data-*-nonce` attribute values | CSP, per-request; inventory `session-token:nonce` | neutral | confirmed-by-design |
| `<script nonce="…">` | CSP, per-request | neutral | confirmed-by-design |
| `data-react-helmet="true"` sibling-meta ordering | React Helmet emits in unspecified order | neutral | confirmed-by-design |
| Inline `<style>` rule ordering for CSS-in-JS (styled-components, emotion) | Per-render hash ordering, no semantic meaning | neutral | confirmed-by-design |

### Resource URLs

| mechanism | presence-evidence | score-impact | confidence |
|---|---|---|---|
| Cache-busting query params in `<img>`/`<script>`/`<link>` matching `/[?&](t\|ts\|cb\|v\|_\|cache\|version\|build\|hash)=[a-z0-9.-]+/i` | CDN convention; inventory `cdn-bust:hash-query` | neutral | confirmed-by-design |
| `srcset` URL filename hashes matching `<name>.[hash].ext` | Build-time content hash; inventory `cdn-bust:filename-hash` | neutral | confirmed-by-design |

### Mechanisms identified by Grind 0 (drift survey)

> Each row cites the inventory entry that justifies it. Reading the
> inventory before approving a new row is mandatory. Adding a row whose
> mechanism is not in the inventory means the inventory is incomplete —
> extend it first.

| mechanism | presence-evidence | score-impact | confidence |
|---|---|---|---|
| OneTrust CMP session-ID attrs (`optanon-*`, `data-domain-script`, hidden `OptanonConsent`) | Inventory `consent-cmp:onetrust`. | neutral | potential-presence |
| Other CMP session-ID attrs (Usercentrics, Didomi, CookieYes, CookieLaw) | Inventory `consent-cmp:other` | neutral | potential-presence |
| Session-recording probe IDs (Contentsquare `_uxa`, Usabilla, FullStory `FS.identify`, Hotjar `_hjSettings`, Mouseflow, MS Clarity) | Inventory `session-recording`. Send-only telemetry — does NOT inject visible variants. Easy to mis-classify as A/B; explicitly neutral. | neutral | potential-presence |
| Optimizely bucket attrs / experiment payloads | Inventory `ab:optimizely`. Sample-defining: bucket assignment varies content. Conservative — hero impact unconfirmed until determinism-check observes drift there. | sample-defining | potential-presence |
| VWO bucket attrs (`_vis_opt_*`, `data-vwo-*`) | Inventory `ab:vwo` | sample-defining | potential-presence |
| Adobe Target mbox payloads | Inventory `ab:adobe-target` | sample-defining | potential-presence |
| Dynamic Yield personalization slot IDs (`dy-rec-*`) | Inventory `personalization:dynamic-yield` | sample-defining | potential-presence |
| Monetate personalization payloads | Inventory `personalization:monetate` | sample-defining | potential-presence |
| Google Ad Manager / Prebid / APS slot HTML (auction outcome per request) | Inventory `ads:googletag` | sample-defining | potential-presence |
| HubSpot Laboratory experiment identifier — envelope: `<meta name="laboratory-identifier-*" content="anon<32hex>">` attribute value only | Inventory `session-token:hubspot-laboratory`. Observed via Grind 1 hubspot determinism-check 2026-06-17 round2 (L212). **Narrowed 2026-06-17 round3:** the body-structure variance round2 also attributed to this mechanism (presence/absence of `<a tabindex="-1" aria-hidden="true" opacity:0.01>` bot-tarpit anchor directly inside `<body>` at L213) is **NOT** whitelisted. Bot-tarpit injection is heuristic/bot-score-driven, not bucket-deterministic for the same client → categorically distinct from Optimizely-style bucket DOM and not a personalization slot. Body-structure drift stays RED. | neutral | confirmed-drift (hubspot 2026-06-17 round3, narrowed) |


## What is NOT whitelisted

- Visible text content of headings, paragraphs, buttons, links
- DOM structure / element counts outside identified personalization slots
- Inline style values affecting layout (`width`, `display`, `position`)
- `<meta name="description">`, `<title>`, OG tags
- Font family declarations in `@font-face`

Drift in any of the above between two freezes = failure. The substrate's
promise is `score = f(frozen DOM, extractor_vN)` — if the DOM itself is
unstable along axes that matter for the score, the function isn't
well-defined.

## Hubspot-specific notes

Grind 1 runs N=3 freezes of `https://www.hubspot.com/` in separate
Browserbase sessions (= independent A/B-bucket assignments). The 3-way
comparison is pairwise (3 pairs).

**Current status (2026-06-17 round3): RED — `pending-determinism`.** See
`fixtures/determinism/hubspot/diff.json` `round3_post_narrowing` for
evidence; `corpus/hubspot/meta.json` carries the pending flag. Bot-tarpit
anchor injection at `<body>` open remains unwhitelisted and unmasked.

Verdict logic (operationalized by `scripts/freeze-determinism-check.ts`):

- `GREEN` (0 drifted pairs) → Grind 1 closed.
- `AMBER` (1 drifted pair) → **read the field-level diff printed to stdout first**, do not auto-rerun with larger N. If the drifting field is attributable to a whitelisted mechanism → widen the row, promote confidence to `confirmed-drift`. New field → RED.
- `RED` (≥2 drifted pairs) → axis not seen by the whitelist. Either a new whitelist row (with mechanism cited from inventory) or genuine non-determinism in hubspot.
- N=3 with zero drift on a known-present mechanism → demote that row to `present-no-observed-impact`.

`render-canary.families.json` is compared by **outcome classification per
probe-ID** (`{family, fallbackUsed, weight, style}`), not by byte equality.
Byte equality would be circular with the MHTML check.
