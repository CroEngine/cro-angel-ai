## Mål

Frozen-vyn ska visa hela sidan (inte bara första foldarna) och vara vertikalt scrollbar. Layouten passar bredden till containern.

## Ändringar

### 1. `src/lib/tests/engine.server.ts` (kring rad 224–238)

- Byt `fullPage: false` → `fullPage: true`.
- Mät dokumentets fulla höjd via `document.documentElement.scrollHeight` (clamped till t.ex. max 8000 px för säkerhet — väldigt långa SPA:er kan annars producera enorma JPEGs).
- Sänk `quality` från 60 → 50 för att kompensera den större ytan.
- `screenshot.viewport` → `{ w: vp.w, h: clampedFullHeight }` så Frozen-vyn vet bildens proportioner.

Skiss:
```ts
const vp = await page.evaluate(...) // { w, h }
const fullH = await page.evaluate("document.documentElement.scrollHeight") as number;
const clampedH = Math.min(Math.max(fullH, vp.h), 8000);
const buf = await page.screenshot({ type: "jpeg", quality: 50, fullPage: true });
screenshot = { dataUrl: ..., viewport: { w: vp.w, h: clampedH } };
```

Loggrad utökas: `screenshot captured (Xkb, fullPage W×H)`.

### 2. `src/components/browser-shell/Viewport.tsx` (FrozenViewport)

Tillbaka till fit-to-width + vertikal scroll:

```tsx
<div className="relative flex-1 overflow-y-auto overflow-x-hidden bg-muted/20">
  <div
    className="relative w-full"
    style={{ aspectRatio: `${viewport.w} / ${viewport.h}` }}
  >
    <img ... className="absolute inset-0 h-full w-full object-contain" />
    {overlays}
  </div>
  {statusChip + resumeHover}
</div>
```

- `w-full` på wrappern → bredden matchar containern, höjden följer via `aspectRatio` (kan bli mycket högre än containern → scroll aktiveras).
- Overlays oförändrade — procent mot `viewport.w/h` håller alignment.
- Filter `el.rect.y < viewport.h` fungerar fortfarande korrekt eftersom `viewport.h` nu är fulla höjden.
- Statuschip blir `sticky top-3` istället för `absolute top-3` så att "Frozen"-indikatorn alltid syns under scroll.
- Resume-hover-overlay: byt till `sticky top-0 h-full` eller behåll `absolute inset-0` — väljer `absolute inset-0` men inom en `sticky` wrapper så den följer scroll. Enklare: lämna som idag (absolute mot ytterst). Då syns Resume-knappen bara när man hovrar i den initialt synliga ytan. Acceptabelt för v1.

### 3. Ingen ändring i andra filer

- `BrowserShell.tsx`, `UrlBar.tsx`, `useTestStream.ts`, `run.functions.ts`: orörda.
- Overlay-koordinater från `collect` (viewport-relativa vid scroll=0) hamnar fortsatt rätt i bildens topp.

## Trade-offs / kända begränsningar

- SSE-payload växer (förmodligen 200–600 kb). `console.warn > 500kb` triggas oftare → bra signal för att senare flytta till storage-upload.
- Overlays visas bara för element som var i första viewporten under collect — under fold-element saknar fortfarande overlays. Att lägga till dem kräver ändringar i collect (scrolla + samla), inte en del av denna patch.
- Resume-knapp under hover syns bara i översta delen av Frozen-vyn — minor.

## Uppföljningar (inte i denna patch)

- Toggle "Översikt" (zoom-out hela sidan).
- Collect under fold (scroll + merge rects).
- Flytta screenshots till R2/storage-upload, skicka URL i SSE istället för data-URL.
