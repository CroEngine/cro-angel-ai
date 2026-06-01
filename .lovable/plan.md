# Plan: behåll live-vyn så overlayen syns efter run

Två ändringar — UI behåller iframen, backend håller sessionen vid liv en stund efter sista steget.

## 1. `BrowserShell.tsx` — behåll `liveUrl` efter done

Ta bort `setLiveUrl(null)` i `done`/`error`-grenarna (rad 36 + 42). Iframen ska fortsätta visa sidan med overlayen. I `Viewport`-badgen ändrar vi texten från `live · Browserbase` till `ended` när `runState === "done"`, så det är tydligt att sessionen inte längre kör.

`handleRun` nullar redan `liveUrl` i början av nästa run, så vi får inte kvarliggande state-läckage.

Lägg till en liten "Close"-knapp i `Viewport` (eller `UrlBar`) som anropar `stopTestRun` + nullar `liveUrl` lokalt, så användaren kan stänga manuellt när de är klara.

## 2. `run.functions.ts` — håll Browserbase-sessionen vid liv 60s efter sista steget

I dag: så fort `runSteps` returnerar utan fel kör vi `terminate(runId, "done", …)` som omedelbart kör `closeSession(sessionId)`. Det stänger Browserbase-sidan, overlayen försvinner.

Ändring: efter framgångsrik körning, vänta upp till 60 000 ms (med `signal: run.abort.signal` så användarens "Stop"/"Close" avbryter direkt) **innan** vi terminerar. Vid timeout eller abort → kör befintlig `terminate(...)`.

Lägg till en `log`-event före väntan: `"keeping session open 60s — click Close to end now"` så det syns i konsolen.

Vid `result.failed > 0` → terminera direkt som idag (ingen anledning att hålla en trasig session öppen).

## 3. Inget annat behövs

`stopTestRun` finns redan och flippar abort-signalen → väntan bryts → session stängs rent. `Viewport`-badgen är en triv ändring.

## Verifiering

Kör Run på glutenforum.se: efter `collect`-steget passerar ska iframen fortsätta visa sidan med cyan rektanglar + nummerbadge:r i ~60 s, badge byter till "ended", och "Close" stänger sessionen direkt.
