# Lokal MHTML-replay via pinnad Playwright

Replay lämnar Browserbase och kör mot lokal headless Chromium med `file:///tmp/.../page.mhtml`. Capture stannar på Browserbase per default (anti-bot), men capture-transport blir ett per-sajt-val.

## Beslut som låses

| Område | Val |
|---|---|
| Capture (default) | Browserbase MHTML (oförändrat) |
| Capture (fallback) | Lokal single-file HTML — endast för sajter där MHTML-shadow-DOM-trohet fallerar |
| Replay | Lokal Playwright Chromium, `file://`, ingen nätverkstrafik |
| Viewport vid replay | Läses från `meta.json`, pinnad till capture-värdet |
| Golden | **Genereras under lokal replay**, inte under capture |
| Test-runner | Vitest (oförändrat) — `playwright` är bibliotek, inte runner |
| Playwright-version | `playwright@1.60.0` exakt (matchar `playwright-core` 1.60.0 som Stagehand redan löst) |

`@playwright/test` adderas INTE. Capture-koden i `freeze.server.ts` rörs INTE förrän vi behöver lokal single-file-fallback (Salesforce).

## Filer som ändras / skapas

### Ändras
- `package.json` — `"playwright": "1.60.0"` som devDep, ny `postinstall` (eller manuell instruktion) `playwright install chromium`. Inget annat skript-namn ändras.
- `src/lib/tests/snapshot/harness.server.ts` — riven Browserbase-implementation, ersätts av lokal Playwright.

### Skapas
- `.gitignore` — lägg till `/test-results/` om vi behöver tmp-katalog (ev. inte nödvändigt; vi använder `os.tmpdir()`).

### Oförändrat
- `freeze.server.ts`, `scripts/freeze-site.ts` — MHTML-capture på Browserbase fortsätter exakt som idag.
- `normalize.ts`, `snapshot.test.ts` — kontraktet `replayCorpus(name) → { collect, pageAudit }` är identiskt, harness-bytet är dolt för testet.
- `corpus/<name>/{page.mhtml, screenshot.jpg, meta.json}` — samma format.

## Replay-flödet (ny `harness.server.ts`)

```text
replayCorpus(name)
 ├─ läs corpus/<name>/page.mhtml + meta.json
 ├─ kopiera page.mhtml till os.tmpdir() (file:// kräver disk-fil, inte Buffer)
 ├─ chromium.launch({ headless: true })          // bundlad Chromium @ 1.60.0
 ├─ context med viewport = meta.json.viewport     // pinnad från capture
 ├─ page.goto("file:///" + tmpPath)               // Chromium parsar MHTML nativt
 ├─ vänta document.readyState === "complete" + 600ms (CSSOM-settle)
 ├─ page.evaluate(COLLECT_SCRIPT)
 ├─ runPageAudit(page)
 └─ cleanup (close page/context/browser, rm tmpfil)
```

Inga `--allow-file-access-from-files` eller liknande flaggor i v1 — om Chromium klagar lägger vi till `--enable-features=MHTMLFormatRegistryRendererStreaming` eller flaggar headed under xvfb. Det är en run-the-test-and-see-fix, inte ett designbeslut.

## Viktig anpassning: `runPageAudit` + `COLLECT_SCRIPT` signatur

Båda tar idag en **Stagehand**-page. Lokal `playwright`-page har samma `evaluate`/`goto`/`setViewportSize`-API men typerna skiljer. Vi importerar `Page` från `playwright` i harnessen och låter `runPageAudit` ta en strukturell typ (det den faktiskt använder är bara `evaluate`). Ingen körtidsändring, bara typ-justering om TS klagar.

## Verifieringssteg (det här är poängen)

1. **Rökprov HiBob:** `bun run snapshot:update` ska producera `golden.json` med `hero.headline`, `h1Count > 0`, och CTA-räkning som matchar screenshotsen.
2. **Determinismsteg:** kör `bun run snapshot` direkt efter — tom diff.
3. **Shadow-DOM-prov på Salesforce:** frys salesforce.com, replaya, kolla att collectorn hittar shadow-DOM-CTAs. Om count är dramatiskt lägre än prod-live → MHTML round-trippar inte öppen shadow DOM → flagga den sajten för single-file-fallback (separat patch, inte i denna).
4. **Frys övriga korpus-sajter** efter att HiBob är grön två gånger.

## Beslutspunkter under bygget

- **Chromium vägrar rendera MHTML från `file://` i headless:** prova `chromium.launch({ headless: 'new' })` (eller `channel: 'chromium'`), sedan headed under xvfb. Sista utvägen: single-file-HTML-capture i fallback-spåret, INTE A2 (inline computed styles).
- **MHTML förlorar shadow DOM på Salesforce:** lägg in `transport: "single-file"` som per-sajt-flag i `meta.json` och en parallell capture-väg. Den biten skjuts till nästa PR.
- **Lokala fonts skiljer från Browserbase:** OK by design — golden genereras lokalt, så lokal vs lokal matchar. Diff mot live skiljer sig, men det dyker inte upp förrän labeling i Fas 3.

## Vad jag INTE gör i denna PR

- Single-file-HTML-fallback (separat per-sajt-spår, byggs när Salesforce-mätningen kräver det).
- CI-uppsättning (Fas 3).
- Refaktor av `classifiers.ts` (Fas 4).
- Ändringar i `freeze.server.ts` — capture är redan grön.
