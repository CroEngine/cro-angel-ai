## Förslag: dela skärmen i två kolumner

Just nu ligger `Viewport` (live-iframen) ovanför `ConsolePanel` i en vertikal stack. Det betyder att man måste scrolla — och när konsolen fylls av events trycks sidan undan. Att lägga dem sida vid sida löser båda problemen och låter dig se vad som händer i sidan samtidigt som loggen rullar.

### Ny layout

```text
┌─────────────────────────────────────────────┐
│ TabStrip                                    │
├─────────────────────────────────────────────┤
│ UrlBar                                      │
├──────────────────────┬──────────────────────┤
│                      │                      │
│      Viewport        │     ConsolePanel     │
│      (live iframe)   │     (events)         │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

### Ändringar

- `src/components/browser-shell/BrowserShell.tsx`
  - Wrappa `<Viewport />` och `<ConsolePanel />` i en `flex-1 flex min-h-0` container med två `flex-1` barn och en tunn skiljare emellan.
  - Default 50/50. Konsolen får `overflow` internt så events inte trycker layouten.
- `src/components/browser-shell/Viewport.tsx` och `ConsolePanel.tsx`
  - Säkerställ att rooten är `h-full w-full` så de fyller sin halva (inte fasta höjder).

### Valfritt (kan vänta)

- Dra-bar skiljare för att justera bredden.
- På smala viewports (<900px) faller layouten tillbaka till vertikal stack via `lg:flex-row`.

Vill du att jag kör med 50/50 fast split, eller lägger in en dragbar skiljare direkt?
