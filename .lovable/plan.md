## Root cause

`/corpus` SSR:ar från dev men preview-iframen kör Cloudflare Worker-builden, vars virtuella FS inte innehåller `corpus/`. `existsSync("corpus") → false` ⇒ `{ sites: [] }`. Samma sak slår `/api/public/corpus/$` (404 på screenshots/downloads).

## Strategi: binärer via `public/`, JSON via lazy glob

Claudes kritik är giltig — `?url`-emit på `.mhtml` och cross-origin `<a download>` är otestade antaganden, och `eager: true` på `golden.json` inlinar dem i worker-scriptet (10 MB-tak träffas långt före diskutrymmet). Reviderad plan:

### Steg 0 — Spike (innan koden skrivs)

Kopiera `corpus/hubspot/screenshot.jpg` → `public/corpus/hubspot/screenshot.jpg`, ladda `/corpus/hubspot/screenshot.jpg` i preview-iframen. Förväntat: 200, same-origin. Det bekräftar `public/`-vägen. Ingen `?url`-spike behövs — vi använder den inte.

### Steg 1 — Flytta binärer till `public/corpus/`

- Lägg `screenshot.jpg` och `page.mhtml` per sajt under `public/corpus/<site>/`. (Hubspot + hibob nu.)
- Statiskt serverade från preview-host, garanterat same-origin, `<a download>` fungerar, inget worker-anrop.
- `freeze.server.ts` skriver redan till `corpus/<site>/` i dev — komplettera med en kopia till `public/corpus/<site>/` så framtida freezes hamnar rätt. (Liten ändring, en `cp`-rad per binär.)

### Steg 2 — JSON via lazy glob, meta eagerly

Ny `src/lib/corpus-bundle.ts`:

```ts
// Eagerly — behövs för listning + sammanfattningar
const metaModules = import.meta.glob("../../corpus/*/meta.json", { eager: true, import: "default" });
const freezeReportModules = import.meta.glob("../../corpus/*/freeze-report.json", { eager: true, import: "default" });

// Lazy — laddas först när viewern expanderar
const goldenLoaders = import.meta.glob("../../corpus/*/golden.json", { import: "default" });
const familiesLoaders = import.meta.glob("../../corpus/*/render-canary.families.json", { import: "default" });
```

`meta.json` + `freeze-report.json` är små (några kB). `golden.json` (kan vara hundratals kB) och `families` lazy-loadas — håller worker-scriptet litet.

Lite knepigt: `goldenSummary` i `listCorpus` läser idag från golden för att visa snabbsiffror i kortet (elementCount, hero, CTA, sectionOrder). Två alternativ:
- (a) Behåll snabbsiffrorna eagerly — då måste golden vara eager. Bryter skalningen.
- (b) Flytta snabbsiffrorna till en separat lazy serverfn `getGoldenSummary(site)` som UI:t kallar per kort. `listCorpus` returnerar bara meta + freeze-report + filexistens.

Väljer (b). `corpus.tsx` får en `useQuery` per `SiteCard` för summary. Liten UI-ändring (visa "—" tills loaded), men den enda vägen som skalar.

### Steg 3 — `listCorpus` läser från bundle:n

- Sajt-listan = nycklar i `metaModules` (extrahera namnet ur sökvägen).
- `files[f].exists`:
  - JSON: finns entry i respektive modul-map? (för `golden.json` / `families` räcker det att kolla om `goldenLoaders[path]` finns — inte exekvera den)
  - Binärer (`page.mhtml`, `screenshot.jpg`): hårdkoda `true` tillsvidare, eller `import.meta.glob("../../public/corpus/*/screenshot.jpg", { eager: true, query: "?url" })` bara för att veta existens. Storleksinfo försvinner (visa `—`).

### Steg 4 — `/api/public/corpus/$`

- JSON-filer: returnera från bundle:n (för `golden.json` / `families` — `await goldenLoaders[path]()`).
- `screenshot.jpg` / `page.mhtml`: 302-redirecta till `/corpus/<site>/<file>` (same-origin public-asset). Eller skippa routen helt för binärer och låta klienten peka direkt på `/corpus/<site>/<file>`.

Faktiskt enklast: i `corpus.tsx`, ändra `apiUrl(site, "screenshot.jpg")` → `/corpus/${site}/screenshot.jpg` direkt, hoppa över worker-routen för binärer. Worker-routen behövs då bara för JSON.

### Steg 5 — Ta bort `apiHost()`-hacket

`/_serverFn/...` och `/api/public/corpus/...` är same-origin i preview-iframen när workern hanterar dem utan FS-beroende. Hela `id-preview` → `project--<uuid>-dev` rewrite-grejen kan strykas. Förenklar koden.

## Vad jag rör

- **Skapar:** `public/corpus/hubspot/{screenshot.jpg,page.mhtml}`, `public/corpus/hibob/{screenshot.jpg,page.mhtml}`, `src/lib/corpus-bundle.ts`, ny serverfn `getGoldenSummary`.
- **Ändrar:** `src/lib/corpus.functions.ts` (FS → bundle, summary lazy), `src/routes/api/public/corpus.$.ts` (JSON från bundle, binärer redirect/borta), `src/routes/corpus.tsx` (binär-URL till `/corpus/...`, lazy summary, ta bort `apiHost`), `scripts/freeze-site.ts` (kopiera binärer till `public/corpus/` också).
- **Rör inte:** tester, `freeze.server.ts` core-logik, `corpus/`-mappen i repo-roten (källan).

## Skalningskommentar

Vid 1000 sajter: `meta.json` (~1 kB) × 1000 = ~1 MB eager i scriptet — OK. `freeze-report.json` är större (~5-20 kB), 1000 × 10 kB = 10 MB → börjar närma sig taket. Då lazy:as även `freeze-report` och `listCorpus` returnerar bara namn + existens. Den ändringen är liten och kan göras när skalan kräver det — men det är värt att notera nu så vi vet var taket sitter.

Binärerna i `public/corpus/` räknas mot total deploy-storlek men inte mot worker-scriptet. 1000 × (~500 kB MHTML + ~200 kB JPG) ≈ 700 MB, vilket är en annan diskussion (Cloudflare static asset limits, build time). Då vill man peka mot R2/Lovable Storage. Inte ett problem nu.

## Verifiering

- `bun run build` grön.
- Preview `/corpus`: 2 sajter syns, hard-reload behåller 2, screenshots laddas, JSON-viewer expanderar (lazy fetch loggar i devtools), download triggar fil.
- Tester `bunx vitest run` opåverkade.
