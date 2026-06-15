## Mål

Mät — inte koda. Bekräfta att B1-filtret gör vad det ska, och etablera ren B2-nämnare per sajt innan vi rör embed-loopen.

## Steg

1. **Kör smoke-scriptet på nytt**
   - `bunx tsx scripts/breadth-smoke.ts` mot stripe.com, intercom.com, vercel.com (samma 3 som förra rundan).
   - Output till `/tmp/corpus-breadth/` (eller den path scriptet redan använder).
   - Replay-steget förväntas fortsatt fela (saknar chromium-libs i sandbox) — det är OK, vi mäter bara freeze/extract.

2. **Läs `face-diagnostics.json` per sajt och tabulera**
   
   Per sajt rapportera:
   - `totalFaces` (alla @font-face-block i MHTML)
   - `localOnlyFiltered` (B1-bortrensade — `hasLocalOnly && !hasRemoteSrc`)
   - `withMetricOverrides` (size-adjust / ascent-override / descent-override)
   - `extractedFamilies` (efter filter, vad pipelinen nu räknar)
   - `embeddedFamilies` (vad embed-loopen lyckades med)
   - **B2-gap** = `extractedFamilies − embeddedFamilies` (den riktiga nämnaren)

3. **Bekräfta de tre förväntningarna från B1-hypotesen**
   - **Intercom:** 26 → 13 (eller nära) efter filter. 13 local-only-faces bortrensade. Inter / next-font-genererade fallbacks ska försvinna.
   - **Stripe:** `sohne-var` överlever (har `url()` src) — får INTE råka filtreras bort. Embedded fortfarande 0 ⇒ ren B2-signal.
   - **Vercel:** 21 → ~2 (de riktiga remote-familjerna), 19 ska antingen vara local-only ELLER fortfarande extraheras men inte embeddas (ren B2). Skilj på dessa två — det är hela poängen med övningen.

4. **Skriv kort verifieringsrapport** (markdown, inte ny kod)
   - Tabell: sajt × (total, local-only, metric-overrides, extracted, embedded, B2-gap).
   - En rad per sajt med tolkning: "B1 fångade X, B2-gap är Y, nästa: …"
   - Spara i `/tmp/corpus-breadth/B1-verification.md` så vi har den när vi planerar B2b.

5. **Sanity-checks innan vi går vidare**
   - Inga oväntade familjer försvann (t.ex. en cms-font med både `local()` och `url()` får inte droppas).
   - `withMetricOverrides`-siffran ska korrelera med `localOnlyFiltered` på Next.js-sajterna (samma faces, två signaler).
   - Om någon sajt visar `localOnlyFiltered === 0` men vi vet att den kör next/font → bugg i diagnostiken, undersök innan B2.

## Vad detta INTE inkluderar

- Ingen ändring av `mhtml-fonts.server.ts` eller `breadth-smoke.ts`.
- Ingen embed-loop-instrumentering (det är B2b, separat runda).
- Ingen replay-körning.
- Ingen reklassificering av `descriptor_missing`-räknare i renderprep.

## Leverabel

Tabellen + tolkningen i `B1-verification.md`. Den blir input till B2b-planen: om B2-gapet efter filter är 0 på någon sajt är B2-fixen inte nödvändig där; om gapet är stort på alla tre vet vi att tystnaden i `embedMhtmlFonts` är universell och inte sajt-specifik.
