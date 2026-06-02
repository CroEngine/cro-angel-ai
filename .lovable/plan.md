# Shape-baserad badge-fallback i `trustSignals.ts`

## Problem

Sektion 3b (`review_badges`) i `src/lib/tests/scripts/trustSignals.ts` kräver att en `<img>` matchar antingen `BADGE_BRANDS` (g2, capterra, trustpilot, …) i `alt+src` **eller** `BADGE_TITLES` (leader, momentum leader, …) i `alt`.

Teamtailors G2-badges faller bort: alt är tom/generisk och src self-hosted på teamtailor.com. Audit-JSON har noll förekomster av "g2", "leader", "winter", "badge", "award".

## Lösning: shape + group + heading-context fallback

Lägg till en tredje gren efter befintlig keyword-matchning.

### Detekteringsregler (alla måste gälla)

1. **Storlek**: `60 ≤ width ≤ 220`, `60 ≤ height ≤ 260`.
2. **Portrait**: `height >= width * 1.05` (strikt — håller undan runda/kvadratiska avatarer).
3. **Grupp i samma container**: ≥3 sådana `<img>` inom samma närmaste `ul/ol/section/div/footer`-block.
4. **Homogen storlek**: alla img:s `width` inom ±20% av medianen (samma för `height`). Använd kopia vid sortering — `const sorted = [...widths].sort((a,b)=>a-b)` — aldrig in-place på källarrayen.
4b. **Heading-context (hårt krav)**: blockets närmaste föregående/innehållna `h1`-`h4` får **inte** matcha `/team|people|om oss|about us|meet|who we are/i`. Block utan matchande heading inom rimlig DOM-närhet får passera (det är `team`-rubriker vi exkluderar, inte avsaknad av rubrik).
5. **Inte redan matchad**: img:n får inte vara med i `badgeImgs` från keyword-grenen.

### Push-kontrakt

```ts
push('review_badges', `${imgs.length} badge images (shape-fallback)`, block, 'img_alt', {
  badgeCount: imgs.length,
  recognizedBrands: [],
  badgeTitles: [],
  detectionMethod: 'shape',
});
```

Lägg till `detectionMethod?: 'keyword' | 'shape'` i `TrustSignal` i `src/lib/tests/schema.ts` (optional). Markera även keyword-grenen med `detectionMethod: 'keyword'` för symmetri.

### Wrapper-dedup

Återanvänd "innermost block"-logiken. Om samma block fångas av både keyword- och shape-grenen → keyword vinner (skip shape-pushen).

## Filer som ändras

- `src/lib/tests/scripts/trustSignals.ts` — ny shape-fallback efter befintlig review_badges-gren.
- `src/lib/tests/schema.ts` — `detectionMethod?: 'keyword' | 'shape'` på `TrustSignal`.

## Verifiering

- **Teamtailor** — 1 `review_badges`-entry, `badgeCount: 5`, `detectionMethod: 'shape'`.
- **Personio / Talentium** — ingen regression.
- **Team-grids** — exkluderas via regel 4b (heading-match) + regel 2 (portrait `>= 1.05`).

## Inte i scope

- Ändring av `BADGE_BRANDS` / `BADGE_TITLES`.
- Ändring av `customer_logos` / `trusted_by` / `testimonial`.
- Scoring / `aboveFold`.
- CSS background-image / `<svg>` badges (separat plan om Teamtailor visar sig använda det).
