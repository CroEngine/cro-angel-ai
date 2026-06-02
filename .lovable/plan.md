## Scope
Endast verifiering — koden för 4-stegs-fallback i `extractStarRating(parent, group)` är redan implementerad i `src/lib/tests/scripts/trustSignals.ts`. Half-star-detektion skjuts upp till nästa iteration.

## Steg

1. **Kör testet mot Teamtailor** via befintlig pipeline.
2. **Verifiera via `jq` på resulterande rapport**:
   - `stars`-signaler finns och har `rating === 5`
   - inga `rating < 0`, `rating > 5`, eller `NaN`
   - Loopia (kontroll) får fortsatt inte falsk 5:a (ingen testimonial-context)
3. **Rapportera utfall** till användaren med konkreta siffror per signal.

## Inte i scope nu
- Half-star-detektion (Eugenio D. / Isabella C. 4.5/5 → kommer felaktigt räknas som 5). Tas i separat iteration efter att 5-stjärniga fallet är bekräftat fungera.
- Scoring/pageSummary, testimonial author, `social_proof_count` på `trusted_by`.

## Nästa iteration (efter approval av 5-star-verifiering)
Lägg till half-star-detektion: `parent.querySelectorAll('[class*="half" i], [class*="fractional" i]')` → om träff, `rating = filled + (halfCount * 0.5)`. Klampa till en decimal.
