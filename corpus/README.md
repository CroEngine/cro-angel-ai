# Corpus — frozen sites for snapshot regression tests

Each `corpus/<name>/` holds a deterministic capture of a real page used as
input for the snapshot harness (`src/lib/tests/snapshot/`).

## Layout

```
corpus/<name>/
  page.pre-embed.mhtml  # raw captureSnapshot — externa font-URLer kvar (input)
  page.mhtml            # post-embed — A2 har rewrittat externa fonter till cid: (output)
  screenshot.jpg        # full-page visual reference
  meta.json             # url, captured_at, viewport, consent selector, notes
  consent.json          # (optional) extra consent steps if a CSS selector isn't enough
  golden.json           # normalized expected output of collect + pageAudit
```

Båda MHTML-filerna committas. `page.pre-embed.mhtml` är källan för
harvest/projektions-invarianten (Test 3 i `harvest-font-urls.test.ts`):
post-embed kan inte användas eftersom alla externa URLer redan är `cid:`,
vilket gör P==M-equality tautologiskt grön. Pre-embed skrivs av
`freeze.server.ts` före `embedMhtmlFonts` och före A2-gaten — samma
receipt-före-throw-princip som `report.capture.fontUrls`.

## Freezing a site

```bash
bun run freeze --url=https://hibob.com --name=hibob \
  --consent='#onetrust-accept-btn-handler'
```

Or with a Stagehand instruction when no stable selector exists:

```bash
bun run freeze --url=... --name=... \
  --consent-act='click the Accept all cookies button'
```

Capture happens on Browserbase at the viewport pinned in
`src/lib/tests/snapshot/freeze.server.ts` (`FREEZE_VIEWPORT`) so
`aboveFold` / section bucketing matches what live test runs produce.

## Why MHTML, not `page.content()`

`page.content()` returns HTML with external `<link rel=stylesheet>` URLs.
Loading that later either re-fetches live CSS (which drifts) or falls back
to UA defaults (no styles at all). Either path produces different
`getComputedStyle` / `getBoundingClientRect` results than the live engine
saw — breaking salience, contrast, visibility, and visualWeight. MHTML
inlines everything so the CSSOM at replay matches capture exactly.

## Which sites to freeze

Pick sites that exercise the bugs you're actively fixing, not generic
failure modes. Current target set (covers A salience / D skip-link /
E consent above-fold + dark-theme inversion):

- the 5 existing live-test sites we've been running
- 1 dark-theme site (for inverted contrast / salience cases)

Add e-commerce / testimonial-heavy sites only when the trust-signal bugs
become active again.

## Determinism contract & limitations (Grind 1)

The substrate's promise is `score = f(frozen DOM, extractor_vN)`. For this to
hold, the **frozen DOM** must itself be deterministic across captures of the
same URL — modulo a documented set of legitimate drift sources.

Two things are deliberately scoped narrowly:

1. **Determinism has been proven on hubspot.** Hubspot is the representative
   hard case (non-trivial consent flow, animated hero, per-session tokens in
   every link, a long tail of inconsistently-injected third-party overlays).
   `bun run scripts/freeze-determinism-check.ts --name=hubspot` runs N=3 freezes
   in independent Browserbase sessions and diffs pairwise (capture-determinism,
   #3). Score-determinism (#4) is measured by replaying the N captures through
   `replayCorpus` + `normalize` and diffing the goldens.
   **Current status: `promoted` (round6 2026-06-20).** #4 is GREEN —
   byte-identical goldens across N=3 — which is the load-bearing criterion and
   proves all #3 residual drift score-neutral. Two capture-time fixes made the
   scored DOM deterministic at the source: `prefers-reduced-motion` (kills the
   hero rotating-list frame variance) and `SiteSpec.removeSelectors` (strips
   inconsistently-injected chat/feedback/web-interactives/banner overlays + the
   bot-tarpit anchor). See `fixtures/determinism/hubspot/REPORT-round6-2026-06-20.md`.
2. **Breadth-determinism is NOT proven.** Grind 2 measures *capture-correctness*
   over 50 sites (did we capture the right page?), not *determinism* (would a
   second freeze produce the same DOM?). An e-commerce site can freeze valid
   but non-deterministically (rotating product recs) and that won't be caught.
   This limitation is acknowledged — extending determinism to breadth is a
   future workstream, not part of the current substrate-hardening.

## Corpus membership states

A `corpus/<name>/` directory is in exactly one of these states:

- **`promoted`** — all four promotion criteria below hold. Counted in the corpus; goldens are authoritative regression baselines.
- **`pending-determinism`** — files retained on disk as pre-promotion baseline, but `meta.json` carries `"pending-determinism": true` with `pending-reason` and a pointer to the determinism diff. **Not counted** as a promoted member; goldens are NOT authoritative until pending state is cleared.

A site in `pending-determinism` MUST NOT be relied on for regression assertions and MUST NOT be added to any "promoted" enumeration.

## Promotion criteria (apply to ALL corpus sites)

A site is promoted (state = `promoted`) only when ALL of the following hold:

1. **Capture-validity** — `assertCaptureValid` passes (see Grind 2 section).
2. **A2 font-embedding** — `externalFontSrcCount === 0` after rewrite, so
   replay's render-canary is meaningful (not OS-font fallback).
3. **Capture-determinism (score-affecting only)** — N≥3 consecutive freezes
   produce 0 *unexpected score-affecting* drift. Drift attributable to
   whitelisted score-neutral mechanisms (`fixtures/determinism/WHITELIST.md`:
   per-session tokens like `__hstc`/laboratory/csrf, `cid:`/boundary,
   cache-busters, bare per-session UUIDs, and inconsistently-injected
   third-party overlays/beacons) is **expected, not a failure**. Byte-identical
   MHTML is **not** required and is unwinnable on a site that stamps a
   per-session token into every link or injects a long tail of third-party
   tracking — criterion #4 is the oracle that proves which drift is
   score-neutral. Capture-time normalization (`prefers-reduced-motion`,
   `SiteSpec.removeSelectors`) reduces score-neutral drift at the source so the
   residual is reviewable. Sites that fail freeze occasionally (e.g.
   `mhtml-capture-failed`, CDP `-32000`) MUST still demonstrate this on the
   runs that succeed before promotion.
4. **Score-determinism (load-bearing, primary)** — the goldens produced from
   the N≥3 freezes are bytewise equal after the extractor's documented
   normalization (replay via `replayCorpus` + `normalize`). This IS the
   substrate's promise `score = f(frozen DOM, extractor_vN)`: if the scores
   converge across independent captures, the frozen DOM is deterministic along
   every axis the score reads, regardless of transport/session noise. This is
   the non-negotiable, primary criterion; #3 is satisfied once its residual
   drift is whitelisted score-neutral, which #4 proves.

Criterion #4 is load-bearing. Hubspot is **`promoted`** — round6 (2026-06-20):
#4 GREEN across N=3 independent Browserbase captures (byte-identical goldens);
all #3 residual drift proven score-neutral by #4 and reduced at source
(reduced-motion + `removeSelectors`). See `corpus/hubspot/meta.json` and
`fixtures/determinism/hubspot/REPORT-round6-2026-06-20.md`. The same rule
applies to any future corpus site.



## Capture validity (Grind 2)

A freeze is `ok` only if `assertCaptureValid` passes — text length >= 500ch,
>= 10 interactive elements, hero region has a non-consent heading, no
dominant Cloudflare/PerimeterX/hCaptcha markers. "Freeze didn't throw" is
not a success criterion; it's a known-false-green that inflates the rate.

Sites failing this assertion get `failureClass: "captured-wrong-page"` —
typically consent-missed, anti-bot frozen as 200, or empty SPA shell.

## TTL & staleness (Grind 3)

Each `meta.json` includes `ttlDays` (default 90, per-snapshot data not a
hardcode), `frozenAt`, `expiresAt`, `refreezeReason`. TTL is **authoritative**
for staleness — `now > expiresAt` triggers a re-freeze decision. HEAD probe
diff (etag/last-modified/content-length) is **advisory only**, logged as
hints in `corpus/STALENESS.json`, not treated as stale (CDN per-request etags
and SPA shell etags make HEAD too noisy to be authoritative).

A weekly GitHub Action runs `scripts/freeze-staleness-check.ts` and opens
an issue listing stale snapshots. Human triggers re-freeze; no auto-refreeze.
