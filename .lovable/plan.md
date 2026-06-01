# Migrera till Stagehand/Playwright via Browserbase

## Mål
All test-exekvering ska gå via Stagehand (eller Playwright direkt). Ingen egen CDP-WebSocket-kod kvar.

## Stoppregel
**Ingen UI- eller feature-utveckling sker förrän Steg 1 (runtime-spike) är avgjord.** Risk: vi designar runt en motor som inte kan köras i workerd.

---

## Steg 1 — Runtime spike (tvådelad)

Avgör om Cloudflare Workers (workerd) klarar Playwright och/eller Stagehand när de bara används som CDP-klient mot en redan-startad Browserbase-session.

### Spike A — `playwright-core` + `chromium.connectOverCDP(connectUrl)`
1. `bun add playwright-core`.
2. Ny serverfunktion `spikePlaywright()` som:
   - Skapar Browserbase-session (befintlig `createSession`).
   - `const browser = await chromium.connectOverCDP(session.connectUrl)`.
   - `const page = (await browser.contexts())[0].pages()[0] ?? await ...newPage()`.
   - `await page.goto("https://glutenforum.se")`, läs `await page.title()`.
   - Stäng session.
3. Anropa via `invoke-server-function`, läs `server-function-logs`.

### Spike B — `@browserbasehq/stagehand` med `env: "BROWSERBASE"`
1. `bun add @browserbasehq/stagehand`.
2. Ny serverfunktion `spikeStagehand()` som:
   - `new Stagehand({ env: "BROWSERBASE", apiKey: process.env.BROWSERBASE_API_KEY, projectId: process.env.BROWSERBASE_PROJECT_ID, browserbaseSessionID: session.id })`.
   - `await stagehand.init()`.
   - `await stagehand.page.goto("https://glutenforum.se")`.
   - Eventuellt prova en `stagehand.page.act("scroll to footer")` för att bekräfta att Model Gateway funkar via Browserbase-nyckeln (ingen separat OpenAI/Anthropic-key).
   - Stäng.
3. Anropa via `invoke-server-function`, läs `server-function-logs`.

### Beslutsgrind
| A | B | Beslut |
|---|---|--------|
| ✅ | ✅ | Kör **Stagehand** i Worker (AI-primitiver + Playwright-API). Gå till Steg 2. |
| ✅ | ❌ | Kör **Playwright-only** i Worker. Bygg step-DSL utan AI-primitiver tills vidare. Gå till Steg 2 med justerad step-modell. |
| ❌ | ❌ | **Flytta test-exekvering till en separat Node-runtime** (egen tjänst, eller använd Browserbases Agent API om det matchar våra behov). Ny mini-plan skrivs då. |
| ❌ | ✅ | Osannolikt — i så fall kör Stagehand. |

### Vanliga fel att tolka korrekt
- `__dirname is not defined` / `[unenv] X is not implemented` → Node-only import. Räknas som ❌ för det biblioteket.
- 401 från Browserbase → secret-problem, inte runtime — fixa och kör om.
- Timeout i `connectOverCDP` → WS-transport ok men anslutning hängde; kör om / kolla `connectUrl`.

### Secrets
Behåll: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` (redan finns).
Vi använder Browserbase Model Gateway för Stagehands AI-anrop → **ingen** separat OpenAI/Anthropic-secret behövs.
Lovable AI Gateway lämnas utanför detta jobb.

---

## Steg 2 — Byt ut motorn (utförs efter spike-beslut)

### Nya filer
- **`src/lib/tests/engine.server.ts`** — tunn wrapper:
  ```ts
  export async function runSteps(sessionId: string, steps: Step[], opts: {
    onEvent: (e: EngineEvent) => void;
    signal: AbortSignal;
  }): Promise<void>
  ```

### Step-modell (initial)
```ts
type Step =
  | { kind: "goto"; url: string }
  | { kind: "click"; selector: string }          // Playwright
  | { kind: "fill"; selector: string; value: string }
  | { kind: "assertText"; text: string }
  | { kind: "wait"; ms: number }
  // Endast om Stagehand-vägen valdes:
  | { kind: "act"; instruction: string }
  | { kind: "extract"; instruction: string }
  | { kind: "observe"; instruction: string };
```

### Ändringar i befintlig kod
- **`browserbase.server.ts`** — behåll `createSession`/`closeSession`. Ta bort `navigateViaCDP` när Steg 2 är klart och verifierat.
- **`run.functions.ts`** — `startTestRun` tar `{ url, steps }`. Hårdkodad default-test tills UI-step-editor finns: `goto → wait 500ms → assertText("Glutenforum")`.
- **`orchestrator.server.ts`** — nya event-typer: `step_started`, `step_passed`, `step_failed` (data: `{ index, kind, summary, error? }`).
- **`useTestStream.ts`** — lyssna på de nya eventen.
- **`ConsolePanel.tsx`** — rendera step-events tydligt (✓/✗ prefix + steg-index).
- **`BrowserShell.tsx`** — `idleAfterLoad` ersätts av terminal `done` (alla steg klara eller första fail).

## Verifiering
- Spike-funktioner returnerar 200 och loggar visar lyckad navigering via valt bibliotek.
- Default-testet kör tre steg och visar tre step-events i konsolen.
- Live-iframen visar sidan kontinuerligt under hela körningen.
- `navigateViaCDP` är borttagen ur kodbasen.

## Vad detta plan **inte** löser (medvetet uppskjutet)
- UI för att skapa/redigera tester (nästa slice).
- Persistens i DB (process-lokalt registry kvar).
- Multi-user/auth.
