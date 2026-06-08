## Mål

Flytta corpus fil-serving till `/api/public/*` så download-länkar, screenshot `<img>` och JSON-fetch slipper Lovables preview-auth. `listCorpus` (server-fn via intern RPC) rörs inte.

## Ändringar

### 1. Flytta server-route
`src/routes/api/corpus.$.ts` → `src/routes/api/public/corpus.$.ts`

Behåll redan-fungerande `createFileRoute({ server: { handlers } })`-formen (det är den som byggde rent i förra varvet i den här templaten), men uppdatera path-strängen till `/api/public/corpus/$`. `?download=1` är redan implementerat och sätter `Content-Disposition: attachment` — det är inte inert i nuvarande koden.

Säkerhet:
- Whitelist på filnamn: `golden.json | meta.json | freeze-report.json | page.mhtml | screenshot.jpg`
- Sajtnamn matchar `^[a-z0-9_-]+$`
- Lägger till `path.resolve` + `startsWith(CORPUS_ROOT + sep)`-kontroll som extra skydd mot traversal (belt & suspenders ovanpå regex+whitelist)
- Read-only, ingen PII → uppfyller `/api/public/*`-reglerna

### 2. Uppdatera klient-URL:er i `src/routes/corpus.tsx`

Inför en helper högst upp:
```ts
const apiUrl = (site: string, file: string) => `/api/public/corpus/${site}/${file}`;
```
och byt de 3 ställena som hårdkodar `/api/corpus/...`:
- screenshot `<img src>` + omslutande `<a href>`
- download-knapparnas `<a href={...?download=1}>`
- `fetch(...)` i `JsonInline`

## Anmärkning om API-formen

Du föreslog `createServerFileRoute().methods(...)`. I förra builden använde vi `createFileRoute("/api/...")({ server: { handlers: { GET } } })` och det kompilerade rent mot templaten. Jag behåller den formen (lägre risk) om du inte explicit vill att jag växlar — i så fall säg till så testar jag `createServerFileRoute` också.

## Filer

- ny: `src/routes/api/public/corpus.$.ts` (flyttad)
- borttagen: `src/routes/api/corpus.$.ts`
- ändrad: `src/routes/corpus.tsx` (3 URL-byten)