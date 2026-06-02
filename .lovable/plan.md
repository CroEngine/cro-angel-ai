## Problem

`Download JSON`-knappen i Findings gör inget när man klickar. Koden använder mönstret `a.href = blobUrl; a.click()` inuti Lovables sandboxade preview-iframe, vilket webbläsare numera kan blockera tyst (ingen `allow-downloads` på iframen → click blir no-op, ingen konsoll-felmeddelande). Att det "fungerade igår" stämmer väl med detta — det är beroende av webbläsare/iframe-policy, inte vår kod.

## Lösning

Endast `FindingsView.tsx` — gör `downloadJson` robust:

1. Bygg blob + objectURL som idag.
2. Försök först `window.open(url, "_blank", "noopener")`. Om popup öppnas visas JSON i ny flik där användaren kan spara — fungerar inuti preview-iframen.
3. Om `window.open` returnerar `null` (popup blockerad eller utanför iframe), fall tillbaka till nuvarande `<a download>`-klick.
4. `URL.revokeObjectURL(url)` efter ~60 s timeout så nya fliken hinner ladda.

Inga ändringar i `findings.ts`, datainsamling, layout eller andra knappar.

## Filer

- `src/components/browser-shell/FindingsView.tsx` — uppdatera `downloadJson`-helpern.

## Inte i scope

- Ingen ny UI, ingen toast.
- Inga ändringar i `rawPageAudit` / `rawCollect`-insamling eller övriga Findings-vyer.
