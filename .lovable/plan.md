## Buggen

I förra fixen flyttade vi `selector`-strip för `trustSignals` + `ctas` in i `runPageAudit()`. Men `engine.server.ts` (rad 360–377) bygger sin overlay genom att filtrera på `!!t.selector`:

```ts
const trustOverlay = full.trustSignals
  .filter((t) => !!t.selector && !!t.rect && (...))
  .map((t) => ({ selector: t.selector!, category: t.type, rect: t.rect! }));
```

När selector strippas innan return blir filtret tomt → inga trustSignals ritas ut på den frusna screenshoten. Samma sak gäller live-overlayet på `page.evaluate(OVERLAY_FN, trustPairs)` (rad 364).

## Fix

Flytta strippen ett steg senare: ut ur `runPageAudit` och in i `engine.server.ts` `pageAudit`-casen, EFTER att overlayet byggts.

### `src/lib/tests/runners/pageAudit.server.ts`
Ta bort `ctasForSnapshot` och `trustForSnapshot`. Behåll `sectionsForSnapshot` (sections-overlay finns inte). Returnera `trustSignals: trustTyped` och `ctas: ctasTyped` med selector intakt. `_block` kan strippas här fortfarande (eller låt det vara — det är inte serialiserbart oavsett).

### `src/lib/tests/engine.server.ts` (pageAudit-case, runt rad 378)
Efter att `trustOverlay` byggts:

```ts
const trustForSnapshot = full.trustSignals.map(({ selector: _s, ...rest }) => rest);
const ctasForSnapshot = full.ctas.map(({ selector: _s, ...rest }) => rest);
data = {
  ...full,
  trustSignals: trustForSnapshot,
  ctas: ctasForSnapshot,
  overlayElements: trustOverlay,
};
```

Då behåller overlayet sina selectors (för rendering och DOM-lookup), medan snapshot-arrayerna som strömmas till UI och visas i JSON-vyn är rena.

Inga schema-ändringar (selector är redan optional på båda typerna sedan förra rundan).
