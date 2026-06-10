# Render-canary: verifiera att inbäddade cid:-fonter rendrar i replay

## Mål
Gate före Fas 2 (subsetting). Innan vi rör en enda glyf måste vi bevisa att de cid:-inbäddade fontfilerna faktiskt:
1. Resolvar i Chromium under file:// MHTML-replay (inga 0-loaded familjer).
2. Används av layout (text-bredder ≠ fallback-bredder för representativ text).

Annars riskerar Fas 2 timmar på en subsetter vars output replay aldrig renderar — och guldarna ser oförändrade ut för att de redan kör fallback-fonter, inte de inbäddade.

Det räcker INTE med `document.fonts.size > 0` (loggas redan i harness.server.ts). En FontFace kan vara `loaded` utan att någon faktiskt glyf hämtas, och en familj kan vara registrerad utan att layout använder den. Vi behöver båda signalerna.

## Leverabler

### 1. `src/lib/tests/snapshot/render-canary.server.ts` (ny)
Ren funktion `runRenderCanary(page, expectedFamilies)` som körs **inne i replayCorpus** efter `document.fonts.ready` men före `nodeLoopScroll`. Returnerar:

```ts
interface RenderCanaryReport {
  ok: boolean;
  families: Array<{
    family: string;          // namn från @font-face declaration
    registered: boolean;     // finns i document.fonts
    loadedCount: number;     // FontFace.status === 'loaded' för familjen
    totalCount: number;
    fontsCheckPass: boolean; // document.fonts.check('16px "F"', sample)
    widthVsFallback: {
      embedded: number;
      fallback: number;      // samma text i 'monospace' eller 'serif'
      distinct: boolean;     // |diff| > 0.5 px
    };
    sampleText: string;
  }>;
  missing: string[];         // familjer vi förväntade men inte hittade
  unusedRegistered: string[];// registrerade men widthVsFallback.distinct=false
  failures: string[];        // människo-läsbara orsaker när ok=false
}
```

Mätmetod per familj (allt körs som ett kort `page.evaluate`):
- `document.fonts.check('16px "Family"', sample)` — false ⇒ glyfer saknas för texten.
- Mät bredd: skapa offscreen `<span>` med `font: 16px "Family", monospace` resp. `font: 16px monospace`. Diff > 0.5 px ⇒ familjen påverkar layout. Identisk bredd ⇒ Chromium ramlade tillbaka på monospace tyst.
- `sample` per familj: ta första synliga textnoden i DOM som faktiskt har den `font-family` på sig (via `getComputedStyle`). Fallback `"The quick brown fox 0123"` om ingen träffas.

### 2. `extractEmbeddedFamilies(mhtml)` i `src/lib/tests/snapshot/mhtml-fonts.server.ts`
Parsea `@font-face { font-family: "X" }` ur de redan-decoded CSS-parts:erna och returnera unika namn. Skrivs till `freeze-report.json::capture.embeddedFamilies` av `freeze.server.ts` så replay vet vad den ska förvänta sig utan att re-parsa MHTML.

### 3. `replayCorpus` integration (`harness.server.ts`)
Efter font-probe-logget, kör:
```ts
const expected = report?.capture?.embeddedFamilies ?? [];
const canary = await runRenderCanary(page, expected);
if (!canary.ok) throw new Error(`[replay] render canary failed for ${name}: ${canary.failures.join('; ')}`);
```
- Sätt fail-villkor: `missing.length > 0` ELLER någon family där både `fontsCheckPass=false` OCH `widthVsFallback.distinct=false`. Registrerad-men-oanvänd loggas (precis det subsetting ska beskära) men gate:ar inte — annars dödar canary HubSpot/HiBob där över-embed är förväntad.
- Skriv hela rapporten till `corpus/<name>/render-canary.json` (gitignored — det är diagnostik per replay-körning, inte golden).

### 4. `scripts/render-canary.ts` (ny CLI)
`bun run scripts/render-canary.ts [--name=hibob|--all]`. Kör replay för en eller alla siter i `SITES`, skriver en sammanfattnings-tabell till stdout, exit 1 om någon site fail:ar.

## Gate-policy
- **Måste passera** för HiBob och HubSpot (de in-repo siter som faktiskt har embedded fonts) innan Fas 2 startar.
- Resultatet sparas INTE som golden. Det är en runtime-assert. Goldens berör layoutmetrik som redan beror på fonterna; canary verifierar att den beroendekedjan faktiskt är aktiv.

## Vad som inte ingår
- Pixelvis screenshot-diff (overkill för en gate — bredd-diff räcker för "fontens faktiskt levererad").
- Ändringar i `embedMhtmlFonts` rewrite-logiken.
- Subsetting-kod (Fas 2).
- Slack/Kry-aktivering (de väntar tills Fas 2-frågan är avgjord per förra beslutet).

## Risker / kanter
- **Samma metrics som golden** — om font-bredd är samma signal som collect/pageAudit redan mäter, så är canary teoretiskt redundant. Skillnaden: golden mäter mot en frusen baseline (kan ha bakats med fel font från start och vara grön ändå); canary mäter mot en *intentional fallback* (monospace) live varje körning. Det fångar precis "vi har tappat alla custom fonter sedan baselinen" som golden inte fångar.
- **Pinned chromium-bredd-precision**: 0.5 px tröskel valt med marginal mot subpixel-rundning. Höjs/sänks vid behov; loggas alltid i rapporten.
- **Familjenamn-citering i CSS** (`"Family Name"` vs `Family\ Name` vs okvoterat): parsern måste normalisera. Existerande `@font-face`-regex i `mhtml-fonts.server.ts` är url-fokuserad — behöver en separat familje-parser. Liten yta, testas i en `__tests__/extract-families.test.ts`.

## Ordning
1. `extractEmbeddedFamilies` + unit-test.
2. `runRenderCanary` + integration i `replayCorpus`.
3. `scripts/render-canary.ts`.
4. Kör mot HiBob + HubSpot. Förväntat: båda passerar (de har redan fungerande embed enligt nuvarande goldens). Om någon fail:ar — det är precis signalen vi byggde verktyget för; fixa innan Fas 2.
5. Beslut Fas 2 baseras på canary-rapporten: `unusedRegistered` listan är exakt prune-kandidaterna för B1.
