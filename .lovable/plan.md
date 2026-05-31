
## Slice 2.1 — Session + Live View + SSE

Bygg endast Slice 2.1. Implementera **inte** inventory, Tests-tabell, passive checks, safe clicks, screenshots, scoring, AI-analys eller persistens ännu. Målet är bara att bevisa Browserbase session-lifecycle + live iframe + SSE + stop/close end-to-end.

### Flöde

```text
Click "Run tests"
  → POST /api/tests/start { url }
      → createSession (synkront tillräckligt för att returnera liveUrl)
      → respond { runId, liveUrl }       ← returneras DIREKT
      → async i bakgrunden:
           emit('session_started', { runId, liveUrl, sessionId })
           page.goto(url)  // får ta tid, loggas via SSE
           emit('log', ...)
  → Frontend byter Viewport-iframe till liveUrl direkt
  → ConsolePanel prenumererar på /api/tests/:runId/stream

Click "Stop"  → POST /api/tests/:runId/stop → abort + closeSession
Timeout 60s   → abort + closeSession
Watchdog 15s  → abort + closeSession
finally       → closeSession körs ALLTID
```

### Run-states (tydliga, inga otydliga lägen)

| Utfall | SSE-events |
|---|---|
| Success | `session_started` → `log*` → **`done`** `{ aborted: false }` |
| Failure | `session_started?` → `log*` → **`error`** `{ message }` (terminal) |
| Abort (stop / watchdog / timeout) | `log*` → **`done`** `{ aborted: true }` |

Frontend behandlar både `done` och `error` som terminala — UI kan aldrig fastna i `running` om SSE stängs.

### Frontend-states

`runState: 'idle' | 'connecting' | 'running' | 'done' | 'error'`

- `connecting`: efter klick, innan `{ runId, liveUrl }` returneras.
- `running`: efter respons + SSE öppen, fram till `done`/`error`.
- `done`: pill visar `done` eller `done · aborted`.
- `error`: pill visar `error` (röd) + meddelande från event.

### Filer

**Frontend** (`src/components/browser-shell/`)
- `UrlBar.tsx` — **Run tests** (play) + **Stop** (square, syns under run). Status-pill.
- `Viewport.tsx` — visar `liveUrl` när run aktiv, annars default-iframe.
- `ConsolePanel.tsx` — byter seed mot `useTestStream(runId)`.
- `BrowserShell.tsx` — håller `runState`, `runId`, `liveUrl`, startar/stoppar.
- `hooks/useTestStream.ts` — `EventSource` wrapper; behandlar `done` och `error` som terminala, stänger streamen.

**Backend** (allt utanför `src/server/`)
- `src/lib/tests/browserbase.server.ts` — `createSession()`, `connect()`, `closeSession()` via `@browserbasehq/sdk` + `playwright-core`.
- `src/lib/tests/orchestrator.server.ts` — `Map<runId, EventBus>` (in-memory), `AbortController` per run, watchdog (15s) + hård timeout (60s), `try/finally` runt allt så `closeSession` alltid körs.
- `src/lib/tests/run.functions.ts` — `startTestRun({ url })`: skapar session synkront, returnerar `{ runId, liveUrl }`, kickar igång `page.goto` async.
- `src/routes/api/tests/$runId.stream.ts` — SSE-server-route, headers korrekta för EventSource, skickar `event:` + `data:` per emit.
- `src/routes/api/tests/$runId.stop.ts` — POST → orchestrator.abort(runId).

### Events i 2.1

Endast: `session_started`, `log`, `done`, `error`. Inga `inventory`, `element_found`, `test_result`, `screenshot` än.

### Secrets (begärs direkt när build startar)

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`

### Packages

`@browserbasehq/sdk`, `playwright-core`.

### Verifiering innan vi stänger sliceen

1. Klicka Run tests → liveUrl syns i iframen inom någon sekund, även om sajten är långsam.
2. Console-fliken visar `session_started` + minst en `log` + `done` när allt går bra.
3. Stop mitt i run → SSE skickar `done { aborted: true }`, session stängs (verifieras i Browserbase-dashboarden).
4. Stäng fliken mitt i run → watchdog stänger session inom 15s.
5. Felaktig URL → `error`-event terminerar streamen, pill blir röd.
