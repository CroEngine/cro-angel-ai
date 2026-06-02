DOM-containment-dedup för `customer_logos` i `src/lib/tests/scripts/trustSignals.ts`.

## Ändringar

### 1. `push()` rad 111

```js
if (type === 'trusted_by' || type === 'customer_logos') entry._block = block;
```

### 2. Generalisera filter (rad 561–568)

```js
function dropWrappers(arr, targetType) {
  return arr.filter((a) => {
    if (a.type !== targetType) return true;
    const hasInner = arr.some((b) =>
      b !== a && b.type === targetType && a._block && b._block && a._block !== b._block && a._block.contains(b._block)
    );
    return !hasInner;
  });
}

let filtered = dropWrappers(out, 'trusted_by');
filtered = dropWrappers(filtered, 'customer_logos');
for (const e of filtered) delete e._block;
return filtered;
```

`_block` finns kvar på entries genom hela kedjan — `delete` körs sist, efter båda `dropWrappers`-anropen. Inga mellanliggande operationer rör arrayen.

## Förväntat på teamtailor

- 6 → 3 `customer_logos` (11, 8, 4)
- `pageSummary.logoCount` 46 → 23
- `trusted_by` oförändrad

## Inte i scope

Stars rating, org_number postnummer-FP, badge/logo-dubbelräkning.
