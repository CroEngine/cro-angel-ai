## Mål

En sida där du visuellt kan verifiera att varje fryst sajt i `corpus/` har allt den ska ha — och kan ladda ner varje fil (golden.json, meta.json, freeze-report.json, page.mhtml, screenshot.jpg) direkt.

## Vad du får se

Ny route `/corpus`:

- Lista över alla mappar under `corpus/` (just nu `hubspot`, `hibob`)
- Per sajt-kort:
  - Screenshot-thumbnail (öppnas full-size i ny flik)
  - Namn + URL + capture-datum + viewport (från `meta.json`)
  - "Status-chips": vilka av de 5 förväntade filerna som finns / saknas
  - Snabbsiffror från `freeze-report.json` (MHTML kB, font-count, timing) och `golden.json` (count, primaryCta-count, h1, hero-headline) — så du ser om frysningen är "tom" utan att öppna filen
  - Download-knapp per artefakt (5 st)
  - "Visa JSON" — fäller ut en kollapsbar pretty-printed viewer för varje JSON-fil (golden / meta / freeze-report)

```text
+--------------------------------------------------+
| [thumb] hubspot                    https://...   |
|         captured 2026-06-07  1280x720            |
|         ✓ golden ✓ meta ✓ report ✓ mhtml ✓ shot  |
|         138 elements · 1 primary CTA · hero: ... |
|         [↓ golden] [↓ meta] [↓ report] [↓ mhtml] |
|         [↓ screenshot]   [▸ Visa golden.json]    |
+--------------------------------------------------+
```

## Teknik

`corpus/` ligger utanför `src/`, så filerna måste serveras via en server-route (Vite bundlar inte dem).

1. **Server-route `src/routes/api/corpus.$.ts`** (splat) — läser från `corpus/<name>/<file>` på disk via `node:fs`, returnerar med rätt `Content-Type` (`application/json`, `image/jpeg`, `multipart/related` för mhtml). Sökvägen valideras strikt: bara whitelistade filnamn, inga `..`.
2. **Server-fn `listCorpus`** i `src/lib/corpus.functions.ts` — listar mappar under `corpus/`, returnerar för varje sajt: `{ name, files: { [name]: boolean }, meta, freezeReport, goldenSummary }` (parsar JSON-filerna server-side så klienten får färdig sammanfattning utan att ladda hela golden.json).
3. **Route `src/routes/corpus.tsx`** — `head()` med titel "Corpus inspector", använder `useSuspenseQuery` på `listCorpus`. Renderar kort per sajt. Download-knapparna pekar på `/api/corpus/<name>/<file>` med `download`-attribut. "Visa JSON" gör `fetch` mot samma endpoint on-demand och renderar i en `<pre>`.
4. **Navigering** — liten länk i `BrowserShell`-headern (eller på `/`) till `/corpus` så du hittar dit.

## Filer som skapas/ändras

- `src/routes/api/corpus.$.ts` (ny) — fil-serving
- `src/lib/corpus.functions.ts` (ny) — `listCorpus` server-fn
- `src/routes/corpus.tsx` (ny) — UI
- `src/routes/index.tsx` eller `BrowserShell` (liten ändring) — länk till `/corpus`

## Säkerhet

Endpointen läser bara från `corpus/`, validerar `name` mot `^[a-z0-9_-]+$` och `file` mot whitelist `golden.json | meta.json | freeze-report.json | page.mhtml | screenshot.jpg`. Allt annat → 404. Ingen auth — det är dev-verktyg på samma sajt som resten.

## Vad jag INTE gör (om du inte säger till)

- Ingen ny capture/freeze från UI:t (read-only inspector)
- Ingen diff mot snapshot-test (det är redan i CI)
- Ingen uppladdning/redigering av golden