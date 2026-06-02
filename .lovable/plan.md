# Debug: identifiera hur G2-badges renderas — via return-värde

## Mål

Hitta hur "Leader" / "G2" / "Momentum" badges renderas på Teamtailor: `<img>`, `<svg>`, eller CSS `background-image`. Resultatet styr nästa fix av shape-fallbacken.

## Strategi: returnera debug-data i evaluate-resultatet

Idag returnerar `TRUST_SIGNALS_SCRIPT` en array `out`. Vi ändrar tillfälligt formen till `{ signals: out, _badgeDebug: {...} }` och packar upp den i runnern. Inget beroende av `page.on('console')`.

### 1) Ändringar i `src/lib/tests/scripts/trustSignals.ts`

Precis innan nuvarande `return out` (rad 294), bygg `badgeDebug`:

```ts
const KEYWORD_RX = /\bg2\b|leader|momentum|capterra|trustpilot|trustradius|software ?advice|getapp|sourceforge/i;
const badgeDebug = {
  textMatches: [],   // element vars text/aria matchar KEYWORD_RX
  imgCandidates: [], // alla <img> med portrait-ish rect i KEYWORD-nära sektioner
  svgCandidates: [], // alla <svg> 40–260px portrait
  bgCandidates: [],  // element med backgroundImage !== 'none', portrait 40–260px
};
```

**a) textMatches (max 30)** — Iterera `document.querySelectorAll('*')`, för element vars direkta textContent (utan barn-text) eller `aria-label` matchar `KEYWORD_RX`:
```
{ tag, className: cn.slice(0,120), text: text.slice(0,80),
  rect: {w,h,top}, bgImage, hasImgChild, hasSvgChild,
  imgChildSrcs: [...].slice(0,3), ariaLabel, role,
  parentChain: 3 ancestors med {tag, className.slice(0,80)} }
```

**b) imgCandidates (max 30)** — Alla `<img>` med `20 ≤ width ≤ 300`, `20 ≤ height ≤ 300`. Logga `{src, alt, w, h, top, parentTag, parentClass.slice(0,80)}`. Detta avslöjar om badges är `<img>` som föll utanför 60–220-fönstret.

**c) svgCandidates (max 30)** — Alla `<svg>` med `40 ≤ width ≤ 260`, `height >= width * 0.9`. Logga `{w, h, top, titleText: first <title>, ariaLabel, parentTag, parentClass.slice(0,80)}`.

**d) bgCandidates (max 30)** — Iterera `document.querySelectorAll('div, span, a, li, figure')`, kolla `getComputedStyle(el).backgroundImage`. Om `!== 'none'` och rect är `40–260px` portrait, logga `{bgImage, tag, className.slice(0,80), w, h, top, ariaLabel}`. (Skippa hero-bilder via `w > 600` filter.)

Hårdtak 30 rader per kategori (`if (arr.length >= 30) break/continue`).

Ändra retursignatur:
```ts
return { signals: out, _badgeDebug: badgeDebug };
```

### 2) Ändringar i `src/lib/tests/runners/pageAudit.server.ts`

Vid destrukturering av evaluate-resultaten (rad 81), packa upp:
```ts
const trustResult = trustSignals as { signals: TrustSignal[]; _badgeDebug?: unknown };
const trustTyped = trustResult.signals;
```

Och lägg `_badgeDebug` i runnerns return-objekt så det syns i audit-JSON:en:
```ts
return {
  ...audit,
  // ...
  trustSignals: trustTyped,
  _badgeDebug: trustResult._badgeDebug, // TODO badge-debug — remove after teamtailor verification
  // ...
};
```

Detta lägger fältet i den JSON som strömmas tillbaka. Användaren kan inspektera `_badgeDebug` direkt i audit-output utan extra logghantering.

### 3) Markering för rivning

Alla nya block markeras med `// TODO badge-debug — remove after teamtailor verification`. Schema rörs inte — `_badgeDebug` är ett optional fält som existerar utanför `TrustSignal[]`.

## Beslut efter debug

| Fynd i `_badgeDebug` | Åtgärd |
|---|---|
| `imgCandidates` innehåller G2-badges < 60px bredd | Sänk shape-fallback min-bredd till 40 |
| `imgCandidates` innehåller G2-badges men inget triggade — kolla parentChain mot heading | Justera heading-regex eller sök-djup |
| `svgCandidates` innehåller `<svg>` med G2-titel | Utöka shape-fallback till att iterera `img, svg` |
| `bgCandidates` innehåller `background-image` med G2-URL | Lägg `getComputedStyle`-scan i shape-fallback |
| `textMatches` har element men inga img/svg/bg → text-noder eller `<i>`-ikoner | Ovanligt; bygg text-baserad badge-detektor |

## Filer som ändras

- `src/lib/tests/scripts/trustSignals.ts` — bygg `badgeDebug`, ändra return till `{ signals, _badgeDebug }`.
- `src/lib/tests/runners/pageAudit.server.ts` — packa upp `.signals`, exponera `_badgeDebug` i audit-resultatet.

## Inte i scope

Faktisk fix av detektorn — det kommer i nästa iteration efter att debug-datan visat var badges sitter.
