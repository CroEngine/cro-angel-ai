## Plan: Radera och kör om HiBob freeze

### Steg
1. Radera hela `corpus/hibob/` (freeze-report.json, golden.json, meta.json, page.mhtml, screenshot.jpg).
2. Kör `bun run scripts/freeze-site.ts --name=hibob` på nytt för en helt färsk run.
3. Om consent-selektorn (`#onetrust-accept-btn-handler`) timeout-ar igen, fånga en debug-screenshot via `--screenshot-before-dismiss` och rapportera resultatet — inga ändringar i `corpus/sites.ts` utan ditt godkännande.
4. Visa slutstatus: filer som skapats + ev. fel.

### Vad som INTE ändras
- `corpus/sites.ts` (selektorer) rörs inte i denna run.
- Inga app-/route-/UI-ändringar.