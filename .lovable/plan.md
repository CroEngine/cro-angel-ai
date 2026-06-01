
# Alltid-synlig vy utan att betala för en alltid-levande browser

## Scope (medvetet smalt)

1. Ta screenshot direkt efter `collect`.
2. Stäng Browserbase-sessionen så fort screenshoten är klar (eller efter triggers nedan).
3. Visa screenshoten i viewporten när sessionen är död.
4. Rita befintliga overlay-rektanglar ovanpå screenshoten.
5. Statuschip uppe: **Cold / Live / Frozen**.
6. Resume = starta en helt ny run mot `lastUrl`. Inget state-återställande.

Allt utöver detta (cookie/localStorage-persistens, exakt state-resume, kostnadsuppskattning i kr) skjuts upp.

## Tre tillstånd

| Tillstånd | Vy | Browserbase |
|---|---|---|
| **Cold** | Tom platta + "skriv URL för att starta" | Av |
| **Live** | Browserbase-iframe (som idag) | På |
| **Frozen** | Screenshot + overlay-rektanglar + Resume-knapp | Av |

## Live → Frozen triggers

- **60 s efter `done`** (run klar, inget mer aktivt).
- **15 s efter `document.visibilityState === "hidden"`**.
- **10 min hard cap** på Live, oavsett.

Ingen mus/tangent-baserad idle-detektor i denna iteration.

## Frozen-state äger

- `screenshotUrl` (data-URL eller objekt-URL)
- `overlayElements` (lista av `{ selector, category, rect }` från senaste collect)
- `lastUrl`
- `collectedData` (hela senaste collect-resultatet, för konsolen)

Bevaras i `BrowserShell`-state. Konsol-events rörs inte.

## Tekniska ändringar

### `src/lib/tests/engine.server.ts`
- Efter att `collect`-steget byggt `data`-objektet: kör `page.screenshot({ type: "jpeg", quality: 60 })`, base64-encoda till data-URL.
- Emit:a nytt event `snapshot` med `{ url: lastUrl, screenshotUrl, viewport: { w, h } }` innan `step_passed` skickas. (Eller bifoga som fält i `step_passed.data` — enklare. Väljs vid implementation.)
- Inga ändringar i collect/intent/visualWeight/dedupe.

### `src/lib/tests/orchestrator.server.ts`
- Lägg `freezeRun(id, reason)`: kör `closeSession()`, markera `frozen: true`, emit `frozen` event. Behåller `Run` i mappen så konsol-buffer består.
- Lägg `IDLE_AFTER_DONE_MS = 60_000`, `HIDDEN_MS = 15_000`, `HARD_CAP_MS = 600_000` (för manuell terminate triggrad från klienten — själva timer-logiken bor i klienten i v1, se nedan).
- Behåll nuvarande `terminate` för error/abort.

### `src/lib/tests/run.functions.ts`
- Ny server-fn: `freezeRun({ runId })` — kallar `freezeRun` i orchestrator.
- `startTestRun` oförändrad (returnerar `runId` + `liveUrl`).

### `src/components/browser-shell/BrowserShell.tsx`
- Byt `runState` mot `sessionState: "cold" | "live" | "frozen" | "error"`.
- Plocka ut `screenshotUrl` + overlay-data från `step_passed`/`snapshot`-eventen och spara i state.
- Tre `setTimeout`-baserade triggers (alla i klienten):
  - vid `done`-event → 60 s timer → `freezeRun`
  - `visibilitychange` → om hidden, 15 s timer → `freezeRun`; cancel om visible igen
  - vid `live`-start → 10 min timer → `freezeRun`
- `handleResume(url)` → kalla `startTestRun({ url: lastUrl })` på nytt. Samma flöde som idag.

### `src/components/browser-shell/Viewport.tsx`
- Splitta render:
  - `sessionState === "live"` → iframe (som idag)
  - `sessionState === "frozen"` → `<FrozenViewport screenshotUrl overlayElements onResume />`
  - `sessionState === "cold"` → tom placeholder
- `FrozenViewport`: `<img>` i full container + absolut-positionerade `<div>` per overlay-element (samma kategori-färger som live-overlayen), centrerad Resume-knapp vid hover.

### `src/components/browser-shell/UrlBar.tsx`
- Lägg `SessionChip` till vänster om URL-fältet: visar tillståndet + minuträknare när Live. Klick i Frozen = Resume.

## Frozen overlay — koordinatsystem

`rect` från collect är dokument-relativ (`scrollY` inräknad). Screenshoten är viewport-stor (inte full page). I v1: vi tar screenshot efter att engine scrollat tillbaka till topp, så viewport-koordinater = `rect.x`/`rect.y - 0`. Element under vikningen i screenshoten klipps bort — överlay ritar bara element vars `rect.y < viewportHeight`. Acceptabelt för v1; full-page screenshot kommer senare.

## Acceptanskriterier

1. Cold default vid app-start. Ingen Browserbase-session.
2. URL + Enter → Live + iframe.
3. Run gör collect → screenshot bifogas → 60 s efter `done` → Frozen automatiskt. Användaren ser screenshot + samma färgade overlay.
4. Tab hidden 15 s → Frozen.
5. 10 min Live → Frozen.
6. Klick på Resume → ny Live-session mot `lastUrl`. Screenshot kvar tills nytt collect skrivit över.
7. Konsolen behåller alla events över freeze.

## Vad vi inte rör

- Cookie/storage-persistens.
- Full-page screenshot (bara viewport i v1).
- Idle-detektor på mus/tangent.
- Kostnad i kronor.
- Multi-session.
