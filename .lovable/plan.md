# Sektionsdedup — containment + samma heading

## Ändring i `src/lib/tests/scripts/sections.ts`

1. Byt `const raw = []` → `let raw = []`.
2. Mellan `raw.sort(...)` och `const out = raw.map(...)`, lägg in:

```js
function isContained(inner, outer) {
  const sy = document.documentElement.scrollTop || document.body.scrollTop || 0;
  const ir = inner.rect, or = outer.rect;
  const iTop = ir.top + sy;
  const iBot = iTop + ir.height;
  const oTop = or.top + sy;
  const oBot = oTop + or.height;
  return iTop >= oTop - 4 && iBot <= oBot + 4
      && ir.left >= or.left - 4 && (ir.left + ir.width) <= (or.left + or.width) + 4;
}
function normHeading(h) {
  return (h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
const deduped = [];
for (const cand of raw) {
  let drop = false;
  for (const kept of deduped) {
    if (!isContained(cand, kept)) continue;
    const ch = normHeading(cand.heading);
    const kh = normHeading(kept.heading);
    if (ch === '' || ch === kh) { drop = true; break; }
  }
  if (!drop) deduped.push(cand);
}
raw = deduped;
```

Använder `document.documentElement.scrollTop` (med body-fallback) istället för `window.scrollY` enligt feedback — robustare cross-browser om scroll-warmup inte hunnit settla helt.

## Verifiering

- HiBob: `sections[].length` 15 → ~14, gamla section_3 (`<header>` med samma heading som hero) borta, hero kvar.
- Workable / Teamtailor / Ashby: ingen regression — sibling-cards med distinkta headings behålls.

## Fil

- `src/lib/tests/scripts/sections.ts`
