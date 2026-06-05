# Corpus — frozen sites for snapshot regression tests

Each `corpus/<name>/` holds a deterministic capture of a real page used as
input for the snapshot harness (`src/lib/tests/snapshot/`).

## Layout

```
corpus/<name>/
  page.mhtml        # CDP Page.captureSnapshot — inlines all CSS/images/fonts
  screenshot.jpg    # full-page visual reference
  meta.json         # url, captured_at, viewport, consent selector, notes
  consent.json      # (optional) extra consent steps if a CSS selector isn't enough
  golden.json       # normalized expected output of collect + pageAudit
```

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
