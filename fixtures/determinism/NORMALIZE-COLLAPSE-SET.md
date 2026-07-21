# NORMALIZE-COLLAPSE-SET.md

Enumerering av varje kollapsregel i `src/lib/tests/snapshot/normalize.ts` (golden-lagret) och vilken mekanism varje regel gör osynlig för golden-diff. Mirror till `WHITELIST.md` (MHTML-lagret), men diff-formen är JSON-objekt via `diffNormalized`, inte rad-för-rad text.

## Granskningslins

Ett "grönt" golden-diff (tom output från `diffNormalized`) kan komma från tre källor:

1. **Sann determinism** — verklig kod producerade samma output.
2. **Radering** — kollapsregeln dolde fältet helt; mekanismens variation kan aldrig synas.
3. **Kvantisering som råkar runda lika** — verkligt värde varierar, men varje körnings värde rundade till samma steg. Två sub-fall:
   - **(a) sub-kvant-drift osynlig** — variation < stegstorlek, garanterat dolt.
   - **(b) dold boundary-straddle** — variation spänner gräns, N=3 råkar landa på samma sida → byte-identisk tmp → **falsk-GREEN** → committad golden som flippar senare körningar.

Vakter mot (b): `B-CONTRACT.md` sektion 3 (2×N=3 default), C-fasens N≥3-per-gren.

**Stående granskningsfråga vid varje framtida kollapsregel:** *vilken mekanism i `MECHANISM-INVENTORY.md` blir osynlig av denna regel, och är det avsiktligt?*

## Steg 0 — kvittering mot källan

Kvitterat 2026-06-24 mot `src/lib/tests/snapshot/normalize.ts`:

| Förväntad konstant/regel | Faktisk plats | Status |
|---|---|---|
| `yBand` step = 200 | `normElement`, rad 51 | ✓ |
| `score` step = 10 | `normElement`, rad 52 + `topVisualWeight`, rad 95 | ✓ |
| `salience` step = 0.2 | `normElement`, rad 53 | ✓ |
| `bgContrast` step = 1 | `normElement`, rad 54 | ✓ |
| `area` = sig1 | `normElement`, rad 55 + `sig1`, rad 17 | ✓ |
| `hostOnly(href)` | rad 48 + 59 | ✓ |
| `COOKIE_BANNER_RX` | rad 28–29 | ✓ (8 fraser: accept/decline/reject/allow/deny all, manage cookies, cookie settings/preferences, consent preferences) |
| `normTrustDebug` default `entries:false` | rad 133 (`opts.keepTrustEntries === true`) + rad 166 | ✓ |
| `normalizePageAudit` drops `auditedAt`, `httpHeaders`, section-rects | kommentar rad 140 (fält saknas i return) | ✓ |
| `description` → `hasDescription` | rad 108 | ✓ |
| `elementKey` sort = `section/category/intent/yBand/text` | rad 68–70, 75 | ✓ |
| `normElement` drops selector/attributes/computedStyles/rect (utom yBand) | rad 39–57 (inget av dessa fält i return) | ✓ |
| title/h1/hero trim | rad 114, 117, 118 | ✓ |

Inga avvikelser. Inga oväntade extra regler. Skrivning fortsatte.

## Kollapsregeluppsättning

**Format:** en rad per raderingsregel. Kvantregler får **två rader** med sufix `(a)`/`(b)` i regel-kolumnen — separata blindfläck-rader för sub-kvant-drift och dold boundary-straddle.

| Regel (kod-symbol) | Vad raderas/kvantas | Typ | Blindfläck för B | Blindfläck för C | Konsument-impact (golden-fält) | Inventerings-referens |
|---|---|---|---|---|---|---|
| `isCookieBannerElement` / `COOKIE_BANNER_RX` (8-fras-lista) | Element med matchande text filtreras bort från `collect.elements`, `summary.topVisualWeight`, `summary.total` (via filtrerad `count`) | Radering | Cookie-banner CTA-flipp (kategori, intent, fold) osynlig. Element som matchar en fras av legitima skäl (t.ex. "manage cookies" i policy-länk) försvinner från elementlistan. | Cookie-banner-rendering-skillnad mellan branches osynlig. | `collect.elements[*]`, `collect.count`, `collect.summary.topVisualWeight`, `collect.summary.total` | `cookie-banner:async-dismiss` |
| `normElement` drop: `selector`, `attributes`, `computedStyles`, full `rect` | Endast `text/tagName/category/intent/section/aboveFold/href→host/disabled/yBand/score/salience/bgContrast/area` behålls | Radering | Selector-stabilitet (swiper-id, react-key) osynlig. Inline-style `transform` (mid-frame translate) osynlig — element-position via `rect.x/y` ersatt med `yBand` only. CSS-klass-byten osynliga. Attributförändringar (`data-*`, `aria-*`) osynliga. | Selector-divergens mellan capture-runs osynlig. | `collect.elements[*]` (drop) | `animation:mid-frame-transform` (för transform-delen), `widget:async-mount` (för selector-delen) |
| `normElement` `href` → `hostOnly(href)` | Path, query, fragment, port stripas; bara host kvar | Radering | URL-parameter-drift (utm, sessions-id, lokal-suffix) osynlig. Path-flippar (`/sv/` ↔ `/en/`) osynliga. | Tracking-param-skillnader mellan branches osynliga. | `collect.elements[*].href` | `tracking:url-params` |
| `normElement` `yBand = round(rect.y, 200)` (a) | y-koordinat kvantas till 200px-band | Kvantisering — sub-kvant-drift osynlig | Element som rör sig <200px mellan körningar har **garanterat ingen diff** — lazy-load/font-shift som drar element 50–150px ner förblir osynligt. | C ser ingen layout-drift inom band. | `collect.elements[*].yBand` | `layout:lazy-image-shift`, `font:fallback-shift` |
| `normElement` `yBand = round(rect.y, 200)` (b) | y-koordinat kvantas till 200px-band | Kvantisering — dold boundary-straddle | Element som ligger nära band-gräns (t.ex. rect.y ≈ 100 eller ≈ 300): tre körningar råkar runda lika → byte-identisk tmp → **falsk-GREEN** → golden committad med yBand som flippar i senare körning. | Samma straddle kan flippa elementKey-sortering (yBand är del av nyckeln) → hel array omflippar position i diff. | `collect.elements[*].yBand`, `collect.elements[*]` (ordning via elementKey) | `layout:lazy-image-shift`, `font:fallback-shift` |
| `normElement` `score = round(vw.score, 10)` (a) | Visual-weight-score kvantas till 10-steg | Kvantisering — sub-kvant-drift osynlig | Score-drift <10 osynlig (font-metrik, antialiasing). | C ser ingen viktnings-drift inom kvant. | `collect.elements[*].score`, `collect.summary.topVisualWeight[*].score` | `font:fallback-shift`, `layout:lazy-image-shift` |
| `normElement` `score = round(vw.score, 10)` (b) | Visual-weight-score kvantas till 10-steg | Kvantisering — dold boundary-straddle | Score nära gräns (35→40, 65→70): N=3 råkar runda lika → falsk-GREEN → committad golden flippar senare. | Score-flipp kan ändra `topVisualWeight`-ordning → hela ranked-listan flippar. | `collect.elements[*].score`, `collect.summary.topVisualWeight` | `font:fallback-shift`, `layout:lazy-image-shift` |
| `normElement` `salience = round(vw.salience, 0.2)` (a) | Salience kvantas till 0.2-steg | Kvantisering — sub-kvant-drift osynlig | Salience-drift <0.2 osynlig. | C ser ingen salience-drift inom kvant. | `collect.elements[*].salience` | `font:fallback-shift` |
| `normElement` `salience = round(vw.salience, 0.2)` (b) | Salience kvantas till 0.2-steg | Kvantisering — dold boundary-straddle | Salience nära gräns: N=3 lyckas runda lika → falsk-GREEN. | (samma som B) | `collect.elements[*].salience` | `font:fallback-shift` |
| `normElement` `bgContrast = round(vw.backgroundContrast, 1)` (a) | Kontrast kvantas till heltal | Kvantisering — sub-kvant-drift osynlig | Kontrast-drift <1 osynlig (antialiasing-jitter). | C ser ingen kontrast-drift inom kvant. | `collect.elements[*].bgContrast` | `image:lazy-bg-load` |
| `normElement` `bgContrast = round(vw.backgroundContrast, 1)` (b) | Kontrast kvantas till heltal | Kvantisering — dold boundary-straddle | Kontrast nära heltal-gräns (4.4→5, 4.6→5): N=3 runda lika → falsk-GREEN. | (samma som B) | `collect.elements[*].bgContrast` | `image:lazy-bg-load` |
| `normElement` `area = sig1(vw.area)` (a) | Area till 1 signifikant siffra | Kvantisering — sub-kvant-drift osynlig | Area-drift inom samma magnitud-rundning osynlig. | C ser ingen area-drift inom kvant. | `collect.elements[*].area` | `layout:lazy-image-shift`, `viewport:reflow` |
| `normElement` `area = sig1(vw.area)` (b) | Area till 1 signifikant siffra | Kvantisering — dold boundary-straddle | Area nära magnitud-gräns (4500→5000 vs 4499→4000): N=3 runda lika → falsk-GREEN. Eftersom area är input till `score` finns risk för kaskad-straddle. | Kaskad via score → topVisualWeight-ordning. | `collect.elements[*].area`, indirekt `score` | `layout:lazy-image-shift`, `viewport:reflow` |
| `elementKey` sort på `section/category/intent/yBand/text` | Array-ordning ersätts med deterministisk sortering | Radering | Render-ordning-drift osynlig (DOM-mount-order, IntersectionObserver-thresholds). | Drift i element-emission-ordning osynlig. | `collect.elements` (ordning) | `widget:async-mount`, `observer:intersection-threshold` |
| `normTrustDebug` default `entries: false` | Endast `rollup: {stage/decision/reason → count}` behålls; per-entry text/matchedText dolt | Radering | Karusell-rotation som ändrar `text` per körning osynlig. Specifik element-matching osynlig — bara aggregerad count syns. | C ser inte vilka konkreta element som trust-bedömdes. | `pageAudit.trustEvidence.entries` (drop) | `carousel:rotation`, `widget:async-mount` |
| `normalizePageAudit` drops `auditedAt` | Timestamp tas bort | Radering | Tid-baserad flapp osynlig (avsiktligt). | (samma) | `pageAudit.auditedAt` (drop) | — (önskvärd radering) |
| `normalizePageAudit` drops `httpHeaders` | Response-headers tas bort | Radering | Server-respons-drift osynlig (Date, ETag, Set-Cookie-rotation). | C ser inte header-divergens mellan branches. | `pageAudit.httpHeaders` (drop) | `server:header-rotation` |
| `normalizePageAudit` drops section-rects (`a.sections` ej i return) | Per-sektion px-geometri raderas | Radering | Sektions-höjd-drift osynlig. Sektions-omordning osynlig (utöver `sectionOrder` som listar namn). | C ser inte sektions-geometri-flapp. | `pageAudit.sections[*].rect` (drop) | `layout:lazy-image-shift`, `viewport:reflow` |
| `normalizePageAudit` `description` → `hasDescription` (boolean) | Meta-description-text raderas, bara existens behålls | Radering | Text-ändringar i meta-description osynliga. A/B-test på description osynligt. | (samma) | `pageAudit.head.description` (text→bool) | `seo:meta-rotation` |
| `normalizePageAudit` title/h1/hero `.trim()` | Leading/trailing whitespace stripas | Radering | Whitespace-drift osynlig (CMS-render-jitter). | (samma) | `pageAudit.head.title`, `pageAudit.headings.h1[*]`, `pageAudit.hero.headline`, `pageAudit.hero.primaryCtaText` | — (önskvärd radering) |
| `topVisualWeight` filtrering via `COOKIE_BANNER_RX` | Cookie-banner-CTA tas bort från topp-listan | Radering | (samma som första raden, applicerat på topp-listan separat) | (samma) | `collect.summary.topVisualWeight[*]` | `cookie-banner:async-dismiss` |

## Anmärkning om animation-transform

`normElement` raderar `attributes`, `computedStyles` och full `rect` (utom `yBand`). Det betyder att inline-`transform: translateY(-Npx)` på hero-element (`animation:mid-frame-transform` i `MECHANISM-INVENTORY.md`) **inte har någon direkt yta** i golden-output — varken som style-värde eller som translaterad rect. Indirekt kan transform påverka `rect.y` som matas till `yBand` → då fångas det av boundary-straddle-raden för `yBand (b)` om transform-amplituden flyttar elementet över ett 200-px-band, annars är det osynligt. Ingen explicit anti-animation-kollaps existerar idag; det är emergent från drop-policyn på `attributes`/`computedStyles`.

Detta är medvetet listat så att framtida granskning kan ta beslut om att antingen (i) tillåta sample-during-animation som accepterad blindfläck, eller (ii) lägga in en pin på `animation-play-state: paused` i `replayCorpus` (då blir raden i `REPLAY-NONDETERMINISM-SURFACE.md` `handled`).
