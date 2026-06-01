# Cleanup + UX-fix: enhetlig vy

## Kärnproblem (ditt)
Före Run visar iframen direkt målsidan (`https://glutenforum.se/`) inifrån vår sandbox-iframe. Under Run visar samma iframe Browserbase live-debuggern (chrome-toolbar, helsida). Det är två helt olika vyer — förvirrande.

## Lösning på vyn
**Skippa den statiska för-vyn helt.** Iframen renderas bara när det finns en `liveUrl`. Innan dess: en lugn empty-state ("Click Run tests to launch a Browserbase session"). Då finns det bara *en* vy och den är alltid Browserbase.

Bonus: vi slutar ladda godtyckliga tredjepartssajter i vår egen sandbox-iframe (säkrare och slipper X-Frame-Options/CSP-fel som ändå hindrar många sidor från att laddas direkt).

## Övriga code-review-fynd

### 1. `idleAfterLoad` är skör (BrowserShell.tsx:25)
Detekteras genom att stringmatcha `"navigation complete"` i log-meddelanden. Om vi någonsin ändrar texten går pillen sönder.
**Fix:** emit ett dedikerat event `state` med `{ phase: "idle" }` från orchestratorn när navigeringen är klar, och lyssna på det istället.

### 2. ConsolePanel-tidsstämpel (ConsolePanel.tsx:54)
`fmtTime(ev.data.ts)` — SSE-routen sätter `ts` i data (`{ ...event.data, ts: event.ts }`), så det fungerar faktiskt. ✅ Inget att fixa, jag missförstod först.

### 3. UrlBar-decoration (UrlBar.tsx:42–50, 81–88)
Back/forward/pointer/hand-knapparna är dummy. Antingen ta bort dem eller markera disabled. **Fix:** sätt `disabled` på dem så de inte ser klickbara ut.

### 4. TabStrip är statisk
Bara titel + ett dött X. För Slice 2.1 ok — låt stå.

### 5. Edit-URL nollar `liveUrl` (BrowserShell.tsx:93–95)
Om man ändrar URL under en pågående körning råkar man *inte* nolla liveUrl (bra), men sandbox-iframens `reloadKey` triggas ändå vilket är meningslöst när vi visar Browserbase. **Fix:** när vi tar bort statiska för-vyn försvinner `reloadKey` helt — onödig state.

### 6. Hård 5 min timeout (orchestrator.server.ts:28)
OK för prototyp, men det finns ingen UI-feedback när den slår in. Logevent säger "hard_timeout" via done-event. **Fix:** låt UrlBar visa det via `statusMessage` — redan gjort via `done`-grenen. ✅

### 7. Process-lokal run-registry (orchestrator.server.ts:26)
Funkar bara inom en Worker-instans. Cloudflare kan rotera. Dokumenterat i fil-kommentaren, ok för Slice 2.1.

## Ändringar

**`src/components/browser-shell/Viewport.tsx`**
- Ta bort `url` och `reloadKey` props.
- Om `liveUrl` saknas: rendera empty-state (centrerad text + Play-ikon, muted styling, design-tokens).
- Om `liveUrl` finns: rendera iframe som idag, med "live · Browserbase"-badgen.

**`src/components/browser-shell/BrowserShell.tsx`**
- Ta bort `reloadKey`-state och `onReload`-handler för iframen (reload-knappen i UrlBar blir disabled, se nedan).
- Skicka bara `liveUrl` till `<Viewport />`.
- Lyssna på nytt `state`-event för `idleAfterLoad` istället för stringmatchning.

**`src/components/browser-shell/UrlBar.tsx`**
- `disabled` på back/forward/reload/pointer/hand-knapparna (de är icke-funktionella nu).
- Ta bort `onReload`-prop.

**`src/lib/tests/orchestrator.server.ts`**
- Lägg till `"state"` i `RunEventType`.

**`src/lib/tests/run.functions.ts`**
- När navigeringen är klar: emit `state` med `{ phase: "idle" }` (behåll log-raden som idag för historiken).

**`src/components/browser-shell/hooks/useTestStream.ts`**
- Lägg till `es.addEventListener("state", handle("state"))`.

## Verifiering
- Före Run: tom, lugn vy med call-to-action. Ingen iframe.
- Run: pill `connecting → running → idle`. Live-vyn fyller området. Endast en vy hela tiden.
- Stop: pill `done`. Live-vyn försvinner och empty-state återkommer.
- Reload-knappen i URL-baren är synligt disabled.
