# Fix `[cdp-create] page.context is not a function`

Stage-instrumenteringen pekade ut roten: `page` i `runMobilePass` är Stagehand-wrappern, som forwardar `.evaluate()`/`.reload()` men inte `.context()`. Lösning: tråda in `stagehand.context` (rå Playwright `BrowserContext`) och skapa CDP-sessionen där.

## Ändringar

### 1. `src/lib/tests/runners/pageAudit.server.ts`

- Importera `BrowserContext`-typen (från `playwright-core` om tillgänglig, annars `unknown`-cast med minimal shape: `{ pages(): Page[]; newCDPSession(p: Page): Promise<CDPSession> }`).
- Utöka `runMobilePass`-signaturen:
  ```ts
  export async function runMobilePass(
    page: Page,
    context: { pages: () => Page[]; newCDPSession: (p: Page) => Promise<…> },
    navigation: NavigationData,
    desktop: …,
  )
  ```
- Ersätt rad 480–486:
  ```ts
  stage = "cdp-create";
  const pwPage = context.pages()[0] ?? page;
  cdp = await context.newCDPSession(pwPage);
  if (!cdp) throw new Error("CDP session unavailable");
  ```
- Behåll allt övrigt (`page.reload`, `page.evaluate`, `collectLayoutPass(page)`) — Stagehand-wrappern fungerar för dem (desktop-passet bevisar det).

### 2. `src/lib/tests/engine.server.ts`

- Vid rad 411, skicka in kontexten:
  ```ts
  const mobilePass = await runMobilePass(
    page,
    stagehand.context,
    full.navigation,
    full.layout.desktop,
  );
  ```

## Verifiering

Kör HiBob-audit. Förväntat:
- `layout.mobile.pageSummary.*` fyllda, `mobileError: null`.
- Om det failar i nästa stage: `mobileStage` säger `reload` (HiBob autoplay → byt till explicit wait) eller `collect`/`build` (tom array → guard mot 0-div i `foldDepthFirstCtaPx`). Stage-markören fångar utan ytterligare ändring.

## Out of scope

- Flag-rules.ts (nästa steg när mobil-JSON är verifierat).
- Eventuell `reload`-fallback — vänta tills `mobileStage` säger att det behövs.
