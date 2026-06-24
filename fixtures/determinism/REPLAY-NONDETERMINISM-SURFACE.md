# REPLAY-NONDETERMINISM-SURFACE.md

Kartläggning av nondeterminism-källor i `replayCorpus(name)` (`src/lib/tests/snapshot/harness.server.ts`) och dess fyra konsumenter. Detta är timing-/font-load-/runtime-axeln, INTE layout-/kollaps-axeln (den ligger i `NORMALIZE-COLLAPSE-SET.md`). Block B implementerar pinningen mot denna karta; Block D delar capture-sidans pinning där så indikeras.

## Konsumenter av `replayCorpus`

1. `snapshot.test` — `src/lib/tests/snapshot/__tests__/snapshot.test.ts`
2. `render-canary` — `scripts/render-canary.ts` (+ `render-canary.server.ts`, `render-canary-receipt.ts`)
3. `breadth-replay` — `scripts/breadth-replay.ts`
4. `breadth-smoke` — `scripts/breadth-smoke.ts`

## Hypotes-formulering

För varje icke-`invariant` impact-cell: *"om pinning av denna källa ändrar output, då invaliderar pinningen den artefakt som anges"*. Hypotesen verifieras empiriskt av Block B när pinningen implementeras — den är inte fakta utan ramning som styr mätning. Celler markerade `unknown — needs measurement` är medvetet ofyllda till dess data finns.

## Yta

| Källa | Hanterad idag? | Manifestation i golden-fält | Pin-strategi om nej | Impact: snapshot.test | Impact: render-canary | Impact: breadth-replay | Impact: breadth-smoke | Delad med Block D capture-sida? |
|---|---|---|---|---|---|---|---|---|
| **Viewport-dimensioner** (width × height × devicePixelRatio) | partial — sätts i `harness.server.ts` men värdet ej låst i kontrakt | px-baserad geometri: `area`, `score` (via area), `bgContrast`, `aboveFold`, `yBand`-tilldelning | Lås viewport till explicit värde i Chromium `launch`/`newContext` (förslag: 1280×800, DPR=1); dokumentera i `B-CONTRACT.md` sektion 4 | unknown — needs measurement | `invalidates: canary-receipt Gate 2 (font-widths)` om DPR ändras | `invalidates: breadth-corpus sha256` om viewport ändras | `invalidates: breadth-smoke artifacts` | **ja** — capture måste använda samma viewport, annars MHTML-geometri ≠ replay-geometri |
| **CSS-animationer mid-frame** (`animation:mid-frame-transform`) | nej | Indirekt via `rect.y` → `yBand` straddle om amplitud >100px; annars osynlig (se NORMALIZE-COLLAPSE-SET anmärkning) | `page.addStyleTag({content: '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }'})` efter load | `invariant` (i normalfallet, kvantas bort) — men `invalidates: golden.json` vid straddle | `invalidates: canary-receipt` om sampling råkar fånga rotation-frame | `invalidates: breadth-corpus sha256` om animering ändrar någon mätt geometri | `invalidates: breadth-smoke` (samma) | **ja** — capture-MHTML kan ha frusen mid-frame; pinningen måste matcha |
| **`document.fonts.ready` await** | **ja — canary Gate 1** (`canary-constants.ts` + `render-canary.server.ts`) | Font-metrik-skifte ändrar `area`/`score`, `topVisualWeight` ordering | **B återanvänder canary Gate 1 await-punkten — ingen parallell `fonts.ready`-impl.** | `invalidates: golden.json` vid race | `invariant` (är pin-punkten själv) | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** — capture måste vänta på samma signal innan MHTML-snapshot |
| **Font-load-race** (canary-bredder före vs efter web-font-applicering) | partial — canary Gate 2 mäter, men löser inte race | `topVisualWeight`-ordering, `score` via text-bredd-area | Förlita på font-settle-pinning (raden ovan); canary Gate 2 är detektion, inte mitigation | `invalidates: golden.json` om Gate 1 race kvarstår | är detektor-mekanismen | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** — capture lider av samma race |
| **`Date.now()` / `new Date()`** i sid-JS | nej (förlitar sig på radering i `normalizePageAudit.auditedAt`) | `auditedAt` raderas → osynlig. Men sid-JS som renderar "uppdaterad för X minuter sedan" påverkar `text` på element. | `page.addInitScript` som freezar `Date.now` till fix tidpunkt | `invalidates: golden.json` om sidan har tids-stämpel-text | `invariant` (canary läser ej tidstext) | `invalidates: breadth-corpus sha256` om någon sajt har tidstext | `invalidates: breadth-smoke` (samma) | **ja** — capture måste freeza samma tidpunkt |
| **`Math.random()`** i sid-JS | nej | Random-vald hero-variant, A/B-bucket, karusell-startindex | `page.addInitScript` med seedad PRNG som ersätter `Math.random` | `invalidates: golden.json` vid A/B-rendering | `invalidates: canary-receipt` (font-canary text kan flippa om sajten random:ar) | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** — capture måste seedas likadant |
| **`requestAnimationFrame` timing** | nej | Element som mountas på rAF-cykel kan ha olika `rect` vid mätpunkt | Vänta på N stabila rAF-frames innan collect; eller pinna `requestAnimationFrame` till syncrona ticks | `invalidates: golden.json` om rAF-mount ändrar geometri | `invariant` (canary mäter efter load) | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** |
| **IntersectionObserver thresholds** | nej | `aboveFold`-beräkning beroende på scroll-position vid observer-fire | Scrolla deterministiskt till topp + vänta IO-flush; eller polyfill IO synkront | `invalidates: golden.json` (`aboveFold`-flipp) | `invariant` (canary scrollar ej) | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** |
| **Lazy-load på viewport-events** | nej | `images.total`, `images.modernCount`, element som dyker upp vid scroll | Force-load alla `loading="lazy"`-bilder via `page.evaluate` före collect; eller scrolla genom hela sidan + vänta | `invalidates: golden.json` (image-counts, ev. nya elements) | `invariant` om canary inte mäter images | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** |
| **Karusell/auto-rotation** | partial — `normTrustDebug` raderar entries-text default | `text` på roterande hero/widget element flippar mellan körningar | Pinna animation-play-state (täcker även CSS-baserad rotation); för JS-driven rotation, freeza relevant timer | `invariant` (täcks av trustDebug-radering) men `invalidates: golden.json` om karusell-element är hero | `invalidates: canary-receipt` om hero-text flippar | `invalidates: breadth-corpus sha256` | `invalidates: breadth-smoke` | **ja** — capture frusen vid en frame, replay vid en annan |
| **Server-svar Date/ETag-rotation** | ja — `normalizePageAudit` raderar `httpHeaders` | `httpHeaders` raderas | (radering räcker för golden; capture-MHTML kan ha rotation, hanteras av WHITELIST.md) | `invariant` | `invariant` | `invariant` | `invariant` | hanteras separat i WHITELIST |
| **Nätverks-jitter** (CDN-edge, response-order) | nej (förlitar sig på MHTML-cache i capture, men replay laddar live?) | Resource-load-ordning kan påverka render-ordning → element-ordning (men kollapsas av `elementKey`-sort) | Servera via lokal MHTML-replay (om inte redan); verifiera `harness.server.ts` route-mock | `invariant` (kollapsas) | `invalidates: canary-receipt` om font-CDN flippar | `invalidates: breadth-corpus sha256` om innehåll skiljer mellan branches | `invalidates: breadth-smoke` | **ja** |

## Vad denna karta INTE besvarar

- Vilken pin som faktiskt är implementerad i `harness.server.ts` idag — kräver källäsning vid B-implementations-start.
- Om någon pin-strategi i sig introducerar nondeterminism (t.ex. seedad PRNG som inte är stabil mellan Chromium-versioner).
- Empirisk verifiering av hypotes-cellerna — Block B mäter `invariant`-claims med 2×N=3 + golden-diff och uppdaterar tabellen.
- Pin-implementations-kod — denna fil är karta, inte implementation.
