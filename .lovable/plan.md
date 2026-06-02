DOM-ancestor-dedup för `trusted_by` i `src/lib/tests/scripts/trustSignals.ts`.

## Problem

Efter förra rundan finns 4 `trusted_by`-träffar i teamtailor-auditen, varav 3 från samma stats-sektion:

- `"Mer än Rekryteringar 845 000 Används av fler än Rekryterare 200 000 Används av fler än Företag 10 000"` (parent-wrapper)
- `"Används av fler än Rekryterare 200 000"` (child)
- `"Används av fler än Företag 10 000"` (annan child)

Den nuvarande dedupen jämför `text` exakt, men parent har sammansatt text ≠ child-texten, så den filtrerar inte bort wrappern.

## Lösning

Spara en referens till `block`-elementet på varje entry tillfälligt under loopen, och filtrera bort wrappers där `block.contains(otherBlock)` är sant för någon annan trusted_by-träff. Behåll alltid det innersta blocket (det med flest föräldrar bland sina containing-träffar, eller motsvarande minst `visualWeight`).

### Implementation

1. **I `push()`**: när `type === 'trusted_by'`, lägg `entry._block = block` (icke-enumerable så det inte serialiseras, eller bara en vanlig prop som tas bort senare).

2. **Ersätt befintlig text-baserad filter** (precis innan `return out`):
   ```js
   const filtered = out.filter((a) => {
     if (a.type !== 'trusted_by') return true;
     // Drop if any other trusted_by entry's block is a descendant of this one
     const hasInner = out.some((b) =>
       b !== a && b.type === 'trusted_by' && a._block && b._block && a._block !== b._block && a._block.contains(b._block)
     );
     return !hasInner;
   });
   // Strip helper field before returning
   for (const e of filtered) delete e._block;
   return filtered;
   ```

3. **Behåll inte text-equality-checken** — DOM-checken är striktare och fungerar både när parent-texten är sammansatt och när den är identisk.

## Förväntat resultat för teamtailor

Före: 4 trusted_by  
Efter: 3 trusted_by
- "Används av 10 000+ företag" (i hero, ingen relation till stats-sektionen)
- "Används av fler än Rekryterare 200 000"
- "Används av fler än Företag 10 000"

Wrappern "Mer än Rekryteringar 845 000 ..." försvinner eftersom dess block innehåller de två children-blocken.

## Inte i scope

- stars rating-exponering, customer_logos-dedup, org_number postnummer-FP — separata steg.