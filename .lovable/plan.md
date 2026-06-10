## Mål

Få freezing att klara siter där `page.mhtml` blir > 10 MB (repo-gränsen). Idag dör commit på Salesforce-storlek (60 MB efter font-embed). Lösningen ska vara automatisk — ingen manuell `lovable-assets`-dans per site.

## Lösning: auto-externalisering via lovable-assets CDN

`freeze.server.ts` skriver alltid `page.mhtml`. Vi lägger till ett steg efter font-embed:

- Om `mhtmlBytes <= THRESHOLD` (sätt 9 MB, marginal under 10 MB-gränsen) → skriv `page.mhtml` som idag (HiBob, HubSpot oförändrade)
- Om `mhtmlBytes > THRESHOLD` → kör `lovable-assets create --file <tmp/page.mhtml> --filename page.mhtml`, skriv resultatet till `corpus/<name>/page.mhtml.asset.json`. Skriv INTE `page.mhtml` till repo
- `freeze-report.json` får två nya fält: `externalized: boolean` och `externalAssetUrl: string | null`

## Reader-ändringar

**`harness.server.ts` (replayCorpus)** — där MHTML faktiskt konsumeras:

- Om `page.mhtml` finns lokalt → använd som idag
- Annars läs `page.mhtml.asset.json`, hämta `url`, ladda ner till samma `tmpDir/page.mhtml`, fortsätt replay som vanligt
- Felmeddelandet uppdateras: "varken page.mhtml eller page.mhtml.asset.json finns"

**`corpus.functions.ts` (UI inspector)** — lägg till `page.mhtml.asset.json` i `ARTIFACT_FILES` så `/corpus`-sidan visar att den finns. `mhtmlKb`-stat hämtas redan från `freeze-report.json`, så UI-siffran blir rätt utan att läsa själva mhtml-filen.

## Avgränsningar

- Inga ändringar i font-embed-logik. Vi krymper inte själva MHTML — vi flyttar bara stora till CDN
- Tröskel 9 MB är hårdkodad i `freeze.server.ts`. Inga env-variabler
- Ingen retry / fallback om `lovable-assets` saknas i sandbox → freezen failar med tydligt felmeddelande (vi loggar `command -v lovable-assets`-resultat i report)
- Skärmbild (`screenshot.jpg`) och `golden.json` lämnas oförändrade — de ligger långt under gränsen
- `.gitignore`: lägg till `corpus/*/page.mhtml` ENDAST om vi också säkrar att små mhtml fortsatt commitas. Enklare: lämna `.gitignore` och förlita oss på att externalized:a siter helt enkelt inte skriver `page.mhtml`

## Verifiering efter implementation

1. **Salesforce** — frys om, bekräfta att `page.mhtml.asset.json` skapas + ingen `page.mhtml` ligger kvar lokalt + commit går igenom + replay funkar
2. **HiBob** — frys om för sanity, bekräfta att inget förändrats (under tröskel → fortfarande lokal `page.mhtml`)
3. Lägg sedan till Salesforce-spec i `corpus/sites.ts` och fortsätt med Slack/Monday/Kry enligt tidigare plan

## Tekniska detaljer

- `lovable-assets` CLI ligger på `PATH` i sandboxen (skill bekräftar detta)
- Anropet sker via `child_process.spawnSync` i `freeze.server.ts` — körs bara från CLI-script (`bun run scripts/freeze-site.ts`), aldrig från app-runtime, så Cloudflare Workers-begränsningarna gäller inte här
- CDN-URL:en (`/__l5e/assets-v1/...`) är relativ; harness måste prependa en bas-URL för att fetcha vid replay. Använd `process.env.LOVABLE_ASSETS_BASE_URL` om satt, annars läs från `.asset.json`-pekarens egna fält (CLI-output har full URL-info)
