# Frys om hubspot

Hubspot frystes innan `consentSelector` lades till i `corpus/sites.ts` (meta.json visar `consentSelector: null`). Cookie-bannern ligger troligen kvar i nuvarande golden. Vi kör om freezen och verifierar via receipt att consent faktiskt dismissades.

## Steg

1. Kör freeze mot SSOT i `corpus/sites.ts`:
   ```bash
   bun run scripts/freeze-site.ts --name=hubspot --screenshot-before-dismiss
   ```
   - `--screenshot-before-dismiss` ger en visuell sanity-check att bannern verkligen var där innan klicket.

2. **Läs `corpus/hubspot/freeze-report.json`** och verifiera:
   - `ok: true`
   - `consent.matchCountBeforeClick >= 1`
   - `consent.visibleBeforeClick: true`
   - `consent.dismissedAfterMs` är ett tal (inte null)
   - `consent.postDismissDomHits["accept all"] === 0` och `["decline all"] === 0` — bannern är borta ur synlig DOM

3. **Om `dismissedAfterMs` är null / assertion throwar med "consent kvar efter klick"**:
   - HubSpot döljer istället för att ta bort. Byt `consentDismissCheck: "detached"` → `"hidden"` i `corpus/sites.ts` och kör om.

4. **Om det funkar** (steg 2 grön):
   - Verifiera att `corpus/hubspot/meta.json` nu har `consentSelector: "#hs-eu-confirmation-button"` (skrivs automatiskt från SiteSpec).
   - Diffa nya `corpus/hubspot/golden.json` mot den gamla för att se vad consent-städningen ändrade — typiskt: above-fold trust signals, hero-salience, första sektionens innehåll.

5. **Kör snapshot-testen** för att se att hubspot fortfarande är grön mot sin nya golden:
   ```bash
   bunx vitest run src/lib/tests/snapshot
   ```

## Vad vi INTE rör

- `corpus/hibob/*` — hibob har redan consentSelector i meta.json, lämnas orört.
- UI / jämförelse-vy — kommer i nästa runda när alla 10 sites är frysta.
- `corpus/sites.ts` ändras bara om steg 3 triggas (detached → hidden).

## Receipt-driven

Hela poängen med freeze-systemet är att `freeze-report.json` säger oss om capturen blev ren — vi behöver inte öppna MHTML:en och leta. Om receipten är grön i steg 2 är hubspot 100%.
