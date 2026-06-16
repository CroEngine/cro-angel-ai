# Skip-link suspect-räknare (reviderad)

## Mål

Mät hur ofta off-flow-element passerar `isVisible` på en sajt utan att
filtreras. Datadrivet underlag för om predikatet behöver utökas när
korpus expanderar — observation, inte filtrering.

## Definition av "suspect"

Ett element är suspect om **alla** följande gäller efter att isVisible
returnerat `true`:

1. `cs.position` ∈ {`absolute`, `fixed`}
2. Minst ett av:
   - `rect.left < 0` (delvis utanför vänster)
   - `rect.top < 0` (delvis utanför ovan)
   - `rect.width <= 1 && rect.height <= 1` (mikro-rekt / sr-only utan clip)
   - `parseFloat(cs.textIndent) <= -100` (text-indent-hack)

Off-flow + någon av ovan = sannolik dold a11y-mekanism vi missade.
Inga falska positiv för flytande UI (modals, dropdowns) — de bryter
mot villkor 2.

## Filer

### 1. `src/lib/tests/schema.ts`

Lägg till valfritt sparse-fält på `CollectedElement`:

```ts
/** Set when off-flow + partially off-screen / micro-rect / text-indent
 *  hack — element som passerade isVisible men ser ut som dold a11y-
 *  mekanism. Diagnostik, inte filter. Endast satt när true. */
suspectOffFlow?: true;
```

### 2. `src/lib/tests/scripts/collect.ts`

Exporterad helper (samma `export + ${...toString()}`-mönster som
`isVisible` — *en* produktionsfunktion på *en* kodväg):

```ts
export function isSuspectOffFlow(
  cs: CSSStyleDeclaration,
  rect: DOMRect,
): boolean {
  if (cs.position !== "absolute" && cs.position !== "fixed") return false;
  return (
    rect.left < 0 ||
    rect.top < 0 ||
    (rect.width <= 1 && rect.height <= 1) ||
    parseFloat(cs.textIndent) <= -100
  );
}
```

Inlinas i `COLLECT_SCRIPT` via `${isSuspectOffFlow.toString()}` bredvid
`${isVisible.toString()}`.

I raw-collect-loopen (rad ~389), direkt efter `if (!isVisible(...)) continue`:

```js
const suspectOffFlow = isSuspectOffFlow(cs, rect);
raw.push({ /* ...befintliga fält..., */ suspectOffFlow });
```

I emit-loopen (rad ~435), sparse-spread så fältet utelämnas på rena element:

```js
...(r.suspectOffFlow && { suspectOffFlow: true }),
```

### 3. `src/lib/tests/scripts/__tests__/collect-visibility.test.ts`

Utöka importen och `cs()`-defaulten med `textIndent: "0px"` (deterministisk
nolla, inte NaN). Lägg till två tester:

```ts
describe("isSuspectOffFlow — diagnostik", () => {
  it("flaggar off-flow mikro-rekt (position:absolute; 1×1)", () => {
    expect(isSuspectOffFlow(
      cs({ position: "absolute" }),
      rect({ width: 1, height: 1, right: 1, bottom: 1 }),
    )).toBe(true);
  });

  it("flaggar inte normal flytande modal (position:fixed mitt på sidan)", () => {
    expect(isSuspectOffFlow(
      cs({ position: "fixed" }),
      rect({ left: 400, top: 200, right: 800, bottom: 600, width: 400, height: 400 }),
    )).toBe(false);
  });
});
```

Regression-vakten är gratis: mikro-rekt-fallet passerar `isVisible`
(1 är inte < 1) men flaggas av räknaren — exakt det läckage räknaren
ska mäta.

### 4. `src/lib/tests/snapshot/__tests__/snapshot.test.ts`

**Rätt plats**, inte breadth-smoke — här finns `elements` redan i minnet
efter replay. I loopen där varje sajt processas, efter `normalized` är
beräknad och innan diff/golden-skrivning, lägg till:

```ts
const suspectCount = (elements ?? [])
  .filter((e) => e.suspectOffFlow).length;
// eslint-disable-next-line no-console
console.log(`[snapshot] ${name}: ${suspectCount} off-flow suspects`);
if (suspectCount > 0) {
  const sel = elements.filter((e) => e.suspectOffFlow)
    .slice(0, 5).map((e) => e.selector);
  // eslint-disable-next-line no-console
  console.log(`[snapshot] ${name} suspect selectors:`, sel);
}
```

Inget gate failar — ren stdout-observation. När korpus expanderar
(15–30 sajter) ser vi siffrorna direkt i CI-loggen per körning.

## Inte i scope

- Ingen ändring av `isVisible` — räknaren observerar, filtrerar inte.
- Ingen ändring av render-canary-receipt — `suspectOffFlow` lever på
  `CollectedElement`, inte i font-receiptet.
- `breadth-smoke.ts` rörs inte (har inte elements i scope, fel placering).

## Risk

- **Hubspot golden:** sparse-fältet dyker upp i `golden.json` endast om
  hubspot har en off-flow-suspect. Vid första körning: om diff syns
  → vi har en konkret läckage-datapunkt och `bun run snapshot:update`
  rebaselinear intentionellt. Om ingen diff → 0 suspects bekräftat.
- **Inga andra snapshot-effekter** — fältet är sparse + optional.
