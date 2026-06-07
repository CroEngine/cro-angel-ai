# Installera Playwright Chromium + utöka CI snapshot-coverage

Två saker som hänger ihop:

1. **Lokalt i Lovable-sandboxen** — Playwright Chromium saknas, så jag kan inte köra `snapshot.test.ts` här efter en omfrys.
2. **CI** — installerar Chromium men kör bara `freeze-visibility.test.ts`. Snapshot-diffen mot hibob/hubspot golden körs **inte i CI heller**. Ny hubspot-baseline är därför ovaliderad efter push.

## Steg

1. **Installera Chromium lokalt:**
   ```bash
   bunx playwright install chromium
   ```

2. **Verifiera lokalt** att snapshot-testen nu går igenom mot ny hubspot-baseline:
   ```bash
   bunx vitest run src/lib/tests/snapshot
   ```
   - hibob ska vara grön (orörd)
   - hubspot ska vara grön mot ny golden

3. **Utöka CI** så snapshot-diffen körs vid varje push — annars upptäcker vi en trasig baseline först när någon manuellt kör testen lokalt. Ändring i `.github/workflows/ci.yml`:
   ```yaml
   - name: Run snapshot tests
     run: bunx vitest run src/lib/tests/snapshot
   ```
   Lägg som separat steg efter `freeze-visibility` (så vi ser vilket av dem som failar).

## Frågor

- **Räknar vi om hubspots golden.json** om snapshot-diffen failar i steg 2? Bannern var ju i gamla golden — fält som `aboveFold trust signals`, hero salience osv. har troligen ändrats. Det är förväntat och korrekt, men vi måste aktivt godkänna den nya goldenen (commit:a den).
- Eller vill du **se diffen först** innan vi commit:ar ny golden, för att verifiera att förändringarna är "consent-relaterade" och inte något annat?

## Vad vi INTE rör

- `corpus/sites.ts` — redan uppdaterad till `hidden`, ingen ny ändring.
- `corpus/hibob/*` — orört.
- Övriga 8 sites — separat runda när detta är grönt.
