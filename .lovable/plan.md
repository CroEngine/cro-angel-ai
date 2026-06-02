Städa `extractStarRating(parent, group)` i `src/lib/tests/scripts/trustSignals.ts` — fyra kosmetiska förbättringar, noll beteendeförändring.

## Ändringar

### 1. Cache `neighborText(parent)`
- Rad 280 och 285 gör dubbelt: `neighborText(parent)`.
- Lösning: Flytta upp `const t = neighborText(parent);` ovanför rad 280 och återanvänd `t` på rad 285.

### 2. Extract duplicerad längd-guard
- `allStars.length >= 3 && allStars.length <= 5` upprepas i steg 1, 3, 3b och 4.
- Lösning: Efter rad 306 (där `allStars` deklareras), lägg till:
  ```js
  if (allStars.length < 3 || allStars.length > 5) return fromAttrs;
  ```
- Ta bort guarderna från steg 1, 3, 3b och 4.

### 3. Ta bort död check i steg 4
- Rad 360: `if (allStars.length >= 3 && allStars.length <= 5 && empty.length === 0)` — `empty.length === 0` är alltid sant eftersom steg 1 redan hanterat tomma stjärnor och returnerat.
- Lösning: Ta bort `&& empty.length === 0`, samt ta bort den implicita dependency på `empty` i steg 4.

### 4. Harmonisera steg 2:s gräns
- Rad 320: `allStars.length >= 4` skiljer sig från alla andra steg som använder `>= 3`.
- Lösning: Ändra till `>= 3` för konsistens.

## Verifiering
Kör samma `verify-stars.mjs` som tidigare — alla 4 testfall ska fortsätta passera:
- Fulla 5 stjärnor → `rating=5`
- 4.5 via klass → `rating=4.5`
- 4.5 via inline width:50% → `rating=4.5`
- Hero utan testimonial-context → inget rating
- Inga `NaN`, `< 0`, `> 5`.