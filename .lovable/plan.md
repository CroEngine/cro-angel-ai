# Kör testsviten och rapportera räknar-output

Kör i ordning, rapportera resultat:

1. **`bun tsc --noEmit`** — sanity (vi vet redan att det är rent, men billig dubbelkoll efter mode-switch).

2. **`bunx vitest run src/lib/tests/scripts/__tests__/collect-visibility.test.ts`** — 6 tester ska passera (4 isVisible + 2 isSuspectOffFlow).

3. **`bunx vitest run src/lib/tests/snapshot/__tests__/snapshot.test.ts`** — kör hubspot-replayen. Två observationer att rapportera:
   - `[snapshot] hubspot: N off-flow suspects`-raden (förväntat N=0)
   - Om diff: är det `suspectOffFlow`-fältet som dykt upp i golden? Om ja, lista selektorerna; annars är det en orelaterad regression och vi stannar för att utreda.

4. **Om suspects > 0:** logga selektorerna och låt användaren bestämma om vi ska
   (a) rebaselina golden med `SNAPSHOT_UPDATE=1` (intentionellt — vi har första datapunkten), eller
   (b) inspektera DOM:en för att avgöra om predikatet ska skärpas innan baseline frusas.

5. **Om suspects = 0 och ingen diff:** klart, vi har bekräftat att räknaren ger rätt signal på en ren sajt och är redo för korpus-expansion.

Inga kodändringar i detta steg — endast körning + rapportering.
