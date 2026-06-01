## Fix: live-iframen droppar efter sidladdning

### Problem
Sessionen stängs så fort `Page.loadEventFired` fyrar → live-vyn visar "WebSocket disconnected". Watchdog (15s) skulle stänga den ändå strax efter.

### Ändringar

**`src/lib/tests/run.functions.ts`**
- Efter lyckad `navigateViaCDP`: ta bort `terminate(runId, "done", ...)`.
- Ersätt med `emit(runId, "log", { level: "info", message: "navigation complete — session idle, click Stop to end" })`.
- Felväg (`error`) och abort-väg oförändrade.

**`src/lib/tests/orchestrator.server.ts`**
- Höj `HARD_TIMEOUT_MS` från 60_000 → 300_000 (5 min).
- Ta bort `WATCHDOG_MS` och hela watchdog-`tick`-loopen i `createRun`.
- `terminate()` rör inte längre `watchdog`-timern (finns inte).

**`src/components/browser-shell/UrlBar.tsx`**
- Lägg till `"idle-loaded"` läge i `RunState`-pill (eller återanvänd `running` med dynamisk label). Enklast: skicka in en `idleAfterLoad`-flagga från `BrowserShell` baserad på om vi sett `navigation complete`-log, och visa label `"idle"` istället för `"running"`.

**`src/components/browser-shell/BrowserShell.tsx`**
- Detektera `log`-event med `message === "navigation complete — session idle, click Stop to end"` → uppdatera en lokal `idleAfterLoad`-state → skickas vidare till `UrlBar`.
- Stop-knappen visas fortfarande (isActive = true).

### Verifiering
1. Run på en sajt → iframen laddar och **stannar uppe**.
2. Pill: `connecting` → `running` → `idle` efter load.
3. Stop → `done · aborted`, session försvinner i Browserbase-dashboarden.
4. 5 min utan input → hard timeout fyrar `done · hard_timeout`.
5. Ogiltig URL → `error` röd pill.

### Utanför scope
Inventory, scans, screenshots, persistens. Fortfarande bara Slice 2.1.
