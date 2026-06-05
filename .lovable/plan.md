# Rökprov: HiBob som första frysta sajt

Målet är att verifiera att hela kedjan (freeze → MHTML → replay → normalize → golden) fungerar end-to-end på en riktig sajt innan vi fryser resten av korpusen.

## Steg

1. **Kör freeze mot HiBob**
   ```
   bun run freeze --url=https://www.hibob.com --name=hibob \
     --consent="#onetrust-accept-btn-handler"
   ```
   Producerar:
   - `corpus/hibob/page.mhtml`
   - `corpus/hibob/screenshot.jpg`
   - `corpus/hibob/meta.json`

2. **Sanity-check artefakterna**
   - MHTML > 200 KB och < ~5 MB (annars måste vi byta från data-URL till uppladdning).
   - Screenshot visar dismissad cookie-banner och full sida.
   - `meta.json` har viewport 1280×720.

3. **Generera golden från replay**
   ```
   bun run snapshot:update
   ```
   Detta startar en Browserbase-session, laddar MHTML, kör `COLLECT_SCRIPT` + `runPageAudit`, normaliserar och skriver `corpus/hibob/golden.json`.

4. **Verifiera determinism**
   ```
   bun run snapshot
   ```
   Diffen mot nyss skrivna golden ska vara tom. Om det dyker upp diff på andra körningen → någon volatil signal slank förbi `normalize.ts` och måste fångas in innan vi fryser fler sajter.

5. **Inspektera golden manuellt**
   - `hero.headline` och `hero.primaryCtaText` stämmer med skärmdumpen.
   - `summary.primaryConversionCtaCount`, `summary.competingAboveFold`, `trustEvidence.rollup` ser rimliga ut.
   - Om något ser fel ut → det är en collector-bugg som golden nu låser fast. Bra — då har harnessen redan börjat tjäna sitt syfte.

## Vad jag INTE gör i detta steg

- Inte fryser de andra sajterna ännu (väntar tills HiBob-loopen är grön två gånger i rad).
- Inte rör `classifiers.ts` eller `COLLECT_SCRIPT` (det är Fas 4).
- Inte sätter upp CI (Fas 3).

## Beslutspunkter under körning

- **Om MHTML > ~2 MB:** data-URL i `harness.server.ts` kan tryckas, vi byter till Browserbase upload + worker-route i samma PR.
- **Om consent-selektorn ändrats:** byter till `--consent-instruction="click Accept all cookies"` (Stagehand-fallback).
- **Om andra körningens diff inte är tom:** vi pausar, jag analyserar diffen, och lägger till normalisering — innan vi fryser fler sajter.
