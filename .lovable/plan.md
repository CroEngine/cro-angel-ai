# Fix `[cdp-create] context.newCDPSession is not a function`

## Rotorsak

Den installerade Stagehand är **v3 ("understudy")** — ingen Playwright under huven. `stagehand.context` är en `V3Context` och `context.pages()[0]` är en `V3Page`. Ingen av dem exponerar Playwright-API:t `newCDPSession`. Tidigare ronders antagande att vi bara var "ett wrapper-lager för högt" stämmer inte; det finns ingen rå Playwright-`BrowserContext` att nå alls.

Det vi däremot har: `V3Page` exponerar **`sendCDP(method, params)`** publikt (`node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/understudy/page.js:540`), som talar direkt med sidans main CDP-session. Det är precis vad emuleringen behöver — och en bättre väg än att allokera en ny CDPSession ovanpå en redan-CDP-driven page.

## Ändringar

### 1. `src/lib/tests/runners/pageAudit.server.ts`

**Ta bort hela CDP-session-skapandet** och använd `page.sendCDP` direkt.

- Ta bort `context`-parametern från `runMobilePass`-signaturen (rad 472–480). Behåll bara `page`, `navigation`, `desktop`.
- Skriv om stage `cdp-create` / `cdp-metrics` / `cdp-touch` / `cdp-ua` till att smalna in en `cdp`-helper:
  ```ts
  const sendCDP = (page as unknown as {
    sendCDP: (m: string, p?: unknown) => Promise<unknown>;
  }).sendCDP?.bind(page);
  if (typeof sendCDP !== "function") {
    throw new Error("page.sendCDP unavailable (Stagehand v3 expected)");
  }
  ```
  Stage-namnen behålls (`cdp-metrics`, `cdp-touch`, `cdp-ua`) men anropen blir `await sendCDP("Emulation.setDeviceMetricsOverride", {...})` osv.
- Ta bort den lokala `cdp`-variabeln och `if (!cdp) throw …`.
- I `finally`: ersätt `cdp?.send(...)` med `sendCDP?.(...)` (samma tre clear-anrop). Skydda med `if (typeof sendCDP === "function")` så vi inte kastar om vi failade innan helpern fanns.
- Tagga den nya första stagen som `cdp-bind` (för att hålla diagnostiken meningsfull om `sendCDP` saknas i en framtida version).

### 2. `src/lib/tests/engine.server.ts`

- Anropet vid rad ~411: ta bort `stagehand.context`-argumentet och castet:
  ```ts
  const mobilePass = await runMobilePass(page, full.navigation, full.layout.desktop);
  ```

## Tekniskt sidnoteringar

- `page.reload`, `page.evaluate`, `collectLayoutPass(page)` förblir oförändrade — V3Page forwardar redan dessa (desktop-passet bevisar det och bekräftades senast med `foldDepthFirstCtaPx 413` intakt).
- `Emulation.setDeviceMetricsOverride` med `mobile: true` skriver fortfarande över `window.innerWidth/innerHeight` (CDP-spec) → fold-beräkningarna följer med utan ändring i collect-scriptet.
- Vi tappar inget genom att slippa `newCDPSession` — `sendCDP` använder samma main session som Stagehands egna anrop, så vi är garanterat på rätt target och slipper ytterligare en session att städa upp.

## Verifiering

Kör HiBob-audit. Förväntat:
- `layout.mobile.pageSummary.*` ifyllt, `mobileError: null`, `mobileStage: null`.
- Om nästa stage failar fångar `mobileStage` det:
  - `reload` → autoplay-video håller `domcontentloaded` öppen längre än 30s → byt till `load` + explicit `waitForLoadState` eller höj timeout.
  - `collect`/`build` → division-med-noll eller saknad sektion → guard i `foldDepthFirstCtaPx` / `buildPageSummary`.

Ingen ändring i desktop-pipen, schema, eller engine-flödet utöver call-site.

## Out of scope

- `flag-rules.ts` (nästa steg när mobil-JSON är verifierat).
- Eventuell `reload`-fallback — vänta tills `mobileStage` säger att det behövs.
