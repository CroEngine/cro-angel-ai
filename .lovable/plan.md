## Beslut

**A+C antaget.** Svar på den produktstrategiska frågan: **JA** — page-speed och allt capture-mätt lever utanför den jämförbara scoren, som rapporterad proveniens-metadata. Det stänger B-bakvägen och gör pinning-treadmillen onödig.

Bärande invariant framöver: **score = f(frusen DOM, extractor_vN)**. Inget annat får påverka siffran. Chromium-version är proveniens, inte parameter.

## Vad som ändras

### 1. Etablera `extractorVersion` som förstklassig stämpel
- Ny fil `src/lib/tests/extractor-version.ts` — exporterar `EXTRACTOR_VERSION` (semver-sträng, startar `"1.0.0"`) + kort changelog-kommentar. Bumpas manuellt vid varje ändring i `src/lib/tests/scripts/*` eller `engine.server.ts`-aggregering som kan flytta siffror.
- `pageAudit.ts` / `engine.server.ts` stämplar `extractorVersion` på audit-resultatet (top-level fält).
- `schema.ts` (`PageAuditResult`) får `extractorVersion: string`.
- `llmContext.ts` läser stämpeln och inkluderar i kontexten.

### 2. Page-speed → proveniens, inte score
- `runPageSpeedInsights` är redan en separat serverfn — bra. Vi flaggar det explicit i fil-toppen: "PROVENIENS, EJ SCORE. Resultatet får renderas i UI som 'observerat vid capture' men aldrig viktas in i jämförbar siffra."
- `performanceProxy` i `pageAudit.ts` flyttas under `provenance` i auditresultatet (eller markeras `nonComparable: true`) så det är omöjligt att av misstag aggregera in i score.
- `schema.ts` får ett `Provenance`-block: `{ capturedAt, chromiumVersion, browserbaseRegion?, viewport, pageSpeed?, performanceProxy? }`.

### 3. Capture-env stämplas på `freeze-report.json` (proveniens)
- `freeze.server.ts`: efter Browserbase-connect, läs `browser.version()`, viewport, ISO-tid. Skriv `env: { chromiumVersion, viewport, frozenAt, source: "browserbase" }` i `freeze-report.json`. Ingen enforcement, bara observation.

### 4. Replay-env-stämpel (redan delvis byggd) — slutförs
- `harness.server.ts`: när `pinned === false`, skriv INTE `render-canary.families.json` (vi har redan koden för `env`-objektet). Logga warning. Detta gör inspector-flaggan "✗ render-canary.families.json" till en valid signal.

### 5. Score-emission bär stämpeln
- Varje score-emitter (när score-aggregator byggs — i dag finns bara audit-blobben) MÅSTE inkludera `{ extractorVersion, snapshotId, frozenAt }` i payloaden. Vi lägger en helper `stampScore(payload)` i `extractor-version.ts` och en lint-regel-light: scoring-paths importerar `stampScore` istället för att hardkoda strängar.

### 6. CI/CLI: re-score-svep
- Nytt script `scripts/rescore-corpus.ts`: itererar `public/corpus/*`, parsar `page.mhtml` lokalt (ingen browser), kör extractor, jämför med tidigare `score.json` om finns, rapporterar diffs grupperade per `extractorVersion`-par. Detta är den nya "drift-detektorn" — flyttad från Chromium-axeln till extractor-axeln där drift är återhämtningsbar.
- Slopa det tidigare föreslagna `scripts/check-env-drift.ts` (Chromium-axeln). Behåll bara `env` i `freeze-report.json` som passiv proveniens.

### 7. Dokumentation
- `.lovable/plan.md`: ny sektion "Comparability contract (A+C)" som listar de tre garantierna och vilka filer som upprätthåller var.

## Vad som INTE görs

- Ingen Chromium-pinning för Browserbase (oåterkallelig drift, accepteras som proveniens).
- Inget auto-re-freeze vid env-drift.
- Inget score-aggregator-bygge i denna PR — bara invarianten (`extractorVersion`-stämpel + `provenance`-block) så framtida aggregator inte kan göra fel.
- Ingen ändring av `client.ts`/auto-genererade filer.

## Verifiering

- `bun run scripts/freeze-site.ts <url>` → `freeze-report.json` innehåller `env.chromiumVersion`, `env.frozenAt`, `env.viewport`.
- Pageaudit-resultat innehåller `extractorVersion: "1.0.0"` på top-level, `performanceProxy` och pagespeed under `provenance`.
- `bun run scripts/rescore-corpus.ts` kör end-to-end på `hibob` + `hubspot`, returnerar 0 diffs (samma extractor-version).
- Sätt `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/bin/chromium-browser` lokalt → harness skapar INTE `render-canary.families.json`, loggar warning.

## Filer som ändras

- skapas: `src/lib/tests/extractor-version.ts`, `scripts/rescore-corpus.ts`
- ändras: `src/lib/tests/schema.ts`, `src/lib/tests/scripts/pageAudit.ts`, `src/lib/tests/engine.server.ts`, `src/lib/tests/llmContext.ts`, `src/lib/tests/pagespeed.functions.ts` (kommentar-toppen), `src/lib/tests/snapshot/freeze.server.ts`, `src/lib/tests/snapshot/harness.server.ts`, `.lovable/plan.md`

Godkänn så bygger jag.
