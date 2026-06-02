## Problem

Tidigare fix gick teamtailor från 6 → 2 `customer_logos`-entries, men hero (11) och mid-section (8) försvann helt. Bara footer (4+4) överlevde. Personio funkar bra (4 entries, 5+66+60+6), så buggen är specifik för wrapper→inner ancestor-relationen i teamtailor's DOM. Vi behöver defensiv härdning + faktisk diagnostik.

## Plan

### 1. Same-block dedup som separat pre-pass

I `src/lib/tests/scripts/trustSignals.ts` ~rad 559, ersätt `dropWrappers`-helpern med två separata helpers så ordningsberoendet försvinner:

```js
// Pass A: dedupera entries som råkar peka på exakt samma _block (keep first).
function dedupeSameBlock(arr, targetType) {
  const seen = new Set();
  return arr.filter((e) => {
    if (e.type !== targetType || !e._block) return true;
    if (seen.has(e._block)) return false;
    seen.add(e._block);
    return true;
  });
}

// Pass B: drop wrapper-block som innehåller ett annat innermost block av samma typ.
function dropWrappers(arr, targetType) {
  return arr.filter((a) => {
    if (a.type !== targetType) return true;
    return !arr.some((b) =>
      b !== a && b.type === targetType && a._block && b._block && a._block !== b._block && a._block.contains(b._block)
    );
  });
}

let filtered = dedupeSameBlock(out, 'trusted_by');
filtered = dropWrappers(filtered, 'trusted_by');
filtered = dedupeSameBlock(filtered, 'customer_logos');
filtered = dropWrappers(filtered, 'customer_logos');
```

Två separata pass per typ → ingen interferens mellan dedup-strategierna oavsett push-ordning.

### 2. Temporär `_debug`-output på `customer_logos`

Mellan dedup-passen och `delete e._block`, snappa både råa och slutgiltiga arrayer:

```js
// TEMP DEBUG: containment-matris för customer_logos
const allCl = out.filter((e) => e.type === 'customer_logos');           // ofiltrerat
const survivingCl = filtered.filter((e) => e.type === 'customer_logos'); // efter båda passen
for (const e of survivingCl) {
  e._debug = {
    blockTag: e._block && e._block.tagName,
    blockCls: (e._block && e._block.className && String(e._block.className).slice(0, 80)) || '',
    isBody: e._block === document.body,
    isMain: e._block === document.querySelector('main'),
    droppedSiblings: allCl
      .filter((o) => o !== e && !survivingCl.includes(o))
      .map((o) => ({
        tag: o._block && o._block.tagName,
        cls: (o._block && o._block.className && String(o._block.className).slice(0, 60)) || '',
        logoCount: o.logoCount,
        section: o.section,
        containsSelf: !!(o._block && e._block && o._block.contains(e._block)),
        containedBySelf: !!(o._block && e._block && e._block.contains(o._block)),
        sameBlock: o._block === e._block,
      })),
  };
}

for (const e of filtered) delete e._block;
return filtered;
```

`survivingCl.includes(o)` (inte `filtered.includes(o)`) — då är "dropped"-listan exakt det som föll bort i de två `customer_logos`-passen, oberoende av vad som hände i `trusted_by`-passen.

### 3. Verifiering

Kör tre URL:er och läs `_debug`:
- `teamtailor.com/sv` — primär diagnostik
- `personio.com/hr-platform/` — regression: ska fortsatt ge 4 entries (5+66+60+6)
- `talentium.io` — regression: ska fortsatt ge 1 entry (32)

Beslutsmatris baserat på `_debug` från teamtailor:
- `isBody` / `isMain` true på ett hero-entry → härda `nearestBlock` så den aldrig returnerar root.
- Hero-blocket är giltigt men en wrapper-ancestor matchar både hero och footer → skärp containment-villkoret.
- Flera entries delar `_block` och pre-passet räddade dem → ingen mer fix behövs.

### 4. Cleanup

Nästa iteration (efter att rotorsaken är permanent åtgärdad): ta bort `_debug`-blocket. `dedupeSameBlock` + `dropWrappers` stannar permanent.

## Inte i scope

- Stars rating exposure
- `org_number` postal code FP
- Badge/logo cross-type dedup
- Geo-targeting för proxies

## Filer som ändras

- `src/lib/tests/scripts/trustSignals.ts` (helper-split + debug-block)
- `.lovable/plan.md` (statusrad)
