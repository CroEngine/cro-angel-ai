# Fix settle-helpern: bättre signal, lägre budget, snabbare bailout

Settle gör rätt sak men på fel sätt — den mäter brus istället för struktur, och tar +12s per körning vilket gör live-DOM-vyn dödfryst. Den arkitektoniska idén (global settle före extraktion) står kvar; ändringarna är finjustering av helperns interna logik.

## Ändringar i `src/lib/tests/runners/settle.server.ts`

**1. Byt stabilitetssignatur.**

Nuvarande: `document.body.children.length + ':' + document.querySelectorAll('*').length`.
Ny: `document.body.scrollHeight + ':' + document.body.children.length + ':' + document.querySelectorAll('main, section, header, footer, [data-section], [role="main"]').length`.

Rationale: vi bryr oss om att layouten har slutat växa (`scrollHeight`) och att top-level sektioner är mountade (`body.children.length` + strukturella element). Vi bryr oss INTE om att analytics-skript injicerar `<script>`-noder djupt i DOM:en, eller att en autoplay-video swappar `<source>`-element. Den nya signalen ignorerar exakt den klass av mutationer som blockerade oss på HiBob.

**2. Sänk total budget 6000ms → 3000ms.**

Det räcker för 95% av sidor i praktiken. Om någon sida behöver mer löser vi det situations-specifikt senare (t.ex. Fix 4-fixturen).

**3. Sänk networkidle-budget 3000ms → 1200ms.**

Vi vet redan att autoplay-sites aldrig blir networkidle. Slösa inte 3s på att hoppas.

**4. Bail-fast på första matchande signatur.**

Idag kräver `i > 0`-villkoret minst två iterationer (1500ms minimum för en stilla sida). Ny logik: mät direkt + igen efter 350ms; om identiska, returnera. Stilla sidor settlear då på ~400ms istället för 1500ms.

**5. Skippa readyState-pollen om networkidle redan lyckades.**

Redundant — networkidle implicerar readyState=complete.

## Förväntad effekt på HiBob /sv

Före: `budget exhausted in 6843ms`.
Efter: ~1200ms networkidle-timeout (skippas), ~350ms stability check (passar pga ny signal), total ~1500ms. Cirka **4× snabbare**.

På stilla sidor (de flesta SaaS-landningar utan video): total ~400ms.

## Vad jag INTE ändrar

- Anropsplatser i `engine.server.ts` och `pageAudit.server.ts` — de står still.
- Returshape (`{ settled, reason, durationMs }`).
- Cookie-banner-pollen i pageAudit (oberoende, redan budgeterad).
- Mobile-passet — använder samma helper, får samma vinst automatiskt.

## Verifiering

1. Kör hibob.com/se/ en gång. Förvänta: `settle: dom-stable (net busy) in ~1500ms` i loggarna istället för 6843ms.
2. Live-DOM-vyn bör inte längre kännas frusen.
3. ctaTotalCount och övriga datapoints ska komma fram som vanligt.
4. Om datapoints fortfarande är 0 — då är problemet *inte* settle, och vi måste titta på faktiska `step_failed`-events från SSE-strömmen.

## Öppen fråga (vill svaras innan brusgolv-körningen)

Brusgolv-scriptet (Fix 0b) är skrivet men inte wired in. Vill du:
- **A:** Att jag wirear en `/api/dev/noise-floor`-endpoint som returnerar JSON-rapporten? (kräver att jag exponerar en route med session-create-callback.)
- **B:** Att jag bakar in det i ett befintligt test-flöde (t.ex. som ett N=5-läge på run.functions.ts)?
- **C:** Skippa wiring nu — settle-fixen verifieras manuellt genom att köra hibob.com/se/ ett par gånger och jämföra `settle: <reason> in <ms>`-loggarna.

Default om du inte säger något: **C** (snabbast, minst yta).
