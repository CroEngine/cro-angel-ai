# Plan: håll live-vyn vid liv under 60s-hållfönstret

## Problem

`stagehand.close()` i `runSteps()`-finally tear:ar ner CDP-WebSocket:en så fort sista steget passerat → Browserbase live-vyn visar "WebSocket disconnected" trots att sessionen lever vidare i 60s.

## Fix (förstahand): `keepAlive: true` + behåll `close()`

Per Stagehand-docs: med `keepAlive: true` kopplar `close()` bara loss Stagehands resurser men låter Browserbase-sessionen fortsätta. Det är den rena lösningen.

I `src/lib/tests/engine.server.ts`:

```ts
const stagehand = new Stagehand({
  env: "BROWSERBASE",
  apiKey,
  projectId,
  browserbaseSessionID: sessionId,
  keepAlive: true,
});
```

Befintliga `finally { await stagehand.close(); }` lämnas orörd.

## Fallback (om live-vyn ändå dör)

Om `keepAlive: true` inte räcker (CDP-anslutningen bryts ändå), ta då bort `stagehand.close()`-anropet — Stagehand-objektet GC:as när requesten avslutas, och `closeSession(sessionId)` i orchestratorn river ner sessionen rent.

## Invariant

`closeSession(sessionId)` (anropad från orchestratorns `terminate()`-callback) ska förbli den **enda** platsen där Browserbase-sessionen faktiskt avslutas. Ingen annan kod ska kunna stänga sessionen.

## Verifiering

1. Implementera förstahandslösningen.
2. Kör Run på glutenforum.se → bekräfta att live-iframen visar sidan med overlay i 60s utan "WebSocket disconnected".
3. Om problemet kvarstår, applicera fallbacken och verifiera igen.
