## Mål

Utöka corpus från 2 → 6 siter genom att lägga till **Salesforce, Slack, Monday.com, Kry** i `corpus/sites.ts` och köra freeze på var och en med rätt consent-hantering.

## Princip (samma som HiBob/HubSpot lärde oss)

Varje site läggs till **en i taget**. För varje site:

1. Lägg till `SiteSpec` i `corpus/sites.ts` med best-guess `consentSelector`
2. Kör dry-run med `--screenshot-before-dismiss` för att se vad som faktiskt visas
3. Justera selector / `consentDismissCheck` (detached vs hidden) / eller markera "ingen banner" baserat på vad screenshoten visar
4. Kör skarp freeze
5. Verifiera artefakter: `golden.json`, `meta.json`, `page.mhtml`, `screenshot.jpg`, `freeze-report.json` med `ok === true`
6. Bekräfta att `/corpus`-sidan visar siten som "freeze ok"
7. Commit innan nästa site

Aldrig batch-freezing — varje site har sina egna consent-quirks (det är hela poängen med assertion i `freeze.server.ts`).

## Best-guess startpunkter per site

| Site | URL | Förväntad consent |
|---|---|---|
| Salesforce | https://www.salesforce.com | OneTrust (`#onetrust-accept-btn-handler`), detached |
| Slack | https://slack.com | OneTrust, detached |
| Monday.com | https://monday.com | Eget cookie-system, troligen hidden — verifiera |
| Kry | https://www.kry.se | EU GDPR-banner, troligen Cookiebot (`#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll`), detached |

Dessa är gissningar — `--dry-run --screenshot-before-dismiss` är det som bestämmer faktisk selector.

## Ordning

1. **Salesforce** först (enklast — standard OneTrust)
2. **Slack** (samma mönster)
3. **Kry** (Cookiebot, ny variant)
4. **Monday.com** sist (mest egen-byggt, mest osäkert)

## Scope-begränsning

- Inga ändringar i `freeze.server.ts`, `freeze-site.ts`, eller UI:t
- Inga ändringar på HiBob/HubSpot
- Inga nya features i corpus — bara fler datapunkter

## Stoppvillkor per site

Om en site inte går att freeza rent efter 2 försök (consent-banner som inte beter sig), **stoppa och rapportera** istället för att lägga in en stale selector. Samma policy som HiBob (där vi valde "ingen banner i Browserbase-region" framför att lägga in en selector som inte triggas).
