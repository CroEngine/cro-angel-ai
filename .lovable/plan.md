Plan:

1. Gör screenshoten fullpage igen i `engine.server.ts`, men behåll korrekt metadata från själva JPEG-bilden så frozen-vyn vet exakt bildens bredd och höjd.

2. Ändra frozen-vyn i `Viewport.tsx` så den inte pressar ner fullpage-bilden till panelens bredd på ett sätt som gör den mindre än Browserbase-vyn. Den ska visas i faktisk screenshot-bredd upp till tillgänglig yta, och panelen ska få scrollbar när bilden är högre än viewporten.

3. Justera overlay-markeringarna så de använder samma fullpage-koordinater som screenshoten. Det innebär att collect-data ska använda dokumentposition (`docTop`/`docLeft`) för overlayn, inte bara viewport-relative `getBoundingClientRect()`.

4. Behåll Browserbase-sessionens viewport oförändrad. Ingen ändring av Browserbase-sessionstorlek eller debugger/live-vy.

Tekniskt:
- `page.screenshot({ fullPage: true })` återinförs.
- Frozen-containern blir `overflow-auto` med en bild-wrapper som har `width: viewport.w`, `height: viewport.h`, `maxWidth: 100%` och inte en låg aspect-ratio-box som krymper hela sidan.
- Overlay-filter återgår till fullpage-bounds: `rect.y + rect.h > 0 && rect.y < viewport.h`.
- `collect.ts` ändras för `rect.y = docTop` och `rect.x = docLeft`, så markeringar hamnar rätt även under första viewporten.