## Plan

Du har rätt — innan vi började mecka med vad som skulle markeras i DOM:en funkade frozen-screenshoten. Det vi ändrade på vägen var två saker som tillsammans gör att bilden nu hamnar som en smal remsa "i hörnet":

1. **`engine.server.ts`** — `page.screenshot({ fullPage: true })` ersatte den tidigare viewport-screenshoten. Browserbase-sessionen körs i en relativt smal default-viewport, så när vi tar `fullPage` får vi en bild som är ~1024 bred och flera tusen pixlar hög = en lång tunn remsa.
2. **`Viewport.tsx` (FrozenViewport)** — layouten byttes från `absolute inset-0 object-contain` (bilden fittades centrerat i panelen) till `w-full h-auto` i en `aspectRatio`-container. Det förstärker problemet: containern blir extremt hög och bilden renderas som en smal kolumn.

### Återställning

**`src/lib/tests/engine.server.ts`**
- Byt `page.screenshot({ type: "jpeg", quality: 60, fullPage: true })` tillbaka till `fullPage: false` (viewport-screenshot, som det var innan).
- Behåll JPEG-dimensionsläsningen — den fungerar lika bra för viewport-bilder och fallback-grenen täcker resten.
- `scrollWarmup` + scroll-tillbaka-till-toppen behålls så lazy-content hinner laddas innan vi mäter rects och tar bilden.

**`src/components/browser-shell/Viewport.tsx` (FrozenViewport)**
- Återställ container till `flex items-start justify-center p-4` runt en `relative w-full max-w-full` med `aspectRatio: viewport.w / viewport.h`.
- Återställ `<img>` till `absolute inset-0 h-full w-full object-contain` så bilden fittas i panelen oavsett storlek.
- Återställ overlay-filtret till `rect.y + rect.h > 0 && rect.y < viewport.h && rect.w > 0 && rect.h > 0` så markörer som ligger utanför viewport-bilden inte ritas.

### Vad jag *inte* gör
- Rör inte Browserbase-sessionens viewport-storlek (förra planen om 1440×900) — du sa att det inte var ett problem innan, så den ändringen behövs inte.
- Rör inte collect/pageAudit-skripten eller overlay-logiken på live-sidan.

### Verifiering
- Kör flödet mot Teamtailor-URL:en i preview.
- Bekräfta att den frusna bilden fyller panelen (som den gjorde tidigare) och att de numrerade markörerna ligger rätt på det som syns i viewporten.
