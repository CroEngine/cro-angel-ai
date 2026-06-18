# Golden.json Driver-klassificering — Block B0 (plan v2, omkörd)

> Spike-leverabel inför Block B (MHTML→golden-extractor-pass). **Reviderad
> premiss.** Den tidigare versionen klassade enskilda fält som *ren-DOM* vs
> *render-härlett* under antagandet att golden delvis kunde reproduceras i
> Node + jsdom. Det antagandet är fel: **hela `golden.json` är produkten av
> `replayCorpus`**, som kör pinnad headless Chromium på den rehydrerade
> MHTML:en. Det finns inget fält i golden som produceras före Chromium har
> kört layout, JS, font-loading och scroll. Fält som *ser* ren-DOM ut
> (selektorer, taggnamn, `title`) emitteras ändå av in-page-evaluates efter
> render.
>
> Den fråga B0 faktiskt måste besvara är därför inte "vilka fält är ren-DOM"
> utan: **kan `replayCorpus` köras deterministiskt utan headless Chromium,
> eller måste B vara en headless-driver?** Svaret styr B:s scope binärt —
> det finns inget mellanläge.

## Svar: B måste vara en headless-Chromium-driver

Genomgång av `replayCorpus` (se driver-stegstabellen nedan) visar att varje
steg som bidrar med innehåll till golden kräver en riktig layoutmotor:
viewport + `deviceScaleFactor`, scroll-triggad lazy-load,
`getBoundingClientRect`, `getComputedStyle`, resolverad `currentSrc` och
`document.fonts`. De enda stegen som är ren Node (filresolution,
sha256-integritet, MHTML-font-parse) producerar **inget** golden-innehåll —
de matar bara Chromium. En jsdom-väg kan alltså inte producera samma golden;
det finns ingen delmängd att lyfta ut till Node.

**Beslut för Block B:** B är **ett** block, inte två. B = headless-Chromium-
driver som återanvänder exakt samma replay+normalize-kedja som
`snapshot.test.ts`, men körd från en Node-CLI istället för vitest och med en
write-gate som alltid skriver till angiven path. B kräver därmed en miljö som
kan installera Playwrights bundlade Chromium (CI/Browserbase-klass), inte
ren sandbox. Den tidigare uppdelningen B-DOM + B-render utgår.

## Driver-klassificering av `replayCorpus`

Steg-för-steg genom `src/lib/tests/snapshot/harness.server.ts:167`
(`replayCorpus`). Kolumnen **driver** anger om steget är ren Node-DOM/IO
(körbart utan webbläsare) eller kräver layout/paint/JS i Chromium.

| steg | rad | driver | not |
|---|---|---|---|
| Fil-/pekarresolution, externalized-gate | 167–233 | **ren Node IO** | bara `existsSync`/JSON-läsning; producerar inget golden-innehåll |
| Fetch + sha256-integritet av extern MHTML | 243–275 | **ren Node IO** | hämtar bytes till tmp; ingen render |
| `extractEmbeddedFamilies` (font-backfill) | 280–296 | **ren Node parse** | textparse av MHTML; matar canaryn, ej golden |
| `chromium.launch` + `newContext` (viewport, `deviceScaleFactor`) | 303–316 | **Chromium** | viewport + DPR sätts vid context-skapande; styr sub-pixel-layout |
| `context.route` abort + `addInitScript` nav-neutralisering | 327–344 | **Chromium** | krävs för att frozen-SPA inte ska navigera bort kontexten |
| `page.goto(file://)` + `waitForReady` | 350–351 | **Chromium (load)** | rehydrerar MHTML, kör sid-JS |
| URL-stabilisering + CSSOM/layout-settle (600 ms) | 353–362 | **Chromium (layout)** | väntar in layout; ren timing-bunden |
| `waitForStableContext` | 368 | **Chromium** | gate mot exec-context-rivning |
| `runRenderCanary` (`document.fonts`, layout-mått) | 375–474 | **Chromium (paint)** | font-resolution + layout; diagnostik, men hård gate |
| `nodeLoopScroll` (lazy-load, IntersectionObserver) | 482 | **Chromium (layout+JS)** | scroll expanderar DOM; utan detta saknas innehåll |
| `nodeLoopStampCookieRoot` (`getBoundingClientRect`) | 485 | **Chromium (layout)** | mäter banner-geometri |
| `page.evaluate(COLLECT_SCRIPT)` → `collect.elements` | 487 | **Chromium (layout+paint)** | rects, computed styles, visualWeight, contrast |
| `runPageAudit` → `pageAudit.*` | 490–493 | **Chromium (layout+paint)** | above-fold, sections, hero, image-format-resolution |

**Slutsats:** allt golden-innehåll uppstår i de Chromium-bundna stegen
(`collect` + `pageAudit`). De tre ren-Node-stegen är ren input-prep. Det
finns ingen DOM-only-projektion att återanvända som separat B-DOM-block.

## Projektionssteget (SSOT för B)

Projektionen från `replayCorpus`-output (rik shape, identisk med live-engine)
till committad `golden.json` är **två rena funktioner**, inte ett moget
pipeline-steg och inget separat script:

```text
replayCorpus(name)                         harness.server.ts:167
  → { collect, pageAudit }   (rik shape)
        │
        ▼
normalizeCollect(fresh.collect)            normalize.ts:72
normalizePageAudit(fresh.pageAudit)        normalize.ts:103
        │
        ▼
JSON.stringify(_, null, 2) → golden.json   snapshot.test.ts:91–99
        ▲
        └── enda anroparen idag: snapshot.test.ts (gated på
            SNAPSHOT_UPDATE=1 eller saknad golden)
```

Diffningen mot golden görs av `diffNormalized` i samma fil
(`normalize.ts:176`).

**Detta är B:s kontrakt — låst till befintlig SSOT:**

1. Återanvänd `normalizeCollect` + `normalizePageAudit` från `normalize.ts`
   **oförändrat**. De *är* projektionen; B får inte återimplementera dem.
2. `scripts/extract-golden.ts` skiljer sig från `snapshot.test.ts` på exakt
   två punkter:
   - **drivern**: vitest+chromium → Node-CLI som anropar `replayCorpus`
     direkt (B0-bekräftad: headless Chromium, ingen jsdom-variant).
   - **write-gaten**: skriver alltid till angiven path, aldrig gated på
     `SNAPSHOT_UPDATE`/golden-frånvaro.
3. Diff-validering i B:s N=3-loop använder `diffNormalized` **oförändrat**.

## Schema-mismatch — nu förklarad

Tidigare version noterade att committad `golden.json` har en slim shape som
inte matchar vad live-extraktorn (`runners/pageAudit.server.ts`) emitterar,
och drog slutsatsen att ett okänt "golden-projektionssteg" måste lokaliseras.
**Det steget är nu lokaliserat: det är `normalizeCollect` +
`normalizePageAudit`** (`normalize.ts:72`/`:103`). Slim-shapen är inte en
äldre extractor-version — den är normaliseringens medvetna nedskärning
(selektorer, sub-pixel-rects, array-ordning, råa computed styles, timestamps
strippas; se kommentaren överst i `normalize.ts`). Ingen extra arkeologi
behövs; B wrappar replay→normalize som ovan.

`EXTRACTOR_VERSION` (`"1.0.0"`) säger inget om projektionen — projektionen
lever helt i `normalize.ts`, inte i extractor-versioneringen.

## Risk-flagga för Block C

Eftersom B är headless Chromium och freeze-pipelinen (capture) också kör
Chromium, **kollapsar B och capture till samma driver-klass**. Då kan B inte
användas som ett *oberoende* mätinstrument för C: vi skulle mäta
capture-drivers (tarpit, animation) med samma sorts capture-driver. Om en
mekanism slår på render via Chromium kan B reproducera samma drift snarare än
att avslöja den.

**Konsekvens för C:** C behöver ett extra delsteg — en DOM-only-snapshot vid
sidan av (ren Node-parse av MHTML utan render) som referenspunkt, så att
"slår drivern på golden?" inte besvaras av samma motor som producerar driften.
Detta är en C-fråga, inte en B-fråga; B:s scope ändras inte av den.

## Rekommendation till Block B (sammanfattning)

1. Bygg `scripts/extract-golden.ts` som **en** headless-Chromium-driver som
   anropar `replayCorpus` → `normalizeCollect`/`normalizePageAudit` → skriv.
   Ingen B-DOM/B-render-delning.
2. Determinism-validering N=3 mot samma MHTML via `diffNormalized`
   oförändrat; byte-identisk normaliserad output är kravet.
3. Korpus-validering: kör mot `corpus/hubspot/`s MHTML, jämför mot committad
   `golden.json`. Avvikelser är information, inte fail.
4. Miljö: kräver Playwright-bundlad Chromium (CI/Browserbase-klass), inte
   ren sandbox.

## Förbehåll

Driver-klassificeringen är gjord mot `harness.server.ts` så som den ser ut
nu. En framtida refaktor som flyttar någon mätning ut ur Chromium (osannolikt
givet att `collect`/`pageAudit` är delade med live-engine) skulle kräva en
omkörning. Risk-flaggan för C vilar på att B och capture delar Chromium —
verifiera under C att DOM-only-referensen faktiskt är driver-oberoende innan
den används som dom-instans.
