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

1. **Determinism is proven on hubspot only.** Hubspot is the representative
   hard case (non-trivial consent flow). `bun run scripts/freeze-determinism-check.ts
   --name=hubspot` runs N=3 freezes in independent Browserbase sessions
   (= independent A/B-bucket assignment) and diffs pairwise against the
   a-priori whitelist in `fixtures/determinism/WHITELIST.md`.
2. **Breadth-determinism is NOT proven.** Grind 2 measures *capture-correctness*
   over 50 sites (did we capture the right page?), not *determinism* (would a
   second freeze produce the same DOM?). An e-commerce site can freeze valid
   but non-deterministically (rotating product recs) and that won't be caught.
   This limitation is acknowledged — extending determinism to breadth is a
   future workstream, not part of the current substrate-hardening.

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
