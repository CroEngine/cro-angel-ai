## Mål

Eliminera `/tmp`-avdunstningen. Frys stripe/intercom/vercel till en durabel plats med content-addressed manifest, så `breadth-replay` blir reproducerbar mellan sessioner.

## Reality-check som styr planen

- **Browserbase**: `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` båda satta. Path 1 viabel.
- **Git LFS**: ej installerat i sandboxen, och sandboxen får inte köra `git add/commit/push`. Det betyder: **jag kan inte själv pusha korpusen till LFS** — det steget måste du göra lokalt efter att filerna ligger i repot.
- **R2/S3**: bara `LOVABLE_ASSETS_*` finns (Lovables interna assets-bucket, inte din egen R2). Olämplig som auditbar fixture-store. Egen R2 kräver att du lägger in credentials.

Givet detta: frys till **`fixtures/breadth-corpus/<site>/`** i repot. Det är den enda platsen som överlever sandbox-sessioner utan extra infra, och det är rätt nivå för en 3-sajters smoke. LFS/R2-beslutet tas efter att vi sett faktiska storlekar.

## Steg

1. **Patcha sökväg**. Byt `BREADTH_ROOT = "/tmp/corpus-breadth"` → konstant som läser `process.env.BREADTH_ROOT ?? "fixtures/breadth-corpus"` i:
   - `scripts/breadth-smoke.ts`
   - `scripts/breadth-replay.ts`
   - `scripts/cid-probe.ts` (kommentar + default-arg)
   Testkommentar i `harvest-font-urls.test.ts` uppdateras också.

2. **Frys** via `bun run scripts/breadth-smoke.ts` mot Browserbase → skriver `fixtures/breadth-corpus/{stripe,intercom,vercel}/{page.mhtml,freeze-report.json,face-diagnostics.json,font-fetch-records.json}`.
   Aborterar vid första fel, ingen retry-loop.

3. **Manifest**. Litet inline-skript som walkar `fixtures/breadth-corpus/`, beräknar `sha256` per fil + storlek, skriver `fixtures/breadth-corpus/MANIFEST.json` (`{ site, file, bytes, sha256, frozenAt }[]`). Detta är audit-kvittot — `freeze-report.json` per sajt finns kvar oförändrad.

4. **Replay**. `bun run scripts/breadth-replay.ts` med `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/bin/chromium`. Rapporterar tillbaka per sajt: `Gate1 X/Y | classification | miss → family (hink 3 vs 4, url)`.

5. **Rapport till dig**: total korpus-storlek + per-fils-storlek. Då bestämmer du:
   - liten (<~10 MB total) → committa direkt utan LFS
   - medel → Git LFS (du kör `git lfs install && git lfs track 'fixtures/breadth-corpus/**/*.mhtml'` lokalt)
   - stor / växande → R2 (du lägger in credentials, jag skriver push-script i nästa runda)

   Inget i `fixtures/breadth-corpus/` committas av mig i denna runda — beslutet är ditt efter att ha sett siffrorna.

6. **Replay-fallback**, framåt (out of scope för denna runda, men flaggat): `breadth-replay` ska läsa från durable store (LFS/R2) och bara frysa om vid cache-miss mot MANIFEST sha. Implementeras när du valt store i steg 5.

## Vad som **inte** händer

- Ingen `git add/commit` (sandbox-restriktion + ditt beslut behövs).
- Ingen push till R2/LOVABLE_ASSETS (fel bucket).
- Ingen `playwright install` (system-Chromium 146 räcker).
- Ingen ändring av render-canary-logik eller per-fix golden-korpus — de är separata artefakter.

## Avbrottskriterier

- Browserbase-frys ger fel → stoppa, raw error tillbaka.
- `/bin/chromium`-launch i replay misslyckas (Nix .so-missar) → stoppa, raw error tillbaka. Ingen automagisk `playwright install`-fallback.
