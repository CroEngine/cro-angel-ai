# Steg 2 — Byt motor till Stagehand

Spike-resultat: Spike A (playwright-core) ✅ 4.8s, Spike B (Stagehand) ✅ 6.9s. Båda kör i workerd mot Browserbase utan Node-only-fel. Vi väljer **Stagehand** — vi får både Playwright-API:t (`goto`, `click`, `fill`, `title`) och AI-primitiverna (`act`, `extract`, `observe`) genom samma motor, och Model Gateway via Browserbase-nyckeln räcker (ingen separat AI-secret).

## Mål
Ta bort `navigateViaCDP` och köra all sessionsinteraktion via Stagehand. Introducera en step-modell och step-events så UI:t kan visa flerstegsförlopp.

## Filer som ändras / skapas

### Ny: `src/lib/tests/engine.server.ts`
Tunn wrapper runt Stagehand. Exporterar:
```ts
export type Step =
  | { kind: "goto"; url: string }
  | { kind: "wait"; ms: number }
  | { kind: "assertText"; text: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "act"; instruction: string }
  | { kind: "extract"; instruction: string }
  | { kind: "observe"; instruction: string };

export type EngineEvent =
  | { type: "step_started"; index: number; kind: Step["kind"]; summary: string }
  | { type: "step_passed";  index: number; kind: Step["kind"]; summary: string; durationMs: number; data?: unknown }
  | { type: "step_failed";  index: number; kind: Step["kind"]; summary: string; durationMs: number; error: string }
  | { type: "log"; message: string };

export async function runSteps(
  sessionId: string,
  steps: Step[],
  opts: { onEvent: (e: EngineEvent) => void; signal?: AbortSignal },
): Promise<{ passed: number; failed: number; aborted: boolean }>;
```
- Skapar `Stagehand({ env: "BROWSERBASE", browserbaseSessionID: sessionId, apiKey, projectId })` och `init()`.
- Hämtar/skapar aktiv `Page` via `stagehand.context`.
- Itererar steg, emitterar `step_started` → kör → emitterar `step_passed`/`step_failed`. Vid första `step_failed` avbryter resten (markeras som "skipped" via aggregerad räknare; emitterar inte separata events för skippade steg i denna iteration).
- Respekterar `signal.aborted` mellan steg.
- `finally`: `stagehand.close()`.
- `assertText`: `page.getByText(text).first().waitFor({ state: "visible", timeout: 5000 })`.
- `wait`: `page.waitForTimeout(ms)`.

### Ändras: `src/lib/tests/browserbase.server.ts`
- Ta bort hela `navigateViaCDP` (CDP-WS-koden, ~100 rader).
- Behåll `createSession` / `closeSession` exakt som idag.

### Ändras: `src/lib/tests/orchestrator.server.ts`
- Lägg till nya event-typer i `RunEventType`: `step_started`, `step_passed`, `step_failed`.
- Inga andra ändringar (registry, SSE-broadcast oförändrat).

### Ändras: `src/lib/tests/run.functions.ts`
- `startTestRun` tar nu `{ url, steps? }`. Om `steps` saknas: default-test = `[{goto:url}, {wait:500}, {assertText:"Glutenforum"}]`.
- Bygger `Step[]` (lägger `{goto:url}` först om användaren skickade `steps` utan goto).
- Ersätter `await navigateViaCDP(...)` med `await runSteps(session.id, steps, { onEvent, signal })`.
- `onEvent` mappar engine-events till orkestrator-events (step-events vidarebefordras 1:1, `log` → existerande `log`-event).
- Emitterar fortfarande `state: { phase: "idle" }` efter första lyckade `goto` så `idleAfterLoad` i UI fortsätter funka.
- Terminal `done` med `{ aborted, passed, failed }`.

### Ändras: `src/components/browser-shell/hooks/useTestStream.ts`
- Lyssna även på `step_started`, `step_passed`, `step_failed`.

### Ändras: `src/components/browser-shell/ConsolePanel.tsx`
- Rendera step-events tydligt:
  - `→ [1] goto https://glutenforum.se`
  - `✓ [1] goto (820ms)`
  - `✗ [3] assertText "Glutenforum" — timeout 5000ms`
- Behåller existerande log-rendering.

### Oförändrat
- `BrowserShell.tsx`, `UrlBar.tsx`, `Viewport.tsx`, SSE-routen `/api/tests/$runId/stream`.
- `useTestStream` returnerar fortfarande hela `events`-arrayen, så `idleAfterLoad`-logiken i `BrowserShell` fungerar oförändrat.

## Default-test (hårdkodat tills UI-editor finns)
```ts
[
  { kind: "goto",       url: <inputUrl> },
  { kind: "wait",       ms: 500 },
  { kind: "assertText", text: "Glutenforum" },
]
```

## Städning
- Ta bort `spike.functions.ts`, `src/routes/spike.tsx`, `src/routes/api/public/spike.ts`. Spike-rollen är slutförd.

## Verifiering
1. Klicka Run i UI:t → live-iframen visar sidan.
2. Konsolen visar tre step-events i ordning, alla ✓.
3. `done`-event kommer med `passed: 3, failed: 0`.
4. Ändra default-testets `assertText` till en sträng som inte finns → step 3 blir ✗, run avslutas med `done {passed:2, failed:1}`, UI visar `error · ...`.
5. `rg navigateViaCDP src` returnerar tomt.

## Uttryckligen utanför scope (nästa slice)
- UI för att skapa/redigera tester.
- Persistens i DB.
- Multi-user / auth-scoping av runs.
- AI-primitiverna (`act`/`extract`/`observe`) — de finns i Step-typen och engine-implementationen, men default-testet använder dem inte än.
