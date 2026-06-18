# Golden.json Field Classification — Block B0 (plan v2)

> Spike-leverabel inför Block B (MHTML→golden-extractor-pass). **Reviderad
> efter pre-B-lokaliseringen av projektionssteget.** Den ursprungliga
> fält-uppdelningen (ren-DOM vs render-härlett) byggde på fel premiss: hela
> `golden.json` är post-`replayCorpus`, dvs producerad efter att headless
> Chromium kört layout, JS, font-loading och animation på den rehydrerade
> MHTML:en. Den verkliga B0-frågan är därför inte "vilka fält är ren-DOM"
> utan **"kan `replayCorpus` köras deterministiskt utan headless Chromium,
> eller måste B vara en headless-driver?"** — den frågan styr B:s scope
> binärt, utan mellanläge.

## Projektionssteget (SSOT för Block B)

Det finns **inget** separat `extract-golden`-steg att återanvända.
Projektionen från rik replay-output till `golden.json` är två rena
funktioner anropade direkt från vitest:

```text
corpus/<name>/page.mhtml
        │
        ▼
replayCorpus(name)                    ← src/lib/tests/snapshot/harness.server.ts:167
  └── Chromium + collect + pageAudit  (rik shape, samma som live-engine)
        │
        ▼
{ collect:   normalizeCollect(fresh.collect),       ← src/lib/tests/snapshot/normalize.ts:72
  pageAudit: normalizePageAudit(fresh.pageAudit) }  ← src/lib/tests/snapshot/normalize.ts:103
        │
        ▼
JSON.stringify(_, null, 2) → corpus/<name>/golden.json
        │
        ▲
        └── enda anroparen: src/lib/tests/snapshot/__tests__/snapshot.test.ts:91-99
            (skrivning gated på SNAPSHOT_UPDATE=1 || saknat golden)
```

Diffning körs av `diffNormalized` i samma fil (`normalize.ts:176`).

**B-kontrakt (låst mot denna SSOT):**

1. Återanvänd `normalizeCollect` + `normalizePageAudit` från `normalize.ts`
   **oförändrat** — de ÄR projektionen.
2. `scripts/extract-golden.ts` skiljer sig från `snapshot.test.ts` endast på
   (a) drivern (vitest+chromium → Node CLI + B0-vald driver) och (b)
   write-gaten (alltid skriva till angiven path, inte gated på
   `SNAPSHOT_UPDATE`).
3. Diff-validering i B:s N=3-loop använder `diffNormalized` oförändrat.

## Driver-stegsklassificering av `replayCorpus`

Steg-för-steg genom `harness.server.ts`. Frågan per steg: **ren DOM-parse
(Node/jsdom-möjligt) eller kräver layout/paint (headless Chromium)?**

| steg | rad | natur |
|---|---|---|
| MHTML-resolution (lokal kopia / extern fetch + sha256-verify) | `~242–274` | **ren I/O** — ingen browser |
| `embeddedFamilies`-backfill (parsa MHTML-text) | `~280–296` | **ren I/O / textparse** — ingen browser |
| `chromium.launch` + `newContext` (pinnad viewport, `deviceScaleFactor=1`) | `303–317` | **layout** — DPR måste sättas vid context-skapande, annars driftar sub-pixel-rundning |
| route-abort + `addInitScript` (neutralisera nav/redirect) | `327–344` | browser-setup |
| `page.goto(file://)` + `waitForReady` | `350–351` | **render/load** — JS körs, MHTML committas |
| URL-stabilisering (250 ms-tickar) | `354–360` | render-tid |
| CSSOM/layout-settle 600 ms | `362` | **layout/paint** |
| `waitForStableContext` | `368` | render-tid |
| render-canary (font-resolution påverkar layout) | `375–474` | **paint/font** |
| `nodeLoopScroll` (triggar lazy-load + IntersectionObserver) | `482` | **render-tid** — ändrar vilka element som finns/syns |
| `nodeLoopStampCookieRoot` | `485` | DOM-mutation i page-kontext |
| `page.evaluate(COLLECT_SCRIPT)` → `elements` | `487` | **layout-bunden** — `getBoundingClientRect` / `getComputedStyle` |
| `runPageAudit(page, …)` → `pageAudit` | `490–493` | **layout-bunden** — kör i page-kontext mot utlayoutad DOM |

**Binär slutsats:** allt från `chromium.launch` (steg 3) och framåt kräver en
levande browser. De enda Node-rena stegen (MHTML-resolution + family-backfill)
producerar **inget** golden-data — de förbereder bytes för replay. Både
`collect` och `pageAudit` emitteras av `page.evaluate` mot en utlayoutad DOM.

→ **`replayCorpus` kan inte köras utan headless Chromium. B måste vara en
headless-driver.** Det finns inget jsdom-mellanläge som matchar committad
golden, eftersom committad golden i sin helhet är Chromium-replay-output —
även nominellt "ren-DOM"-fält (`innerText`-whitespace, `currentSrc`-srcset,
`document.title` efter JS) skulle divergera från en jsdom-extraktor.

### Risk-flagga för Block C

Om B = headless Chromium och freeze-pipelinen också är headless Chromium,
kollapsar de till **samma driver**. Då kan B inte användas som *oberoende*
mätinstrument för C (animation/tarpit) — vi skulle mäta capture-drivers med
samma capture-driver. C behöver i så fall ett extra delsteg: ett separat
DOM-only-snapshot vid sidan av som referens.

## Upptäckt under klassningen — schema-mismatch

`corpus/hubspot/golden.json`s shape matchar **inte** vad live-extraktorn
emitterar idag (`src/lib/tests/runners/pageAudit.server.ts` returnerar
`head, hreflang, headings, images, videos, links, schema, content,
indexability, contentMetrics, performanceProxy, resourceHints, techStack,
sections, sectionOrder, trustSignals, trustSummary, ctas, forms,
navigation, visualHierarchy, pageSummary, hero, ...`). Committad golden
har bara en delmängd: `head` (4 fält), `headings` (2), `hero` (4),
`images` (5), `trustSummary` (3), `trustEvidence` (1), `ctaSummary` (3),
`sectionOrder` (lista). Samma sak för `collect.elements`: golden har en
slim shape (12 fält) medan live emitterar 14+ fält inklusive
`computedStyles`, `visualWeight`, `attributes`, `rect`, `position`,
`selector`.

**Förklaring (löst i pre-B):** delmängden är inte en separat
projektions-fil — det är exakt vad `normalizeCollect` + `normalizePageAudit`
plockar ut ur den rika replay-shapen (se `normalize.ts:72`/`103`). Den slim
formen är normaliserings-utdatan, inte en stale extractor-version.
`EXTRACTOR_VERSION` (`"1.0.0"`) bekräftar inte vilken side som projicerar och
behövs inte: SSOT är `normalize.ts`.

---

## Appendix — per-fält ren-DOM vs render-härlett (sekundär fråga)

> Behålls som referens, **inte** som B:s scope-drivare. Tabellerna svarar på
> en annan fråga än driver-frågan ovan: *"om vi någon gång byggde en
> jsdom-extraktor, vilka fält skulle den i princip kunna reproducera?"* Den
> render-bundna delmängden är ändå dokumenterad här för Block C:s
> DOM-only-referensfråga. Eftersom committad golden i sin helhet är
> Chromium-replay-output styr denna uppdelning **inte** B:s driver-val.

### `collect.elements[*]` — per-element-fält

| fält | klass | källa | not |
|---|---|---|---|
| `text` | **ren-DOM** | `el.innerText \|\| value \|\| aria-label` | `innerText` är render-känslig för whitespace-collapse men för synlig text byte-stabilt |
| `tagName` | **ren-DOM** | `el.tagName` (via `classifyTag`) | |
| `category` | **render-härlett** | `classifyCategory()` använder `rect.width/height` + `cs.backgroundColor`/`border` | `cta_primary`-poäng beror av `area >= 90*28` |
| `intent` | **ren-DOM** | `INTENT_RX` mot `text + data-*` attrs | `cta_primary`-fallback använder `rect.top` → render-känsligt på edge cases |
| `section` | **render-härlett** | `detectSection()` använder `rect.height` för cards-detektering + `docTop` för hero-cut-off | |
| `aboveFold` | **render-härlett** | `rect.top < window.innerHeight` | |
| `href` | **ren-DOM** | `getAttribute('href')` | |
| `disabled` | **ren-DOM** | `el.disabled \|\| aria-disabled` | |
| `yBand` | **render-härlett** | derived from `docTop = rect.top + scrollY`, bucketed | |
| `score` | **render-härlett** | `visualWeight` aggregation: area, fontSize, fontWeight, contrast | alla fyra ingångar är render-härledda |
| `bgContrast` | **render-härlett** | `effectiveBgRgb()` walks ancestor `getComputedStyle().backgroundColor` | exakt det fält som tidigare degenererade till `1` — jsdom kan inte reproducera |
| `area` | **render-härlett** | `rect.width * rect.height` | |
| `count` | ren-DOM (aggregat) | `elements.length` | |
| `target` | ren-DOM (konstant) | input-arg `"clickables"` | |
| `summary.topVisualWeight` | render-härlett | derived from `score` rankning | |

**Andel render-härlett per element:** 7/12 fält (~58%). De render-härledda
fälten är **scoring-relevanta** (`category`, `section`, `score`,
`bgContrast`, `area`, `aboveFold`) — inte instrumentation.

### `pageAudit.head` — meta/title/canonical

| fält | klass | källa |
|---|---|---|
| `title` | **ren-DOM** | `document.title` |
| `hasDescription` | **ren-DOM** | `meta[name="description"]` presence |
| `canonical` | **ren-DOM** | `link[rel="canonical"]` href |
| `lang` | **ren-DOM** | `documentElement.lang` |

100% ren-DOM som *extraktor-logik* — men i praktiken läst efter att Chromium
kört JS som kan ha muterat `<head>`.

### `pageAudit.headings`

| fält | klass | källa |
|---|---|---|
| `h1Count` | **ren-DOM** | `querySelectorAll('h1').length` |
| `h1` (text-array) | **ren-DOM** | `h1.textContent` |

### `pageAudit.hero`

| fält | klass | källa |
|---|---|---|
| `headline` | **render-härlett** | `deriveHero(sections, ctas)` läser sections som beror på `getBoundingClientRect` |
| `primaryCtaText` | **render-härlett** | hero-CTA väljs via above-fold-filter |
| `primaryCtaIntent` | ren-DOM (text-baserat) | givet att rätt CTA valts |
| `aboveFold` | **render-härlett** | per definition |

Beror via `sections` på `getBoundingClientRect`. Render-bunden.

### `pageAudit.images`

| fält | klass | källa |
|---|---|---|
| `total` | **ren-DOM** | `querySelectorAll('img').length` |
| `missingAlt` | **ren-DOM** | attribut-check |
| `modernCount` | **render-känsligt** | extension från `currentSrc` (resolved srcset, render-tid) |
| `legacyCount` | **render-känsligt** | samma |
| `formats` | **render-känsligt** | samma |

`currentSrc` kräver att browsern faktiskt resolvar `srcset` — jsdom har
ingen viewport och resolverar inte. Falls back till `src` ger
annorlunda klassning än Chromium.

### `pageAudit.trustSummary`, `trustEvidence`, `ctaSummary`

Räknar/sammanställer trust-signals och CTAs. Båda underliggande
extraktor-pass (`trustSignals.ts`, `ctas.ts`) använder `getBoundingClientRect`
för above-fold/synlighet → **render-härlett**.

| fält | klass |
|---|---|
| `trustSummary.total` | render-härlett (kräver above-fold-filter) |
| `trustSummary.aboveFold` | render-härlett |
| `trustSummary.byType` | render-härlett |
| `trustEvidence.rollup` | render-härlett |
| `ctaSummary.total` | render-härlett |
| `ctaSummary.primary` | render-härlett |
| `ctaSummary.aboveFold` | render-härlett |

### `pageAudit.sectionOrder`

| fält | klass | källa |
|---|---|---|
| `sectionOrder` (list) | **render-härlett** | `sections.ts` använder `getBoundingClientRect` för att bestämma vad som räknas som section |

---

## Rekommendation till Block B

1. **B är en headless-driver, inte ett jsdom-block.** Driver-klassificeringen
   ovan visar att hela `replayCorpus` är Chromium-bunden. Den tidigare
   B-DOM/B-render-uppdelningen är överflödig: det finns ingen meningsfull
   B-DOM-leverans som matchar committad golden.

2. **`scripts/extract-golden.ts` = `snapshot.test.ts`-flödet minus vitest,
   plus en alltid-skriv-gate.** Återanvänd `replayCorpus` + `normalizeCollect`
   + `normalizePageAudit` + `diffNormalized` oförändrat (SSOT).

3. **Score-determinism (kriterium #4) mäts mot replay-output**, inte mot en
   Node-extraktion. RED-risken sitter i de render-härledda scoring-fälten
   (`score`, `bgContrast`, `area`, `section`, `aboveFold`) — det är där
   tarpit och animation faktiskt kan slå igenom.

4. **Block C behöver en oberoende DOM-only-referens** (se risk-flaggan ovan)
   om freeze-pipelinen delar Chromium-driver med B, annars mäts
   capture-drivers med sin egen driver.

## Förbehåll

Driver-klassificeringen är läst ur `harness.server.ts`, `collect.ts`,
`pageAudit.server.ts` och `normalize.ts`. Den binära slutsatsen (B = headless)
vilar på att ingen golden-producerande logik körs utanför `page.evaluate`.
Om en framtida refaktor flyttar någon extraktor till Node-sidan (t.ex. en
ren MHTML-DOM-parse för `head`/`headings`) öppnas ett B-DOM-mellanläge igen —
men då måste committad golden re-baselineas mot den nya drivern, för den
nuvarande golden är Chromium-replay i sin helhet.
