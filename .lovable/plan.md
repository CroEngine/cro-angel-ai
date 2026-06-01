Jag föreslår en liten men mer robust ändring i sessionslivscykeln:

1. Ändra Stagehand-städningen i `engine.server.ts`
   - Sluta anropa `stagehand.close()` efter en lyckad körning.
   - Låt Stagehand-objektet lämnas ifred under hold-fönstret så live-vyn inte får en CDP/WebSocket-disconnect.
   - Behåll en kontrollerad cleanup endast om `stagehand.init()` eller själva körningen kraschar innan sessionen går in i hold-läge.

2. Behåll Browserbase-sessionens enda riktiga avslut i orchestratorn
   - `closeSession(sessionId)` ska fortsatt bara köras via `terminate()` i `run.functions.ts` / `orchestrator.server.ts`.
   - Close-knappen, fel, timeout och 60s hold avslutar sessionen därifrån.

3. Lägg till tydligare intern loggning
   - Logga när Stagehand-cleanup hoppas över för att hålla live-vyn aktiv.
   - Logga när sessionen faktiskt avslutas via orchestratorn.

Tekniskt blir detta fallback-steget vi pratade om: `keepAlive: true` räckte inte helt, så nästa rimliga fix är att inte koppla ner Stagehand-CDP alls efter lyckad run. Det bör minska risken för `debugging connection was closed` medan live-vyn fortfarande ska kunna avslutas korrekt via `closeSession(sessionId)`.