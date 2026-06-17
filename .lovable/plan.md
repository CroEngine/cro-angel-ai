## Mål

Få Chromium-beroende canary/snapshot-tester att köra grönt i GitHub Actions (där de hör hemma) och säkerställa att `render-canary.families.json` + ev. ghost-loggar är inspekterbara efter en körning. Ingen ny app-kod — bara CI-konfig.

## Vad som ändras

Enda filen som rörs: `.github/workflows/ci.yml`.

### Konkreta diffar

1. **Installera Playwrights systembibliotek**, inte bara browsern.
   - `bunx playwright install chromium` → `bunx playwright install --with-deps chromium`
   - Annars saknas libnss/libxss på ubuntu-latest i vissa runners → tester `skip:ar` tyst istället för att verifiera ghost-pathen.

2. **Kör render-canary-testet explicit** som eget steg, före snapshot-diffen.
   - Nytt steg: `bunx vitest run src/lib/tests/snapshot/__tests__/render-canary.test.ts`
   - Skäl: snapshot.test.ts triggar canaryn indirekt, men ett eget steg ger en tydlig grön/röd signal på just disambiguator-logiken och loggar (`[replay] canary ghosts (non-blocking): ...`) hamnar i sitt eget job-steg.

3. **Ladda upp artefakter vid fail** så vi kan inspektera `render-canary.families.json` när en kör går rött.
   - Nytt sista steg med `actions/upload-artifact@v4`, `if: always()`.
   - Paths: `src/lib/tests/snapshot/__fixtures__/**/render-canary.families.json` (justeras till var harness faktiskt skriver — verifieras i build-läge innan workflow committas).

4. **Behåll allt annat** (typecheck, freeze-visibility, snapshot-diff). Ordning: typecheck → freeze-visibility → render-canary → snapshot-diff → upload-artifact.

### Resultat i CI

- Push/PR triggar jobbet (redan konfigurerat).
- I "Run render-canary" får du raden  
  `[replay] canary ghosts (non-blocking): Lexend Deca`  
  som verifierar att HubSpot-fallet klassas som ghost, inte failure.
- I "Run snapshot diff" får du  
  `[snapshot] hubspot: N off-flow suspects`.
- Om något går rött laddas `render-canary.families.json` upp som artefakt på run-sidan i GitHub → du kan diffa `ghosts[]` vs `failures[]`.

## Vad som INTE ändras

- Ingen app-/runtime-kod, ingen test-kod, inget i `harness.server.ts` eller `render-canary.server.ts`.
- Sandbox-körningar förblir skippade (de saknar fortfarande Chromium-deps) — sanning kommer från CI.
- Inget separat workflow-filschema; vi bygger vidare på `ci.yml`.

## Öppen punkt (verifieras i build-läge före commit)

Den exakta output-stigen för `render-canary.families.json`. Jag bekräftar via en snabb `rg "render-canary.families.json"` när vi växlar till build, så artifact-pathen pekar rätt. Om den skrivs till `/tmp` eller annan ej-uppladdbar plats lägger jag in ett env-override (`CANARY_ARTIFACTS_DIR`) i steget istället.
