
# Polish av Cold/Live/Frozen — 7 småfix

Sju småfix på den befintliga implementationen. Inga nya features, ingen ny datamodell.

## Prioriterat

### 1. `liveStartedAt` startar för tidigt
**Idag**: sätts vid Run-klick → räknaren ljuger 1–2 s.
**Fix**: i `BrowserShell.tsx`, ta bort `setLiveStartedAt(Date.now())` i `handleRun`. Lägg `useEffect` som lyssnar efter första `session_started`-eventet och sätter `liveStartedAt` då.

### 2. Resume nollar inte gammal Frozen-cache
**Idag**: ny run startas → gamla bilden ligger kvar tills nytt collect skriver över. Om nya runnen kraschar visar vi förra körningens bild.
**Fix**: i `handleRun` (`BrowserShell.tsx`), `setFrozen(null)` innan `startFn` anropas.

### 3. Frozen visas inte alls om collect misslyckas
**Idag**: `done` utan screenshot → vi faller tillbaka till Cold-platta trots att vi precis kört en session.
**Fix**: i `Viewport.tsx`, lägg en "Frozen utan snapshot"-variant:
- Om `sessionState === "frozen"` och `frozen === null` → visa en grå panel med "Session ended · no snapshot captured" + Resume-knapp.
- Cold-pattan visas bara när `sessionState === "cold"`.

## Mindre

### 4. Overlay för element ovanför viewporten
**Idag**: filter `el.rect.y < viewport.h` släpper igenom negativa `y` → rektanglar ritas utanför bilden.
**Fix**: i `Viewport.tsx`, byt filter till `el.rect.y + el.rect.h > 0 && el.rect.y < viewport.h`.

### 5. Hidden-tab racekondition
**Idag**: snabba flikbyten kan stapla flera timers; bara en clearas vid `visible`.
**Fix**: i `BrowserShell.tsx` `visibilitychange`-handler, clearTimeout även när man byter till `hidden` (innan ny timer sätts), så det aldrig finns mer än en.

### 6. `statusMessage` "done · aborted" syns inte längre
**Idag**: chipen visar bara "Frozen · click to resume", aborted-info försvinner.
**Fix**: i `UrlBar.tsx`, om `sessionState === "frozen"` och `statusMessage` innehåller "aborted" → visa `Frozen · aborted` istället för standardtexten.

### 7. Screenshot-storlek i SSE (notera, inte fix nu)
**Idag**: ~150–200 KB base64 per `step_passed` skickas över EventSource. Fungerar, men kommer bli flaskhals vid större sidor / fler steg.
**Plan**: lägg in en `console.warn` i `useTestStream` om `ev.data.length > 500_000` så vi ser när det börjar gör ont. Riktig fix (R2/storage-upload) skjuts till senare sprint.

## Filer som rörs

- `src/components/browser-shell/BrowserShell.tsx` — fix 1, 2, 5
- `src/components/browser-shell/Viewport.tsx` — fix 3, 4
- `src/components/browser-shell/UrlBar.tsx` — fix 6
- `src/components/browser-shell/hooks/useTestStream.ts` — fix 7

## Inte med

- Ingen ändring i `engine.server.ts`, `orchestrator.server.ts`, `run.functions.ts`.
- Ingen ändring i collect/intent/visualWeight.
- Ingen storage-upload av screenshots (sparat till senare).
