## Mål
Stabilisera tech stack-detektionen med två nya detektorer (WordPress, Tealium) och ta bort temporär debug-utdata. Kör sista verifiering på HiBob — sen är tech stack klar.

## Ändringar

### 1. Lägg till WordPress- och Tealium-detektorer (`src/lib/tests/scripts/pageAudit.ts`)
- **WordPress**: matcha `/wp/wp-includes/` eller `/wp-content/` i URL-sökvägen (kategori: `cms`).
  - Exempel: `new.hibob.com/wp/wp-includes/js/dist/...`, `new.hibob.com/wp/wp-plugins/debloat/...`
- **Tealium**: matcha `tiqcdn.com` (kategori: `analytics`).
  - Exempel: `tags.tiqcdn.com/utag/hibob/hibob/prod/utag.js`
- Båda läggs till i `TECH_RULES`-arrayen.

### 2. Ta bort `_debug`-fältet (`src/lib/tests/scripts/pageAudit.ts` + `src/lib/tests/schema.ts`)
- `_debug` var temporärt och behövs inte längre — detektionen är verifierad.
- Ta bort `_debug`-bygget från `pageAudit.ts`.
- Ta bort `_debug`-typen från `PageAuditData.techStack` i `schema.ts`.

### 3. Sista verifiering på HiBob
- Kör page audit mot `https://www.hibob.com/se/`.
- Bekräfta att `techStack.detected` innehåller: `wordpress`, `tealium`, `onetrust`, `vwo`.
- Bekräfta att `firstPartyScriptCount > 0` och `thirdPartyScriptCount` stämmer.

## Efter verifiering
- Tech stack anses klar.
- Nästa steg: `flag-rules.ts` (enligt användarens riktning).