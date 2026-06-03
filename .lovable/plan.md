# Omgång 2b — Recurse into wrapper children

Tidigare hypotes (Framer Motion + nollhöjd) bekräftades fel av `lazyDebug` (nästan tom). Verklig orsak: HiBob är WordPress, `wp-site-blocks`-wrappern (90% av DOM) skippas korrekt av wrapper-filtret, men `return` kastar hela subtreet — så de verkliga sektionerna inuti hittas aldrig.

## Ändring

`src/lib/tests/scripts/sections.ts`, addNode() — wrapper-skip-grenen:

Istället för att `return` när ratio/höjd-tröskel slår till, traversera wrapperns direkta barn innan vi lämnar:

```js
if (tooBig || tooTall) {
  // Skip the wrapper itself but recurse into its direct children so we
  // don't lose real sections nested inside a page-wrapping <div>/<form>.
  try {
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) addNode(kids[i]);
  } catch (_) {}
  return;
}
```

`seen`-setet förhindrar dubbletter mot landmark-skanningen, och varje barn går igenom samma storleks-/cookie-/wrapper-filter rekursivt — så en wrapper-i-wrapper (t.ex. `wp-site-blocks > .entry-content`) hanteras naturligt.

## Övriga noter

- `lazyDebug` och fallback-koden för nollhöjd behålls — den gör ingen skada och vi vet nu att det inte var problemet, men den kan rädda framtida Framer Motion-fall.
- Inga schemaändringar.
- `wrapperDebug` fortsätter logga som tidigare och visar nu om rekursionen körs på rätt wrappers.

## Verifiering

Kör HiBob igen:
- `sections[].length` ska öka markant (förväntar minst 8–12 istället för 5).
- `wrapperDebug` ska fortfarande visa `wp-site-blocks` som `skipped: true`.
- Nya sektioner i `sections[]` ska ha headings från innehållet inuti wrappern.
- Workable/Teamtailor/Ashby ska inte regredera — vi lägger bara till barn-traversering på noder som ändå skulle skippats.

## Fil

- `src/lib/tests/scripts/sections.ts` — addNode() wrapper-grenen.
