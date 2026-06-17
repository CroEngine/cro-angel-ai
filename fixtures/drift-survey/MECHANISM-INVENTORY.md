# Mechanism Inventory — Auto-Generated

> Source: `scripts/mechanism-inventory.ts` over `fixtures/drift-survey/**/page.mhtml`.
> Generated: 2026-06-17T21:02:57.684Z
> Scanned: 33 MHTML files. Skipped: 12.

**This is a presence inventory, not drift evidence.** Two-freeze drift is only observed by `scripts/freeze-determinism-check.ts` (Grind 1).

## consent / CMP

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `consent-cmp:onetrust` | neutral | 13 | `OneTrust` |
| `consent-cmp:other` | neutral | 14 | `didomi` |

- **consent-cmp:onetrust** (neutral) — OneTrust CMP. Session-ID surfaces in attributes (optanon-*, data-domain-script). Extractor-neutral.
  - Sites: ecommerce/glossier, ecommerce/ikea-se, ecommerce/patagonia, ecommerce/rei, ecommerce/shopify-store-allbirds, ecommerce/shopify-store-gymshark, i18n-routing/booking, i18n-routing/klarna, i18n-routing/spotify-se, media/verge, saas-landing/loom, spa/spotify, spa/trello
- **consent-cmp:other** (neutral) — Other CMPs (Usercentrics, Didomi, CookieYes, CookieLaw). Same shape as OneTrust.
  - Sites: cookie-wall-eu/dn, ecommerce/glossier, ecommerce/ikea-se, ecommerce/patagonia, ecommerce/rei, ecommerce/shopify-store-gymshark, i18n-routing/booking, i18n-routing/klarna, i18n-routing/spotify-se, i18n-routing/tradera, media/verge, saas-landing/loom, spa/spotify, spa/trello

## A/B experimentation

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `ab:optimizely` | sample-defining | 1 | `optimizely` |
| `ab:vwo` | sample-defining | 0 | — |
| `ab:adobe-target` | sample-defining | 0 | — |

- **ab:optimizely** (sample-defining) — Optimizely. Bucket selection per session → content varies. Conservative: hero impact unconfirmed until determinism-check observes drift there.
  - Sites: ecommerce/glossier

## personalization

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `personalization:dynamic-yield` | sample-defining | 0 | — |
| `personalization:monetate` | sample-defining | 0 | — |


## ad injection

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `ads:googletag` | sample-defining | 4 | `pubads` |

- **ads:googletag** (sample-defining) — Google Ad Manager / Prebid / Amazon APS. Auction outcome varies per request.
  - Sites: i18n-routing/booking, i18n-routing/klarna, i18n-routing/tradera, media/verge

## session / security tokens

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `session-token:csrf` | neutral | 0 | — |
| `session-token:nonce` | neutral | 0 | — |


## CDN / build-hash artifacts

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `cdn-bust:hash-query` | neutral | 18 | `?v=3D1681821732` |
| `cdn-bust:filename-hash` | neutral | 15 | `.ac7bf37b26f16e97.woff2` |

- **cdn-bust:hash-query** (neutral) — CDN cache-busting query params. Whitelisted.
  - Sites: ecommerce/glossier, ecommerce/ikea-se, ecommerce/patagonia, ecommerce/rei, ecommerce/shopify-store-allbirds, ecommerce/shopify-store-gymshark, i18n-routing/spotify-se, i18n-routing/tradera, iframe-heavy/dev-to, iframe-heavy/github-blog, iframe-heavy/substack, media/verge, saas-landing/hubspot, saas-landing/linear, saas-landing/notion, saas-landing/stripe, spa/spotify, spa/trello
- **cdn-bust:filename-hash** (neutral) — Build-time content hashes in filenames. Stable within a deploy, rotates on redeploy. Whitelisted.
  - Sites: cookie-wall-eu/lemonde, cookie-wall-eu/spiegel, cookie-wall-eu/svd, ecommerce/glossier, ecommerce/ikea-se, ecommerce/patagonia, ecommerce/shopify-store-gymshark, i18n-routing/booking, i18n-routing/spotify-se, iframe-heavy/substack, saas-landing/hibob, saas-landing/notion, saas-landing/stripe, spa/airbnb, spa/spotify

## session-recording (instrumentation)

| Mechanism | score-impact | sites (n) | sample fragment |
|---|---|---|---|
| `session-recording` | neutral | 4 | `fullstory` |

- **session-recording** (neutral) — Session-recording probes (Contentsquare _uxa, Usabilla, FullStory, Hotjar, Mouseflow, MS Clarity). Send-only telemetry; does NOT inject visible variants. Extractor-neutral.
  - Sites: ecommerce/patagonia, i18n-routing/spotify-se, saas-landing/stripe, spa/spotify

## Skipped sites

- `ecommerce/away` — externalized-to-cdn
- `ecommerce/casper` — externalized-to-cdn
- `ecommerce/everlane` — no-mhtml (capture failed)
- `iframe-heavy/medium` — no-mhtml (capture failed)
- `iframe-heavy/stackoverflow` — no-mhtml (capture failed)
- `media/bbc` — no-mhtml (capture failed)
- `media/guardian` — no-mhtml (capture failed)
- `media/nytimes` — no-mhtml (capture failed)
- `media/techcrunch` — no-mhtml (capture failed)
- `saas-landing/figma` — no-mhtml (capture failed)
- `spa/asana` — externalized-to-cdn
- `spa/discord` — externalized-to-cdn

## Unclassified

Manual review required: if a site is in SCANNED but shows zero mechanism hits, it is NOT auto-listed as "no drift" — it just means none of the regex categories matched. The mechanism set is a closed-list; expanding it is a human decision per row, not auto-fill.
