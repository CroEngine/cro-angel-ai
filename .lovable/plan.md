# Städa upp debug-instrumentering i mobil-passet

Mobil-passet fungerar — `layout.mobile` och `viewportDelta` fylls i. Stage-trackingen och `mobileError`/`mobileStage`-fälten har gjort sitt jobb. Behåll skyddet (try/catch + null-fallback), släng scaffoldingen.

## Ändringar

### 1. `src/lib/tests/runners/pageAudit.server.ts` — `runMobilePass`

- Ta bort `let stage: string = "init"` och alla `stage = "..."`-omtilldelningar (rader 478, 480, 492, 500, 503, 509, 514, 528, 531).
- Förenkla `MobilePassResult`-typen: ta bort `error?` och `stage?`. Kvar: `{ mobile, viewportDelta }`.
- Catch-blocket krymper till en `console.warn("[mobile-pass] failed:", ...)` (en rad serverlogg så framtida regression inte blir helt tyst) + retur `{ mobile: null, viewportDelta: null }`.
- Behåll: try/finally-cleanup, `sendCDP`-bindning + dess precondition-guard, hela success-pathen inkl. `primaryCtas`/`aboveFoldTrust`.

### 2. `src/lib/tests/engine.server.ts` (rad ~411–445)

- Ta bort `mobileError`/`mobileStage`-fälten ur både success- och fel-grenarna när `data.layout` byggs.
- Fel-grenens loggrad blir: `pageAudit/mobile: skipped` (vi har ingen err-text längre — den finns i serverlogg via `console.warn`).
- `data.layout.mobile = mobilePass.mobile` (kan vara null), `viewportDelta = mobilePass.viewportDelta`.

### 3. `src/lib/tests/schema.ts` (rad 446–449)

- Ta bort `mobileError?` och `mobileStage?` från `layout`-typen.

### 4. Rensa engångs-discovery

- Sök efter ev. kvarvarande `console.log("stagehand keys"…)` eller liknande discovery-snuttar och ta bort dem. (Snabb `rg` först — om inget hittas är det redan rent.)

### 5. `.lovable/plan.md`

- Ta bort filen — den dokumenterar redan löst problem.

## Verifiering

Kör HiBob-audit. Förväntat:
- `layout.mobile.pageSummary.*` ifyllt, `viewportDelta` ifyllt.
- Inga `mobileError`/`mobileStage`-nycklar i JSON-output.
- Desktop oförändrat.
- Vid framtida fel: `console.warn` syns i serverlogg, mobil-blocket nullas, runner kraschar inte.

## Out of scope

- `flag-rules.ts` (nästa steg — väntar på dina två beslut: flera flags per regel vs aggregerad, statisk vs beräknad severity).
- `reload`-strategi och `collectLayoutPass`-guards — inga problem observerade.
