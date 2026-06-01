## Diagnos

I screenshotbilden (slutet av sidan) ligger flera badges stackade på fel platser. Övre delen av sidan ser rätt ut.

Det här är ett klassiskt symptom på **lat-laddat innehåll som triggas av Playwrights fullPage-screenshot**.

Just nu i `engine.server.ts`:

1. Vi skrollar 0→25→50→75→100→0 för att trigga lazy content.
2. Vi kör `COLLECT_SCRIPT` → läser `getBoundingClientRect()` på alla element. Dokumenthöjd just nu = `H1`.
3. Vi tar `page.screenshot({ fullPage: true })`. **Playwright skrollar själv** medan den skär bilden i remsor → fler IntersectionObservers fyrar → bilder/sektioner laddar in → dokumenthöjd växer till `H2 > H1`. JPEG-höjden vi läser är `H2`.
4. I `Viewport.tsx` mappar vi `(rect.y / vp.h)` mot bilden. Eftersom `vp.h = H2` men rects mättes mot `H1`, blir alla y-värden **proportionellt för små** — och felet växer linjärt med y. Övre delen ser okej ut, slutet glider iväg.

## Fix (endast `src/lib/tests/engine.server.ts`)

Byt ordning + ankra mätningen mot samma höjd som screenshotten:

1. **Skrolla precis som idag** (0→100→0) för att förvärma lazy content.
2. **Ta screenshotten först** (`fullPage: true`). Detta tvingar Playwright att skrolla igenom hela sidan och låter all kvarvarande lazy content mounta.
3. **Skrolla tillbaka till 0** och `await new Promise(res => setTimeout(res, 300))` för att låta layout stabilisera.
4. **Kör `COLLECT_SCRIPT` därefter** — nu är dokumenthöjden = `H2` (samma som JPEG-höjden).
5. Läs JPEG-dimensioner som idag och sätt `viewport: vp`.

Resultatet: `rect.y` och `vp.h` mäter samma värld → overlays sitter rätt hela vägen ner.

## Bonusfix i samma patch

`OVERLAY_FN` (live-overlay i Browserbase) gör samma misstag — den mäter `getBoundingClientRect` direkt vid anrop. Eftersom den ritas EFTER att vi skrollat tillbaka till 0, är det ok idag. Lämnas orört.

## Inget annat

- `Viewport.tsx`, hooks, run.functions, orchestrator: orörda.
- `readJpegDimensions` + screenshot-fallback från förra patchen behålls.

## Trade-offs

- En extra `setTimeout(300ms)` efter screenshot. Förlorar ~0.3s per collect-steg, försumbart.
- Om sidan har content som *bara* monterar under Playwrights fullPage-skroll och försvinner när vi skrollar tillbaka, hamnar de utanför vår collect. Mycket ovanligt; accepteras.

## Uppföljningar (inte här)

- Klickbara/hovrade badges i Frozen-vyn för debugging.
- Cluster badges när många icon-buttons sitter tätt (recipe cards).
- Storage-upload av screenshots.
