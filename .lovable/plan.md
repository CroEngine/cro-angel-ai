## Plan: Verifiera Chromium-install i denna sandbox

Claudes svar gäller hans container, inte min. Här finns repo + bun. Enda frågan: är `cdn.playwright.dev` blockerad också här, och finns systemlibs?

### Steg

1. **Försök installera Chromium**
   ```
   bunx playwright install chromium 2>&1 | tail -40
   ```
   - Om 403/host_not_allowed → samma blockad som Claude såg → hoppa till steg 3
   - Om missing shared libs → försök `bunx playwright install-deps chromium` (kräver troligen sudo)
   - Om OK → fortsätt steg 2

2. **Kör snapshot.test.ts** (endast om steg 1 lyckas)
   ```
   bunx vitest run src/lib/tests/snapshot/__tests__/snapshot.test.ts 2>&1 | tail -60
   ```
   Rapportera `[snapshot] hubspot: N off-flow suspects`. Om N>0 → top-5 selektorer + fråga om `SNAPSHOT_UPDATE=1`.

3. **Om CDN/libs blockerar:** leverera konkret CI-patch
   - Läs `.github/workflows/ci.yml`
   - Föreslå konkret diff: lägg till `- run: bunx playwright install --with-deps chromium` efter bun-setup, före vitest-steget
   - Bekräfta att lokal körning är snabbaste vägen för första datapunkten

### Inga kodändringar i steg 1–2
CI-patch i steg 3 endast om du säger ja efter att jag visat förslaget.