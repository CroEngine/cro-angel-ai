## Plan

1. **Uppdatera den aktuella HubSpot-snapshoten**
   - Kör snapshot-update lokalt i projektet så `corpus/hubspot/golden.json` matchar den nuvarande frysta sidan.
   - Kontrollera att inga oväntade filer utöver snapshot-output behöver ändras.

2. **Gör snapshot-diffen mindre fladdrig**
   - Justera normaliseringen i `src/lib/tests/snapshot/normalize.ts` så små area/position-variationer inte fäller CI.
   - Behåll viktiga ändringar som text, länk, kategori, intent, section och ovanför-vik som regressioner.

3. **Städa GitHub Actions-varningen**
   - Lägg in `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` även i `.github/workflows/update-snapshot.yml`, eftersom CI redan har den.

4. **Verifiera**
   - Kör bara de relevanta snapshot-testerna efter ändringen.
   - Målet är att `snapshot.test.ts` går grönt på samma commit som CI kör.