## Status

Implementerat:
- src-baserad dedup för `customer_logos` (container-dedup-pass körs nu bara för `trusted_by`).
- Shape-fallback för `review_badges` med hård heading-filter (`team|people|om oss|about us|meet|who we are`), portrait `≥ 1.05`, homogen storlek inom ±20% av medianen (kopia-sort), keyword-block vinner vid overlap.
- `detectionMethod: 'keyword' | 'shape'` på `TrustSignal`.

## Verifiering

- **Teamtailor**: 1 `review_badges`-entry med `badgeCount ≥ 3`, `detectionMethod: 'shape'`.
- **Personio / Talentium**: ingen regression i `customer_logos` eller `review_badges`.
- **Team-grids**: exkluderas via heading-filter + portrait-strikt.

## Inte i scope

`trusted_by` text-entries, stars, org_number FP, geo-proxies, carousel-uppdelning hero/footer, scoring, CSS background-image / `<svg>` badges.
