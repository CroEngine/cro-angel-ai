## Mål

Frozen-vyn ska som default fyllas till hela Viewport-containern ("Fit") istället för att scrolla. Toggle till 100% sparas till nästa patch.

## Ändring (endast `src/components/browser-shell/Viewport.tsx`)

Skriv om `FrozenViewport` enligt denna struktur:

```tsx
<div className="relative h-full w-full overflow-hidden flex items-center justify-center bg-muted/20">
  <div
    className="relative max-h-full max-w-full"
    style={{
      aspectRatio: `${viewport.w} / ${viewport.h}`,
      width: "100%",
      height: "auto",
    }}
  >
    <img
      src={screenshotUrl}
      alt="Frozen page snapshot"
      className="absolute inset-0 h-full w-full object-contain"
      draggable={false}
    />
    {/* overlays — oförändrade, procent-baserade mot viewport.w/h */}
  </div>

  {/* statuschip + Resume-overlay — oförändrade */}
</div>
```

### Princip

- Yttre flex-container: håller hela ytan, centrerar innehållet, döljer overflow.
- Aspect-ratio-wrapper: `width: 100%`, `height: auto`, `max-h/max-w-full` → wrapper bestämmer ratio, och krymper själv om höjden blir för stor.
- Bilden fyller wrappern med `object-contain`.
- Overlays sitter i samma wrapper och behåller sina procent → följer skalningen automatiskt.

### Detaljer

- Ta bort `overflow-auto` och den manuella `mx-auto` + fasta `width: viewport.w`.
- Undvik `width: 100%` + `height: 100%` samtidigt på aspect-ratio-wrappern (kan tvinga fel ratio i vissa container-höjder).
- Statuschip (Frozen · Browserbase off) och Resume-hover-knapp: oförändrade, ligger kvar absolut mot yttersta containern.
- Frozen-utan-snapshot-grenen och Cold-grenen: oförändrade.

## Inte i denna patch

- Fit / 100%-toggle (kommer som separat liten patch: state `mode: "fit" | "actual"`, knapp uppe i hörnet, i `actual` återinför vi `overflow-auto` + fast `width: viewport.w`).
- Klickbara overlays / tooltips (separat CRO-inspector-feature).

## Inga andra filer

`BrowserShell.tsx`, `UrlBar.tsx`, hooks, engine, run.functions: orörda.
