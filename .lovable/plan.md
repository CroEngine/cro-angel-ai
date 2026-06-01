# Fix: live-iframen visar about:blank

## Problem
`debuggerFullscreenUrl` streamar den första tabben i Browserbase-sessionen (about:blank). Vår CDP-kod använder `Target.createTarget` som öppnar en *ny* tabb och navigerar den — så live-vyn fortsätter visa den tomma original­tabben medan sidan laddas osynligt i bakgrunden.

## Lösning (Alternativ A)
Navigera den **befintliga** default-tabben istället för att skapa en ny. Då matchar live-vyn det som händer.

## Ändringar

**`src/lib/tests/browserbase.server.ts`** — i `navigateViaCDP`, ersätt `Target.createTarget` + `Target.attachToTarget` med:

1. `Target.getTargets` → hitta första target där `type === "page"`.
2. `Target.attachToTarget` med det `targetId` + `flatten: true` för att få en `sessionId`.
3. `Page.enable` på sessionen.
4. `Page.navigate` med `{ url }` på samma session.
5. Vänta som idag på `Page.loadEventFired` för samma `sessionId`.

Resten (timeout, abort, logghooks, WebSocket-livscykel) är oförändrat.

## Verifiering
- Kör test mot `https://glutenforum.se/` → live-iframen visar sidan ladda, inte about:blank.
- Pillen går `connecting → running → idle` som tidigare.
- Stop släpper sessionen.
