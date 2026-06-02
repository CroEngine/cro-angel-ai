Nej, du ska inte behöva gå tillbaka till en gammal variation. Jag föreslår en minimal riktad fix i den frysta viewporten istället.

Plan:
1. Ta bort den responsiva nedskalningen som gör fullpage-bilden pytteliten i halva browserpanelen.
2. Visa screenshoten i faktisk DOM-/screenshot-storlek som en scrollbar yta, så både vertikal och horisontell scroll fungerar när sidan är större än panelen.
3. Låt overlay-markeringarna ligga i samma koordinatsystem som fullpage-screenshoten, så de fortsätter matcha elementen.
4. Behåll `fullPage: true` och JPEG-dimensionsläsningen, eftersom problemet nu verkar sitta i presentationen, inte i själva screenshot-capturen.

Tekniskt ändras främst `src/components/browser-shell/Viewport.tsx`: `maxWidth: "100%"` och centrering tas bort/ersätts med en scroll-container som inte krymper innehållet. Om nödvändigt justerar jag även wrapperns `minWidth`/`width` så bilden alltid renderas i samma pixelstorlek som screenshotens metadata.