# Plan v2: statisk + lokal-Playwright-smoke (med korrigeringar)

## Roten i punkt 1 — verifierad

Läste `src/lib/tests/scripts/collect.ts` rad 22–28. Collectorns synlighetsregler:

```
display !== 'none'
visibility !== 'hidden'
opacity > 0
rect.width >= 1 && rect.height >= 1
aria-hidden !== 'true'
+ traversering av shadowRoot via querySelectorAll-rekursion
```

Min nuvarande `measurePostDismissDomHits` har **två divergenser**:
- Lagt till `visibility === 'collapse'` (collectorn har inte → ofarligt, men onödigt)
- **Saknar `aria-hidden="true"`-checken** (collectorn har den → farligt: en banner med `aria-hidden` skulle smita förbi receiptet men plockas av collectorn, falskt självförtroende)
- Bbox: jag har `<= 0`, collectorn `< 1` (jag är 1px mer permissiv — ofarligt i praktiken, men avvikelse)

## Scope

Två saker före testet:
1. **Aligna `freeze.server.ts` med collectorn exakt.** Drop `collapse`, lägg till `aria-hidden`, byt bbox till `< 1`. Detta är den faktiska bug-fixen — testet bara låser den.
2. Kommentar i båda filer som pekar på varandra som kontrakt ("om du ändrar synlighetsreglerna här, ändra också i …, annars förlorar freeze-receipten sin prediktiva kraft mot golden").

Sen testet — som asserterar **överenskommelsen** mellan de två, inte en spec jag hittade på.

## Steg

### 1. Fixa divergenserna i `freeze.server.ts`

I `POST_DISMISS_HITS_EVALUATE` (efter att jag lyft ut den, se steg 2):
```js
function isVisible(el) {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  if (parseFloat(cs.opacity || '1') === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}
```

Cross-reference-kommentar i båda filer:
```ts
// SYNK-KONTRAKT: Synlighetsreglerna här MÅSTE matcha
// src/lib/tests/scripts/collect.ts::isVisible. Receiptets prediktiva kraft mot
// golden bygger på överenskommelsen. Tester i __tests__/freeze-visibility.test.ts
// låser den. Ändra båda samtidigt eller ändra ingen.
```

### 2. Lyft ut evaluaten till exporterad konstant

```ts
// freeze.server.ts
export const POST_DISMISS_HITS_EVALUATE = `(needles) => { /* ...isVisible + walk... */ }`;

async function measurePostDismissDomHits(page, needles) {
  return await page.evaluate(POST_DISMISS_HITS_EVALUATE, needles);
}
```

Pure refactor + bugg-alignment i samma diff. Runtime ändras (collapse bort, aria-hidden in) men det är avsiktlig korrigering.

### 3. Ny testfil — `src/lib/tests/snapshot/__tests__/freeze-visibility.test.ts`

Delad browser/context via `beforeAll`/`afterAll` (annars 30s overhead för 9 fall). `hits()`-helpern tar `page` från fixturen, inte en ny browser per anrop. Mönster lånat från `harness.server.ts`.

```ts
let browser: Browser, page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  page = await ctx.newPage();
});
afterAll(async () => { await browser.close(); });

async function hits(html: string, needles: string[]) {
  await page.setContent(html);
  return await page.evaluate(POST_DISMISS_HITS_EVALUATE, needles);
}
```

### 4. Fixturer som testar **överenskommelsen med collectorn**

Varje fall asserterar samma resultat som collectorn skulle ge. För att göra det inte spekulativt: två tester per regel — ett som körs mot `POST_DISMISS_HITS_EVALUATE`, ett som körs mot en mini-extraktor som bara inlinear collectorns `isVisible`-rader rakt av. Båda måste enas. Om någon framtida edit av endera sidan tappar synk → testet blir rött.

Implementations-skiss:
```ts
const COLLECTOR_RULES_EVALUATE = `
  (needles) => {
    // Inlinead spegling av collect.ts::isVisible. Om denna divergerar från
    // collect.ts::isVisible är det BUGGEN — fixa collect.ts först, sen denna.
    function isVisible(el) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity || '1') === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      return true;
    }
    // ... samma walk-logik ...
  }
`;

test.each(fixtures)("freeze and collector agree on %s", async ({ html, needles }) => {
  await page.setContent(html);
  const a = await page.evaluate(POST_DISMISS_HITS_EVALUATE, needles);
  const b = await page.evaluate(COLLECTOR_RULES_EVALUATE, needles);
  expect(a).toEqual(b);
});
```

Detta är hela poängen: testet säger *"de håller med varandra"*, inte *"opacity:0 → 0"*. Om collectorn ändras till att tillåta opacity:0 (av nån anledning) blir det här testet rött → påminnelse att uppdatera freeze också.

Fixturer:
| Fall | HTML |
|---|---|
| Synlig | `<div>Accept All</div>` |
| display:none | `<div style="display:none">Accept All</div>` |
| visibility:hidden | `<div style="visibility:hidden">Accept All</div>` |
| opacity:0 | `<div style="opacity:0">Accept All</div>` |
| Noll bbox | `<div style="width:0;height:0;overflow:hidden">Accept All</div>` |
| **aria-hidden** | `<div aria-hidden="true">Accept All</div>` (denna fångar div-buggen jag fixar i steg 1) |
| Shadow DOM (**imperativt skapad**, inte template-syntax) | se nedan |
| Footer-länk | `<a href="/cookies">Cookie Policy</a>` + needle `"cookie"` |
| Multi-hit | två synliga "Accept All" → count 2 |
| Same-origin iframe | dokumenterar nuvarande (sannolikt missar — låser beteendet, inte spekulativ fix) |

Shadow-DOM-fixturen byggs imperativt — som du påpekade, `setContent` aktiverar inte deklarativ shadow DOM pålitligt:
```ts
test("shadow DOM is traversed", async () => {
  await page.setContent("<body></body>");
  await page.evaluate(() => {
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).innerHTML = "<span>Accept All</span>";
  });
  const a = await page.evaluate(POST_DISMISS_HITS_EVALUATE, ["accept all"]);
  expect(a["accept all"]).toBe(1);
});
```

### 5. Needle-kontrakt — explicit

Funktionen lowercasar **haystack**, inte needles. Lägg ett test som dokumenterar det:
```ts
test("needles måste vara lowercase — blandad case matchar inte", async () => {
  const r = await hits(`<div>Accept All</div>`, ["Accept All"]); // STORE bokstäver
  expect(r["Accept All"]).toBe(0); // miss — kontraktet är "needles ska vara lc"
});
```
Plus motsvarande kommentar ovanför `POST_DISMISS_NEEDLES` i `freeze.server.ts`.

### 6. Importgraf-smoke — **med env-tömning**

```ts
test("freeze.server.ts läser inte env på modulnivå", async () => {
  const saved = process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_API_KEY;
  try {
    // Bust ESM-cachen, annars är detta no-op om någon test tidigare importerade.
    await import(`../freeze.server?bust=${Date.now()}`);
  } finally {
    if (saved !== undefined) process.env.BROWSERBASE_API_KEY = saved;
  }
});
```

Cache-bust:en behövs annars är testet trivialt på en utvecklarmaskin där modulen redan importerats av annan test i samma vitest-process.

### 7. `tsc --noEmit` som explicit kommando

I `package.json`-scripts om det inte redan finns: `"typecheck": "tsc --noEmit"`. Kör det manuellt efter steg 1–6. Sandbox-bygget gör det redan, men explicit körning ger ren signal isolerat från snapshot-testet.

## Vad denna plan inte gör

- Testar inte `finally`-flushen — kräver mycket Stagehand-mock för låg signal, hör hemma i #2.
- Testar inte `waitForSelector`-timeouts — verklig banner-injektion, #2.
- Fixar inte iframe-traversering — låser nuvarande beteende (sannolikt miss). Spekulativ fix nu = scope creep.
- Refaktorerar inte `COLLECT_SCRIPT` för att dela `isVisible` som verklig konstant. Den är en stringified IIFE i `collect.ts`; att bryta ut betyder att linka två stringified-fragment, och risken att jag bryter collectorn är högre än värdet. Cross-reference-kommentar + test-as-contract är den pragmatiska kompromissen.

## Decision points

- **Om collectorn någon gång divergerar från freeze (medvetet eller olyckligt):** testet blir rött. Default-läsning bör vara "collectorn är sanningen, fixa freeze". Skrivs som kommentar i testfilen så framtida läsare vet riktningen att fixa.
- **Aria-hidden-fixen i `freeze.server.ts` är runtime-beteendeändring, inte bara refactor.** Värt att nämna i commit-meddelandet. Konsekvens: någon site med `aria-hidden="true"` på banner-text efter dismiss skulle tidigare gett `postDismissDomHits["accept all"] > 0` (falskt positivt i receiptet) — nu ger den 0, vilket matchar att collectorn också skulle ignorera det. Förändringen gör receiptet mer korrekt, inte mindre.
