# Commit 3 + 4 — slutligt, bekräftat och redo att landa

## Bekräftelser

**(1) HubSpot-fixturen är pre-embed raw.** Verifierat: `corpus/hubspot/page.mhtml` är Chromiums råa `captureSnapshot`-output. CSS-parts (`cid:css-...@mhtml.blink`) är Chromiums *native* MHTML-format för stylesheets, inte vår post-embed-rewrite. Inuti dem ligger fortfarande externa `https://...woff2`-URLer (Chromium inlinear inte font-binärer). Test 2:s HubSpot-gren har äkta hink 2/3-innehåll — den är inte dekoration.

**(2) `embedMhtmlFonts` kastar INTE på hink 4.** Verifierat i `mhtml-fonts.server.ts:585-828`: hink-4-grenen pushar till `unresolvableRelativeUrls` och fortsätter (rad 655-661). Den enda `throw` är completeness-invarianten på rad 743 (`fetchRecords.length !== totalHarvestedOccurrences`) — strukturellt onåbar givet att varje harvest-entry mappar till exakt en record. Funktionen returnerar **alltid** `FontEmbedResult` med hink-4-detaljer på lyckad och misslyckad fetch-grena lika. Inget `try/finally` behövs; 4b kan läsa `embedded.fontUrlSummary` rakt av.

## Sekvens

### Commit 3 — Strukturell input-equality

1. **`src/lib/tests/snapshot/harvest-font-urls.ts`** — lägg till `harvestAllFontUrls(mhtml): HarvestedFontUrl[]` (publik). Använder existerande `iterateCssParts` + `harvestFontUrls`; `partIndex` kommer från `CssPart.partIndex` (inte lokal räknare).

2. **`mhtml-fonts.server.ts`**:
   - Lägg till `export function collectEmbedTargets(mhtml)` = `harvestAllFontUrls(mhtml).filter(u => u.kind === "absolute" || u.kind === "relative-resolved")`.
   - `embedMhtmlFonts`: byt nuvarande `for (const css of cssParts) { for (const u of harvestFontUrls(...))` mot **en** `harvestAllFontUrls(mhtmlRaw)`-pass + lokal partitionering till embed-targets / unresolvable. `partOriginalToResolved` byggs från samma pass. Beteendet identiskt.
   - `extractFontFaceDiagnostics`: oförändrad public shape; intern URL-klassificering går redan via `harvestFontUrls` per part (rad 506-549), så ingen ändring krävs — `replayUrls`-projektionen är redan i drift.

3. **Syntetisk fixture** — `src/lib/tests/snapshot/__fixtures__/synthetic-fonts.mhtml` + `synthetic-fonts.expected.ts` med `SYNTHETIC_FIXTURE_EXPECTED` (hink 2: 2, hink 3: 5, hink 4: 2 [no-base, invalid-base], embedded: 2, exakt resolved-map per original inkl. `multi.woff2` + `multi.woff`).

4. **`__tests__/harvest-font-urls.test.ts`** — två tester:
   - **Test 1 (producent-korrekthet):** `harvestAllFontUrls(syntheticRaw)` pinnad mot `SYNTHETIC_FIXTURE_EXPECTED` — hink-räkning, exakt `resolved` per `original`, hink 4 `reason` per `original`. Multiplicitet (multi.woff2 + multi.woff = 2 distinkta tokens) pinnas här.
   - **Test 2 (consumption-equality, icke-tautologisk):** på syntetisk fixture *och* `corpus/hubspot/page.mhtml`:
     ```ts
     const pReplay = new Set(extractFontFaceDiagnostics(raw).flatMap(f => f.replayUrls));
     const mTargets = new Set(collectEmbedTargets(raw).map(u => u.resolved!));
     expect(mTargets).toEqual(pReplay);
     ```
     P:s grupperings-/projektionsväg (per `(partIndex, faceIndex)` → `FontFaceDiagnostic`) vs M:s platta filter — två genuint olika kodvägar.

### Commit 4 — Receipt-observability

5. **`FontEmbedResult.fontUrlSummary`** — populeras från samma `allHarvested`-pass i steg 2. JSDoc anmärker att räknarna är **token-occurrences, inte distinkta-på-resolved**:
   ```ts
   /** Token-occurrences per hink (INTE distinkta-på-resolved — replayUrls/urlToCid
    *  dedupar, dessa inte). För antal-familjer/fetcher-mål: embeddedFontCount
    *  resp. fetchRecords. */
   fontUrlSummary: { embedded: number; absolute: number; relativeResolved: number;
     unresolvable: Array<{original: string; reason: "no-base"|"invalid-base"; partIndex: number}> };
   ```

6. **`FreezeReport.capture.fontUrls`** i `freeze.server.ts` — populeras direkt efter `embedMhtmlFonts`-anropet (rad ~352) från `embedded.fontUrlSummary`. Säker: `embedMhtmlFonts` kastar inte på hink-4-grenen, så receipt-skrivningen är garanterat nådd när URLer är oresolverbara (bekräftelse 2).

7. **`scripts/breadth-smoke.ts`** — `SiteResult.fontUrlSummary` + logg med kommentaren "token-occurrences, inte distinkta familjer".

### Verifiering

- `bun vitest run src/lib/tests/snapshot/__tests__/harvest-font-urls.test.ts` — Test 1 + 2 gröna.
- `bun vitest run` — existerande tester orörda.
- `bun scripts/breadth-smoke.ts` — kör **en gång** för att uppmäta HubSpots faktiska `fontUrlSummary`. Pinna värdena som named constants i ett `EXPECTED_HUBSPOT_FONT_URL_SUMMARY`-block i Test 2 (eller egen test); sanity-asserten jämför mot uppmätt värde, **inte mot antagen nolla**. Vercel/Intercom har icke-noll `relativeResolved`.

## Vad detta INTE gör

- Ingen ändring av `render-canary.server.ts`, MHTML-format, embedding-logik eller `FontFaceDiagnostic`-shape.
- Ingen fetch / Playwright i något commit-3-test.
- Ingen `try/finally`-omstrukturering av `embedMhtmlFonts` — onödig (se bekräftelse 2).