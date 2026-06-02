## Scope
Endast `extractStarRating(parent, group)` i `src/lib/tests/scripts/trustSignals.ts`. Lägger till halv-stjärne-detektion så Eugenio D. / Isabella C. (4.5/5) får `rating: 4.5` istället för 5.

## Plan

### 1. Halv-stjärne-detektion som nytt steg före steg 4

Direkt efter steg 3 (SVG inline-fill), före steg 4 (all-visible + testimonial-context):

```
const half = parent.querySelectorAll(
  '[class*="half" i], [class*="fractional" i], [class*="partial" i]'
);
```

Trigger om:
- `allStars.length` mellan 3 och 5
- `half.length >= 1 && half.length <= allStars.length`
- Räkna `filled` (från steg 2-selektorn) som hela
- `rating = clamp(filled.length + half.length * 0.5, 0, 5)`
- Avrunda till 1 decimal: `Math.round(rating * 10) / 10`

Om filled-selektorn inte matchar (Teamtailor-fallet med half-stjärnor men inga "filled"-klasser): fallback till `allStars.length - half.length` som hela + `half.length * 0.5`.

### 2. Inline-style halv-stjärne-detektion (sekundär)

Vissa sajter renderar halv-stjärnor som overlay med `style="width: 50%"`. Inom steg ovan, om inga `[class*="half"]`-träffar:

```
for (const s of allStars) {
  const w = (s.getAttribute('style') || '').match(/width:\s*50%/i);
  if (w) halfCount++;
}
```

Endast om `halfCount >= 1 && halfCount <= allStars.length` → samma formel.

### 3. Steg 4 lämnas orört
All-visible-fallbacken körs bara om inga half-träffar — annars hade vi inte hamnat där.

### 4. Verifiering

Utöka jsdom-fixturen tillfälligt med:
- 5 stjärnor, 4 normala + 1 `class="star-half"` i testimonial-context → förväntat `rating === 4.5`
- 5 stjärnor, alla normala i testimonial-context → fortfarande `rating === 5` (regression)
- Hero med 5 stjärnor + ingen half → fortfarande ingen rating (regression)
- Inga `NaN`, `< 0`, `> 5`

Städa fixturen efter verifiering.

## Inte i scope
- `style="width: X%"` med andra värden än 50% (kvart-stjärnor är ovanligt och tas senare om behov uppstår)
- Scoring/pageSummary, testimonial author, `social_proof_count` på `trusted_by`
