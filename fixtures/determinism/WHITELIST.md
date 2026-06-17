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
| `mechanism` | The identified non-determinism source. |
| `presence-evidence` | Where we know it varies (RFC, integration spec, mechanism inventory). |
| `score-impact` | `neutral` (extractor ignores; two freezes scored identically) or `sample-defining` (content varies; two freezes scored differently is legitimate). |
| `confidence` | `potential-presence` (pattern matched, no observed drift in scored field) / `confirmed-drift` (determinism-check observed drift in a scored field) / `present-no-observed-impact` (mechanism present, N≥3 freezes showed zero drift in scored fields). |

`sample-defining` rows carry an implicit qualifier: *"conservative
overestimate of variance; actual hero impact unconfirmed until
determinism-check observes drift there."* Presence on a site does not
prove the scored surface is affected — the framework may run on checkout
/ account / search rather than the landing hero.

The determinism-check is the oracle that promotes
`potential-presence → confirmed-drift` OR demotes it to
`present-no-observed-impact`. Both moves are evidence-driven.

## Whitelisted fields

### MHTML transport layer (Chromium / RFC 2557)

| mechanism | presence-evidence | score-impact | confidence |
|---|---|---|---|
| Top-level `Date:` header | Chromium MHTML serializer, RFC 2557 | neutral | confirmed-by-design |
| `boundary=` parameter in `Content-Type: multipart/related` | RFC 2557, per-snapshot random token | neutral | confirmed-by-design |
| `Content-ID:` per part (e.g. `<frame-...@mhtml.blink>`) | Chromium synthesized per-part ID | neutral | confirmed-by-design |
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
| OneTrust CMP session-ID attrs (`optanon-*`, `data-domain-script`, hidden `OptanonConsent`) | Inventory `consent-cmp:onetrust`. Pre-listed for the Grind 1 hubspot determinism-check so a RED on it reads as "known axis, evidence confirms" not "hubspot is non-deterministic". | neutral | potential-presence |
| Other CMP session-ID attrs (Usercentrics, Didomi, CookieYes, CookieLaw) | Inventory `consent-cmp:other` | neutral | potential-presence |
| Session-recording probe IDs (Contentsquare `_uxa`, Usabilla, FullStory `FS.identify`, Hotjar `_hjSettings`, Mouseflow, MS Clarity) | Inventory `session-recording`. Send-only telemetry — does NOT inject visible variants. Easy to mis-classify as A/B; explicitly neutral. | neutral | potential-presence |
| Optimizely bucket attrs / experiment payloads | Inventory `ab:optimizely`. Sample-defining: bucket assignment varies content. Conservative — hero impact unconfirmed until determinism-check observes drift there. | sample-defining | potential-presence |
| VWO bucket attrs (`_vis_opt_*`, `data-vwo-*`) | Inventory `ab:vwo` | sample-defining | potential-presence |
| Adobe Target mbox payloads | Inventory `ab:adobe-target` | sample-defining | potential-presence |
| Dynamic Yield personalization slot IDs (`dy-rec-*`) | Inventory `personalization:dynamic-yield` | sample-defining | potential-presence |
| Monetate personalization payloads | Inventory `personalization:monetate` | sample-defining | potential-presence |
| Google Ad Manager / Prebid / APS slot HTML (auction outcome per request) | Inventory `ads:googletag` | sample-defining | potential-presence |

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

Verdict logic (operationalized by `scripts/freeze-determinism-check.ts`):

- `GREEN` (0 drifted pairs) → Grind 1 closed.
- `AMBER` (1 drifted pair) → **read the field-level diff printed to stdout first**, do not auto-rerun with larger N. If the drifting field is attributable to a whitelisted mechanism → widen the row, promote confidence to `confirmed-drift`. New field → RED.
- `RED` (≥2 drifted pairs) → axis not seen by the whitelist. Either a new whitelist row (with mechanism cited from inventory) or genuine non-determinism in hubspot.
- N=3 with zero drift on a known-present mechanism → demote that row to `present-no-observed-impact`.

`render-canary.families.json` is compared by **outcome classification per
probe-ID** (`{family, fallbackUsed, weight, style}`), not by byte equality.
Byte equality would be circular with the MHTML check.
