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

## Archetype corpus — one frozen site per conversion goal kind

Beyond snapshot regression, the corpus doubles as a **per-goal-kind
regression suite** (`__tests__/archetype-goals.test.ts`): the whole pipeline
harvest → `mapAuditToInventory` → `rankGoalCandidates` is exercised on a real
site of each conversion type, so a taxonomy change that re-types a webshop's
"Köp" as signup, or a nonprofit's "Ge en gåva" as start_flow, fails CI. This
is the "one goal model for any conversion site" claim made testable.

| Site | Goal kind | CMP | Notes |
|---|---|---|---|
| `cdon` | purchase | Didomi | Swedish marketplace/webshop |
| `elskling` | start_flow / quote | Cookiebot (hidden) | electricity comparison portal |
| `cancerfonden` | donate | Cookiebot (hidden) | nonprofit |
| `hubspot` | signup / trial / contact | (own banner, hidden) | SaaS (pre-existing) |
| `bokadirekt` | booking* | none (region) | booking marketplace homepage |
| `bokadirekt-service` | booking | none (region) | service page — the SSR:ed "Boka" CTAs |
| `nextory` | trial / subscribe | none in region (Cookiebot in server HTML only) | audiobook subscription |
| `sector-alarm` | lead / quote | Cookie Information (custom template, hidden) | home-alarm lead-gen |

\* **bokadirekt (homepage) is soft-asserted only.** The homepage is a category
portal — the prominent CTAs are href-less service tiles ("Frisör", "Massage"),
so the deterministic no-LLM floor sees no booking verb/href and defaults to
signup; the holistic goal judge (LLM) reads "booking marketplace" from the
whole inventory. The real "Boka" CTAs live on the service pages — that is what
`bokadirekt-service` captures, giving booking its strict archetype.

Failed freeze attempts, for the record: **lead** — Verisure/OneTrust exceeded
the 9 MB externalize threshold with no lovable-assets CLI in the freeze env;
Svensk Fast/Cookiebot rendered no banner against the Browserbase IP (replaced
by sector-alarm). **subscribe** — di.se's newspaper fonts exceeded the inline
threshold and broke the render-canary (replaced by nextory). When a CMP ships
a custom template (standard vendor selectors match nothing),
`scripts/probe-consent-dom.ts --url=…` dumps the banner's real DOM to pick a
selector from — that's how sector-alarm's classless accept button was found.

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
2. **A2 font-embedding** — every font the page actually loaded is embedded, so
   replay's render-canary is meaningful (not OS-font fallback). Embedding falls
   back to a browser-context fetch (`page.evaluate(fetch)`) for fonts whose CDN
   blocks the server-side proxy (hotlink/IP). Referenced-but-unused fonts the
   browser never loaded (e.g. sibling-brand fonts in shared CSS, a CDN's cold-
   403 fonts) are tolerated — they don't render, so they can't drift. (Was
   strictly `externalFontSrcCount === 0`; the gate now keys on *loaded*
   survivors via resource-timing, with a strict fallback when that signal is
   unavailable.)
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

## Vocabulary harvest (KIND_TEXT evidence)

`vocab-harvest-2026-07-06.json` — CTA/button labels harvested from 107 live
homepages across goal archetypes (e-com, booking, lead-gen, comparison,
nonprofit, media, SaaS, bank, telecom, energy; breadth-targets + a broadened
Swedish/Nordic mix). Method: curl of server-rendered HTML, `<a>`/`<button>`/
submit labels, deduped per site, chrome labels (login/search/social/legal/nav)
filtered out, threshold ≥ 2 sites. This file is the evidence base for the
`KIND_TEXT` vocabulary in `src/adaptive/crawler-inventory.ts` — extend the
regexes only with terms that clear the same bar (≥ 2 independent sites, no
plausible non-goal reading), and re-run a harvest when entering a new market
or vertical. Note it captures server-rendered labels only (no JS execution) —
SPA-heavy sites need the real crawler/freeze pipeline.
