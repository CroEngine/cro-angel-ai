# Omgång 2 — HiBob lazy/animated sektioner (tvåstegs-fallback)

Mål: HiBob ska få fler `PageSection`-entries än 5; sektioner som Framer Motion håller på `opacity:0 / transform:translateY` ska inte filtreras bort av nollhöjd-checken.

## Ändring

`src/lib/tests/scripts/sections.ts`, addNode(), tidiga return-villkoret för små rektanglar:

Idag:
```js
const rect = el.getBoundingClientRect();
if (rect.width < 40 || rect.height < 80) return;
```

Nytt — tvåstegs-fallback. Bredd-check behålls hård (sektioner är aldrig <40px breda); höjd-check försöker först `offsetHeight`/`scrollHeight`, och faller sen tillbaka på off-screen-klon endast om det behövs:

```js
const rect = el.getBoundingClientRect();
if (rect.width < 40) return;
let effectiveH = rect.height;
if (effectiveH < 80) {
  // Steg 1: layout-höjd som ignorerar CSS transform.
  effectiveH = Math.max(el.offsetHeight || 0, el.scrollHeight || 0);
}
if (effectiveH < 80) {
  // Steg 2: klona av-skärm utan transform/overflow för att få naturlig höjd.
  try {
    const clone = el.cloneNode(true);
    clone.style.cssText =
      'position:fixed;left:-9999px;top:0;visibility:hidden;opacity:0;' +
      'transform:none;height:auto;max-height:none;overflow:visible;';
    document.body.appendChild(clone);
    effectiveH = clone.getBoundingClientRect().height;
    document.body.removeChild(clone);
  } catch (_) {}
}
if (effectiveH < 80) return;
// Patch rect.height för downstream-klassificering (visualWeight, hero-check).
if (effectiveH !== rect.height) {
  rect = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.top + effectiveH, width: rect.width, height: effectiveH, x: rect.left, y: rect.top };
}
```

Två viktiga detaljer:
- `rect` från `getBoundingClientRect()` är inte alltid skrivbart (DOMRectReadOnly i vissa browsers). Därför ersätter vi `rect` med ett plain object när vi måste skriva. Variabeln måste då deklareras med `let`, inte `const`.
- Klon-fallback körs **bara** när både rect och offsetHeight/scrollHeight är < 80 — dvs i praktiken endast på Framer Motion-element med `overflow:hidden` förälder. På Workable/Teamtailor/Ashby kostar det 0 extra ms.

## Diagnostik

För att verifiera vilken nivå som räddade varje nod, utöka `window.__wrapperDebug` är fel ställe (det handlar om wrapper-skip, inte fallback). Lägg till en separat `window.__lazyDebug = []` som pushar `{ tag, id, cls, rectH, offsetH, scrollH, cloneH, accepted }` för varje nod där `rect.height < 80`. Exponera den via samma read-pattern i runnern + `lazyDebug?: ...` i `schema.ts`.

## Verifiering

Kör HiBob efter implementation:
- Räkna `sections[].length` — ska gå upp från 5.
- Inspektera `lazyDebug[]` för att se vilka noder som räddades och av vilket steg (offsetHeight vs cloneHeight).
- Bekräfta att Workable/Teamtailor/Ashby-körningar inte regredierar (samma section-count som tidigare).

## Filer som ändras

- `src/lib/tests/scripts/sections.ts` — addNode() height-check + push till `window.__lazyDebug`.
- `src/lib/tests/runners/pageAudit.server.ts` — läs `window.__lazyDebug` efter Promise.all, returnera som toppnivåfält.
- `src/lib/tests/schema.ts` — `lazyDebug?: Array<...>` på `PageAuditData`.

Inga ändringar i pageAudit.ts, schema-fält för content.sections (det är `<section>`-räkning, separat metric), eller scroll-warmup-loopen.
