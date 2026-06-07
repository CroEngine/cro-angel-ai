# C2: Hubspot-only cross-env-determinism

Mekanismen är site-oberoende. Hubspot räcker som bevis för A2; hibob läggs till senare som starkare stresstest, inte som blockerare. Consent-fixen är en separat utredning (geo-hypotes först) och hålls utanför denna körning.

## Steg

1. **Riktig hubspot-freeze (macOS, lokalt)**
   - Inte dry-run. Skriv faktiskt till `corpus/hubspot/page.mhtml` + `meta.json`.
   - Verifiera gate-readouts från rapporten:
     - `externalFontSrcCount === 0`
     - `embeddedFontCount` (förväntat ~31)
     - `fontFetchFailures: []`
     - `mhtmlKbBeforeFontEmbed` vs `mhtmlKb` (förväntat ~1878 → ~6804, ≈3.6×)

2. **Läs B-proben vid lokal replay**
   - Kör replay mot den nya frysta MHTML:en på macOS.
   - Fånga `families` + `loaded` från font-proben — detta är render-beviset (gaten bevisar embedding, proben bevisar att de cid:-refererade fonterna faktiskt löser och renderar).
   - Spara readouten; använd för att hårdkoda exakta family-namn i framtida assertions.

3. **Generera lokal golden**
   - Kör snapshot-pipelinen end-to-end mot frysta corpus/hubspot.
   - Commit corpus/hubspot/page.mhtml + golden artifacts till branchen.

4. **Pusha branch → CI**
   - CI kör replay på Linux mot macOS-genererad golden.
   - Diff-resultat = A2-domen:
     - **Noll diff** → embedding neutraliserade substitution. A2 bevisad.
     - **Residual drift** → antingen en font som fortfarande faller tillbaka (B-proben på CI avslöjar vilken family), eller icke-font-källa (line-height-default, DPR, zoom). Diagnostiseras från B-probe-diff Linux vs macOS.

5. **Rapportera CI-diff**
   - Readouts att fånga: gate-counts, B-probe families/loaded (båda env), area/yBand-diff per element.

## Vad som *inte* ingår

- Hibob-consent-fix. Separat spår; geo-hypotes (Browserbase US-egress → ingen OneTrust för hibob) testas innan timeout/selektor rörs. Pinnad egress-region + villkorlig dismissal är troliga åtgärder, men det är en egen liten utredning som inte ska konflateras med "funkar A2".
- Subset-optimering (only-loaded-fonts). Vi mäter `mhtmlKbBeforeFontEmbed` per corpus och optimerar bara om siffran blir absurd.

## Beslutsträd efter CI

- Noll diff på hubspot → A2 bevisad generellt. Gå vidare till hibob-consent-utredning (geo först), sen freeza hibob som täcknings- + stresstest.
- Residual drift → diagnostisera via B-probe-diff innan vidare arbete. Hubspot är då den site som visar exakt vad som återstår, vilket är hela poängen med att köra den först.
