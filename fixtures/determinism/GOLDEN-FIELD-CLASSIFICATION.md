# Golden.json Field Classification — Block B0 (plan v2)

> Spike-leverabel inför Block B (MHTML→golden-extractor-pass). Klassar varje
> fält i `corpus/hubspot/golden.json` som **ren-DOM** (härledd ur statisk
> DOM-struktur, byte-troget reproducerbart i Node + jsdom) eller
> **render-härlett** (kräver layoutmotor: `getBoundingClientRect`,
> `getComputedStyle`, resolverade `currentSrc`, etc.).

## Sammanfattning

| dimension | värde |
|---|---|
| Top-level keys | `collect`, `pageAudit` |
| Totalt klassade fält | ~50 (sammanslaget collect + pageAudit) |
| Ren-DOM | ~30 (60%) |
| Render-härlett | ~20 (40%) |

**Beslut för Block B:** B måste delas i **B-DOM** (Node/jsdom, deterministisk)
och **B-render** (headless Chromium, deterministisk endast om
layout-engine-version + viewport + fontuppsättning är pinnade). Andelen
render-härlett (~40%) inkluderar centrala salience-fält (`score`, `area`,
`yBand`, `bgContrast`, `aboveFold`, `section`) som inte kan reproduceras
byte-troget utan en riktig layoutmotor. Score-determinism (kriterium #4) är
alltså inte uppnåbar med enbart Node-extraktion.

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

**Implikation för Block B:** B kan inte bara wrappa live-extraktorn — det
finns ett "golden-projection"-steg någonstans (filtreringen sker innan
`golden.json` skrivs, eller golden är från en tidigare extractor-version).
Hitta projektionssteget innan B implementeras, annars matchar B aldrig
committad golden oavsett hur deterministisk den är.

`EXTRACTOR_VERSION` är `"1.0.0"` både i koden och har troligen varit det
hela tiden — versionssträngen bekräftar inte vilken side som projicerar.

---

## `collect.elements[*]` — per-element-fält

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

## `pageAudit.head` — meta/title/canonical

| fält | klass | källa |
|---|---|---|
| `title` | **ren-DOM** | `document.title` |
| `hasDescription` | **ren-DOM** | `meta[name="description"]` presence |
| `canonical` | **ren-DOM** | `link[rel="canonical"]` href |
| `lang` | **ren-DOM** | `documentElement.lang` |

100% ren-DOM. Säker B-DOM-kandidat.

## `pageAudit.headings`

| fält | klass | källa |
|---|---|---|
| `h1Count` | **ren-DOM** | `querySelectorAll('h1').length` |
| `h1` (text-array) | **ren-DOM** | `h1.textContent` |

100% ren-DOM.

## `pageAudit.hero`

| fält | klass | källa |
|---|---|---|
| `headline` | **render-härlett** | `deriveHero(sections, ctas)` läser sections som beror på `getBoundingClientRect` |
| `primaryCtaText` | **render-härlett** | hero-CTA väljs via above-fold-filter |
| `primaryCtaIntent` | ren-DOM (text-baserat) | givet att rätt CTA valts |
| `aboveFold` | **render-härlett** | per definition |

Beror via `sections` på `getBoundingClientRect`. Render-bunden.

## `pageAudit.images`

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

## `pageAudit.trustSummary`, `trustEvidence`, `ctaSummary`

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

## `pageAudit.sectionOrder`

| fält | klass | källa |
|---|---|---|
| `sectionOrder` (list) | **render-härlett** | `sections.ts` använder `getBoundingClientRect` för att bestämma vad som räknas som section |

---

## Rekommendation till Block B

1. **Lokalisera projektionssteget** som producerar slim golden från
   live-extraktorns rich output (möjligen i `corpus.functions.ts` eller en
   commit-script). Utan det matchar B aldrig committad golden.

2. **Dela B i två leveranser:**
   - **B-DOM:** Ren-DOM-fält (`head`, `headings.h1Count`/`h1`, `images.total`,
     `images.missingAlt`, `collect.count`, basic attribute-only collect-fält).
     Implementera i Node+jsdom; determinism-validera lokalt.
   - **B-render:** Render-härledda fält. Kräver headless Chromium + pinnad
     viewport (1440×900?) + pinnad font-uppsättning. Determinism-validering
     görs i Browserbase med fast Chromium-version.

3. **Score-determinism (kriterium #4) är endast meningsfullt mätbar för
   B-render-fält som faktiskt rör scoring.** Ren-DOM-fält är trivialt
   deterministiska. RED-risken sitter i B-render — det är där tarpit och
   animation faktiskt kan slå igenom.

4. **Block C (residual capture-drivers) kan inte gå GREEN enbart via B-DOM.**
   Tarpit och animation slår på render-fält (`section`, `score`,
   `aboveFold`-räkning, `sectionOrder`). C måste mäta båda drivers mot
   B-render output, inte B-DOM.

## Förbehåll

Den här klassningen är gjord från koden i `src/lib/tests/scripts/collect.ts`,
`pageAudit.ts` och `runners/pageAudit.server.ts` — inte från det faktiska
projektionssteget. Om projektionen släpper alla render-härledda fält blir
B-render onödigt och B reduceras till B-DOM. Det vore förvånande (då skulle
`score` i golden alltid vara konstant ~10 för alla links, vilket vi ser i
hubspot golden), men måste verifieras i Block B:s första leverans.
