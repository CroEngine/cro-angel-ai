Just nu renderas screenshoten i sina råa pixelmått (t.ex. 1280×8000), vilket gör att den blir mycket bredare än panelen → ser inzoomad ut och scrollar horisontellt.

Fix: skala bilden så att bredden alltid matchar containerns bredd. Höjden följer med via `aspect-ratio`, så proportionerna bevaras. Overlay-rutorna ligger redan i procent, så de följer skalningen automatiskt.

Ändring i `src/components/browser-shell/FrozenViewport` (i `Viewport.tsx`):
- Byt fast `width: viewport.w` mot `width: 100%` + `maxWidth: viewport.w` (så vi inte uppskalar små screenshots över sina nativa pixlar).
- Behåll `aspectRatio: viewport.w / viewport.h` så höjden räknas ut korrekt.
- Ta bort `minWidth` och horisontell scroll: containern blir `overflow-y-auto overflow-x-hidden`.

Inget annat ändras (screenshot-capture, datapipeline, overlay-logik orörda).