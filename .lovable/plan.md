## Mål
Lägg till WCAG-kontrast på CTAs och visualHierarchy + aggregat i `pageSummary`. Ingen ny browserdata behövs.

## Upptäckter
1. `CTAEntity` har **inte** `computedStyles` idag → vi beräknar kontrast inuti `ctas.ts` browser-scriptet där `cs = getComputedStyle(el)` redan finns.
2. `VisualHierarchyEntry.contrast` **är redan** WCAG-kontrastkvot (samma formel som planeras). Bara `wcagLevel` ska härledas.

## Plan

### 1. `src/lib/tests/scripts/ctas.ts`
- Kopiera in `parseRgb`/`relLum`/`contrast`-helpers (self-contained krav).
- I huvudloopen där `cs` finns: beräkna `contrastRatio` (null om bg är transparent/rgba(…,0)) och härled `wcagLevel` baserat på fontSize/fontWeight (large text = ≥18px eller ≥14px bold).
- Lägg till `contrastRatio: number | null` och `wcagLevel` i output.

### 2. `src/lib/tests/scripts/visualHierarchy.ts`
- Använd befintliga `s.con`, `s.fontSize`, `s.fontWeight` för att härleda `wcagLevel`. Lägg till i output.

### 3. `src/lib/tests/schema.ts`
- `CTAEntity`: lägg till `contrastRatio: number | null`, `wcagLevel: 'AAA'|'AA'|'AA-large'|'FAIL'|null`.
- `VisualHierarchyEntry`: lägg till `wcagLevel: 'AAA'|'AA'|'AA-large'|'FAIL'|null`.
- `PageSummary`: lägg till `ctaContrastFailCount: number`, `ctaContrastAvg: number | null`.

### 4. `src/lib/tests/audit-helpers.ts` (`buildPageSummary`)
Aggregat med **null-filtrering** (per användarens not):
```ts
const withContrast = ctas.filter(c => c.contrastRatio !== null);
const ctaContrastAvg = withContrast.length > 0
  ? Math.round((withContrast.reduce((s, c) => s + (c.contrastRatio as number), 0) / withContrast.length) * 100) / 100
  : null;
const ctaContrastFailCount = ctas.filter(c => c.wcagLevel === 'FAIL').length;
```
Notera i kommentar att `ux_multiple_ctas_low_contrast` framöver ska använda `withContrast.length` som nämnare, inte `ctas.length`, så ghost-knappar (null) inte snedvrider procenten.

## Edge cases
- Transparent bakgrund (`rgba(0,0,0,0)` / `transparent`) → `contrastRatio = null`, `wcagLevel = null`. Vanligt på sekundära/ghost CTAs.
- Ikon-knappar utan text: kontrast beräknas men har lägre betydelse — OK att låta värdet finnas.

## Filer
- `src/lib/tests/schema.ts`
- `src/lib/tests/scripts/ctas.ts`
- `src/lib/tests/scripts/visualHierarchy.ts`
- `src/lib/tests/audit-helpers.ts`
