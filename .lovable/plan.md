# Diagnostisera och fixa tysta mobil-pass

Mål: nästa run ska antingen producera `layout.mobile`/`viewportDelta`, eller säga *exakt* var det small — direkt i JSON-artefakten, inte bara i serverloggen.

## Vad jag hittade i nuvarande `runMobilePass`

1. **`page.reload({ waitUntil: "networkidle", timeoutMs: 30_000 })`** — Playwright-optionen heter `timeout`, inte `timeoutMs`. Vår 30s-budget appliceras aldrig, så reload faller tillbaka till default-timeout på `networkidle`. HiBob har autoplay-video + tredjepartsscript som håller nätet "aktivt" → reload kastar tyst, hela try-blocket nullas.
2. **CDP-session skapas via en cast** (`page as unknown as { context: () … }`). Stagehand wrappar Playwright-page:n; om `.context().newCDPSession(page)` får wrappern i stället för det underliggande Playwright-page-objektet kastar callet. Det är samma risk planen hedgade mot men aldrig verifierade.
3. **Felet hamnar bara i `EngineEvent.log`**, inte i artefakten. Idag returneras `{ mobile: null, viewportDelta: null, error }` men `error` skrivs aldrig in i `data.layout.mobileError` — engine läser bara `mobilePass.error` för loggraden och kastar bort det. Resultat: tyst null i JSON.

## Plan

### 1. `src/lib/tests/runners/pageAudit.server.ts` — gör felet diagnosbart

I `runMobilePass`:

- Introducera `let stage: string = "init"` och uppdatera före varje delsteg: `"cdp-create"`, `"cdp-metrics"`, `"cdp-touch"`, `"cdp-ua"`, `"reload"`, `"warmup"`, `"collect"`, `"build"`.
- I `catch` returnera `error: \`[${stage}] ${msg}\`` med `e.stack ?? e.message`.
- Lägg till valfritt `stage` på `MobilePassResult`-typen så det kan persisteras separat.

Fixar:

- Byt `page.reload({ waitUntil: "networkidle", timeoutMs: 30_000 })` →
  `page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 })`.
  `networkidle` är fel verktyg på sidor med autoplay-media; warmup-loopen + den efterföljande sleep:en ger lazy content tid att hydrera ändå.
- Plocka det råa Playwright-page-objektet för CDP. Stagehand re-exporterar Playwright-Page direkt, så casten ska gå mot Playwright-typen:
  ```ts
  import type { Page as PWPage } from "playwright-core";
  const pw = page as unknown as PWPage;
  const cdp = await pw.context().newCDPSession(pw);
  ```
  (om `playwright-core` inte finns: importera via `@playwright/test`-typer som transitivt-dep från Stagehand — i värsta fall behåll `unknown`-casten men kalla `.context()` på den **otaggade** `page` precis som idag, och bekräfta i nästa run via stage-markören att det är `cdp-create` som brister, inte casten).

### 2. Persistera felet in i artefakten

I `src/lib/tests/engine.server.ts`, `case "pageAudit"`-grenen där `runMobilePass` anropas:

Idag:
```ts
if (mobilePass.mobile && mobilePass.viewportDelta) { … }
else { onEvent({ type: "log", message: `pageAudit/mobile: skipped (${mobilePass.error ?? "unknown error"})` }) }
```

Ändra fail-grenen till att också skriva in felet i den returnerade datan:
```ts
data = {
  ...(data as typeof full & { overlayElements?: unknown }),
  layout: {
    ...full.layout,
    mobile: null,
    mobileError: mobilePass.error ?? "unknown error",
    mobileStage: mobilePass.stage ?? null,
  },
};
```

Och i happy-path-grenen sätt `mobileError: null` så fältet alltid finns.

### 3. `src/lib/tests/schema.ts` — schema-stöd

Lägg till på `PageAuditData.layout` (eller dess inre typ):
```ts
mobileError: string | null;
mobileStage: string | null;
```
Båda nullable. Inga existerande consumers bryts.

### 4. Verifiera

Kör HiBob-audit igen och inspektera JSON:
- Om mobil lyckas: `layout.mobile.pageSummary.foldDepthFirstCtaPx` är ett tal, `mobileError: null`.
- Om mobil fortfarande failar: `layout.mobileError` innehåller `[stage] meddelande` så vi vet om det är `cdp-create` (orsak 1: cast), `reload` (orsak 3: HiBob-nät), eller `collect`/`build` (orsak 2: downstream antagande).

## Tekniska detaljer

- Reload-byte är ren option-fix; ingen ändrad semantik för redan fungerande sidor.
- `stage`-instrumenteringen är ~6 rader och tas inte bort efter felsökning — den är billig att ha kvar permanent och gör framtida fel självdiagnosticerande.
- Inga downstream-consumers använder `layout.mobile` ännu (flag-engine kommer härnäst), så att lägga till `mobileError`/`mobileStage` på samma nivå är säkert.

## Out of scope

- Den separata 10-raders CDP-isoleringstesten (det är ett ad-hoc-script, inte produktionskod — kör den lokalt om steg 4 inte räcker för disambiguering).
- Flag-rules.ts — fortsatt nästa steg när mobil-data är verifierat in.
