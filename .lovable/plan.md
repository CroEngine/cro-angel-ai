## Mål

Få `pageSummary.averageRating` och `pageSummary.reviewCount` att populeras korrekt även när rating inte står som synlig text bredvid stars (Trustpilot-widget, schema.org, aria-label, eller "alla 5 stjärnor fyllda utan siffra").

## Bakgrund

Validering mot ny Teamtailor-körning: stars hittas (`"5 stars"` i content), men `extractStarRating()` returnerar `{}`. Semrush samma. Detta blockerar Trust-checken i scoring-motorn.

## Ändringar — endast `src/lib/tests/scripts/trustSignals.ts`

### 1. Utöka `neighborText(el)`

Lägg till `parent.parentElement.parentElement` (3 nivåer upp) och alla syskon till parent — annars missar vi Trustpilot-widgetar där rating-texten sitter i en separat div utanför star-containern.

### 2. Utöka `extractRatingMeta(text)` med fler format

Nya regex utöver befintliga:
- `TrustScore\s+(\d[.,]\d)`
- `Rated\s+(\d[.,]\d)\s*(out of|\/)\s*5`
- `(\d[.,]\d)\s*stars?\b`
- ReviewCount: `based on\s+(\d{1,3}(?:[ ,.]\d{3})*|\d+)\s*(reviews|recensioner|ratings)`

Kör regex mot `el.innerText` (inte `textContent`) för korrekt whitespace-hantering.

### 3. Ny helper `extractRatingFromAttrs(el)` — attrs/schema först

För `el` + 2 förfäder + descendants (cap 50), läs:
- `aria-label` / `title` mot regex `/(\d[.,]?\d?)\s*(out of|av|\/)\s*5/i` och `/Rated\s+(\d[.,]\d)/i`
- `[itemprop="ratingValue"]` → `content`-attr eller textContent
- `[itemprop="reviewCount"]` / `[itemprop="ratingCount"]` → samma
- `[data-rating]`, `[data-score]`, `[data-stars]` numeriskt

Returnera `{}` om inget hittas. Alla parseFloat/parseInt-resultat **isNaN-guard:as** innan de inkluderas — så pageSummary aldrig blir NaN.

### 4. Uppdatera `extractStarRating(parent)` — prioritetsordning

```text
function extractStarRating(parent) {
  const fromAttrs = extractRatingFromAttrs(parent);
  if (fromAttrs.rating !== undefined) return fromAttrs;
  const fromText = extractRatingMeta(neighborText(parent));
  if (fromText.rating !== undefined) return fromText;
  // Fallback: count filled stars — endast om det ser ut som rating-widget
  const allStars = parent.querySelectorAll('[class*="star" i]');
  const filled = parent.querySelectorAll(
    '[class*="filled" i], [class*="active" i], [class*="full" i], [aria-checked="true"]'
  );
  if (allStars.length >= 4 && allStars.length <= 5 && filled.length >= 1 && filled.length <= allStars.length) {
    return { rating: filled.length };
  }
  return {};
}
```

Tighter än första utkastet: kräver `filled.length >= 1` och `<= allStars.length` så vi inte plockar dekorativa stars utan fyllnadsindikator.

### 5. Ny standalone-sweep för schema.org aggregateRating

Efter befintliga sweeps:
```text
document.querySelectorAll('[itemtype*="AggregateRating" i], [itemprop="aggregateRating"]').forEach(el => {
  const ratingEl = el.querySelector('[itemprop="ratingValue"]');
  const countEl = el.querySelector('[itemprop="reviewCount"], [itemprop="ratingCount"]');
  const ratingRaw = ratingEl && (ratingEl.getAttribute('content') || ratingEl.textContent || '').trim();
  const countRaw = countEl && (countEl.getAttribute('content') || countEl.textContent || '').trim();
  const rating = ratingRaw ? parseFloat(ratingRaw.replace(',', '.')) : undefined;
  const count = countRaw ? parseInt(countRaw.replace(/\D/g, ''), 10) : undefined;
  const extras = {};
  if (rating !== undefined && !isNaN(rating)) extras.rating = rating;
  if (count !== undefined && !isNaN(count)) extras.reviewCount = count;
  if (Object.keys(extras).length) push('review_rating', `Aggregate rating ${extras.rating ?? ''}`.trim(), el, 'schema', extras);
});
```

### 6. Sweep för Trustpilot/G2-widget-containrar

`[class*="trustpilot" i], [class*="trustbox" i], [data-businessunit-id], [class*="g2-" i]`:
- Läs `data-stars`, `data-rating`, `data-score` (isNaN-guard).
- Fallback: kör `extractRatingMeta` på `el.innerText` (whitespace-medveten).
- Pusha `review_rating` med `reviewSource` satt utifrån klassnamnet.

### 7. Dedupe-skydd

Star-count-fallbacken (4) och schema-sweepen (5) får inte dubbel-pusha samma rating. Använd befintlig `seen`-set i `push()` — den dedupar redan på `type + text + selector`, vilket räcker när vi inkluderar `el` korrekt.

## Verifiering

Köra om Teamtailor och Semrush via `/api/tests/.../stream`:

- Teamtailor: `averageRating ≥ 4.0` och `reviewCount > 0`.
- Semrush: `averageRating > 0` eller dokumentera "ingen aggregate rating i DOM" (acceptabelt).
- Loopia: fortfarande 0/0 (ingen regression — sajten har ingen rating).
- Inga `NaN`-värden någonstans i `pageSummary` eller `trustSignals[].rating`.

## Ej i scope

Scoring-motorn, DB-tabell, UI. Endast trustSignals.ts.

## Filer som ändras

- `src/lib/tests/scripts/trustSignals.ts`
