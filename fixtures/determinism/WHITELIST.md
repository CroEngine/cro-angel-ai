# Determinism Whitelist — Grind 1

**Status:** locked. Edits to this file require explicit review — adding a row
without a stated a-priori cause defeats the entire point of the determinism gate.

## Epistemic rule

The whitelist enumerates fields that are **legitimately non-deterministic
across captures of the same URL**, with a documented cause per field. Any
field that drifts between two freezes and is **not** on this list fails the
determinism check.

A field is **not** added because "it drifted in the calibration run". A field
is added because there exists a prior-to-observation reason it must drift
(timestamps, nonces, slot-IDs, cache-busters, identified A/B-frameworks).
Pulling rows from observed diffs without a stated cause makes the test pass
by construction = vacuous-green.

## Whitelisted fields

### MHTML transport layer (Chromium / RFC 2557)

| Field | Cause |
|---|---|
| Top-level `Date:` header | Capture wall-clock, set by Chromium at MHTML serialization |
| `boundary=` parameter in `Content-Type: multipart/related` | Random per-snapshot boundary token, RFC 2557 design |
| `Content-ID:` per part (e.g. `<frame-...@mhtml.blink>`) | Per-part synthesized ID, random per snapshot |
| `Content-Location:` query-params matching `/[?&](t|ts|cb|v|_|cache|version|build)=[a-z0-9.-]+/i` | CDN cache-busting query params, not content |

### HTML body (per-session/per-request server output)

| Field | Cause |
|---|---|
| `<meta name="csrf-token" content="...">` | Per-session CSRF token, security-by-design |
| `data-*-nonce` attribute values | CSP nonces, per-request |
| `<script nonce="...">` | Same as above, CSP |
| `data-react-helmet="true"` ordering of sibling meta tags | React Helmet emits in unspecified order |
| Inline `<style>` rule ordering when CSS-in-JS used (styled-components, emotion) | Per-render hash ordering, no semantic meaning |

### Resource URLs

| Field | Cause |
|---|---|
| Query-params in `<img>`/`<script>`/`<link>` matching `/[?&](t|ts|cb|v|_|cache|version|build|hash)=[a-z0-9.-]+/i` | CDN cache-busting |
| `srcset` URL fingerprint hashes when filename pattern is `<name>.[hash].ext` | Build-time content hash, stable within a deploy but rotates on redeploy |

### Drift sources identified by Grind 0 (drift survey)

> **This section is intentionally empty until Grind 0 ships.** Each row added
> here MUST cite (a) the framework that produces the drift, (b) where in the
> survey it was identified, (c) why we accept it as non-comparable.
>
> Example shape (do not add until grounded in survey data):
>
> | Field | Cause |
> |---|---|
> | `data-optimizely-bucket="..."` attribute | Optimizely A/B experiment bucket, per-session |
> | `<div id="dynamic-yield-rec-...">` inner HTML | Dynamic Yield personalization slot, per-session |

## What is NOT whitelisted

- Visible text content of headings, paragraphs, buttons, links
- DOM structure / element counts outside identified personalization slots
- Inline style values affecting layout (`width`, `display`, `position`)
- `<meta name="description">`, `<title>`, OG tags
- Font family declarations in `@font-face`

Drift in any of the above between two freezes = failure. The whole point of
the substrate is that the score is `f(frozen DOM, extractor)` — if the DOM
itself is unstable along axes that matter for the score, the function isn't
well-defined.

## Hubspot-specific notes

Grind 1 runs N=3 freezes of `https://www.hubspot.com/` in separate
Browserbase sessions (= independent A/B-bucket assignments). The 3-way
comparison is pairwise (3 pairs); a field is flagged only if it drifts in
**at least one pair** — drift in zero pairs means stability, drift in one
pair could be coincidence (two sessions landed in the same bucket), drift
in two-or-more pairs is real.

`render-canary.families.json` is compared by **outcome classification per
probe-ID** (`{family, fallbackUsed, weight, style}`), not by byte equality.
Byte equality would be circular with the MHTML check: families.json is
generated post-capture from the MHTML, so if MHTML is byte-identical
families.json trivially is too, and if MHTML differs (legitimately, per this
whitelist) families.json may also differ in receipt-level bytes while
preserving outcome.
