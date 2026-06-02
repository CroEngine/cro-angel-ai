
## Problem

`page-XXXX.json` är ~7553 rader varav majoriteten är en base64-JPEG på `rawCollect.screenshot.dataUrl`. För LLM-analys är skärmbilden värdelös — bara overhead.

## Lösning

Strippa `screenshot` och `overlayElements` ur `rawCollect` precis innan nedladdning. UI:t (Frozen viewport i `BrowserShell.tsx`) påverkas inte — det läser från live-stream-eventen, inte från download-payloaden.

## Ändring

**`src/components/browser-shell/FindingsView.tsx`** (rad 258-264):

Byt ut det inline `downloadJson(...)`-anropet mot en variant som stripar tunga fält ur `rawCollect`:

```ts
onClick={() => {
  const collectForExport = report.rawCollect
    ? (() => {
        const { screenshot, overlayElements, ...rest } = report.rawCollect;
        return rest;
      })()
    : undefined;
  downloadJson(`page-${Date.now()}.json`, {
    url: report.url,
    pageAudit: report.rawPageAudit,
    collect: collectForExport,
  });
}}
```

Alt. plocka ut det i en liten hjälpfunktion `stripHeavyCollect(raw)` ovanför komponenten om vi vill ha det rent.

## Påverkan

- Filstorlek: ~5 MB → ~50 KB (≈100× mindre).
- `BrowserShell` Frozen-vyn: oförändrad (läser screenshot från `step_passed`-event direkt).
- `ConsolePanel.tsx` har en egen "Download JSON" per collect-steg (rad 106) som laddar ner `data.elements` — den innehåller redan inte screenshot, så ingen ändring där.

## Inte i scope nu

- Ladda upp screenshot till storage och referera URL i JSON (Väg B). Bra senare om vi vill ha persistenta screenshots i rapport-vyn, men onödigt komplexitet just nu.
