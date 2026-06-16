## Steg ner i nästa lager: `cid:`-resolution under file:// MHTML

Bryggan är ärlig nu. Signalen som upprepas över alla tre sites:

```
gate1.reason = "unresolved"
loadError    = "A network error occurred."
diag         = { branchTaken: "load-rejected", hasDescriptorMatch: true, faceCount: 0 }
```

Det betyder: MHTML laddas, @font-face-deklarationen kommer in i `document.fonts` (descriptorn matchar), men när canaryn kör `document.fonts.load("1em Beretta", text)` så avvisar Chromium fetchen mot `url("cid:font-N@snapshot")` som nätverksfel. Cid:-schemat resolveras inte (eller resolveras till tomt) när MHTML öppnas via `file://` i pinnad Chromium.

Det är hålet under join:en, precis där du sa det skulle sitta.

### Plan: bevisa orsaken först, åtgärda sen

**Steg 1 — Diagnostik (ingen produktionskod ändras)**
Lägg till ett engångs-script `scripts/cid-probe.ts` som:
1. Öppnar `/tmp/corpus-breadth/intercom/page.mhtml` i samma Chromium-launch som canaryn använder.
2. Loggar:
   - `document.fonts.size` och alla descriptor-familjenamn
   - För första cid:-URL:en i någon `@font-face src`: `fetch(cidUrl)` → status / error
   - För samma familj: `new FontFace(name, src).load()` direkt → resultat
   - `performance.getEntriesByType("resource")` filtrerat på `cid:` — kom requesten ens iväg?
3. Dumpar till `/tmp/cid-probe.json`.

Detta avgör entydigt om Chromium tappar `cid:` i file://-MHTML, eller om vår injicerade `Content-Location: cid:font-N@snapshot`-header inte matchar `url(cid:font-N@snapshot)` (avslutande `>` / vinkelparentes-konvention).

**Steg 2 — Åtgärd, beroende på utfall**

| Probe-utfall | Åtgärd |
|---|---|
| `fetch("cid:...")` ger `net::ERR_*` | Chromium tappar cid: från file://. Byt embed-strategi till `data:`-URIs i CSS-parten. CSS-parten görs om från quoted-printable → base64 så att base64-stora `=`-tecken inte korrumperas (header-flippen sitter i `mhtml-fonts.server.ts` runt rad 720–760). |
| `fetch("cid:...")` ger 200 men FontFace.load fortfarande rejected | Cid:-resursen finns men content-type/length saknas eller är fel — fixa MHTML-partens headers (`Content-Type: font/woff2`, `Content-Length`, `Content-Transfer-Encoding: base64`). |
| FontFace.load() lyckas i proben | Buggen är inte i embedlagret utan i canaryns load-call (t.ex. sampleText-tecken utanför unicode-range). Då blir det en orakelfix i `render-canary.server.ts`, inte i embeddern. |

**Steg 3 — Verifikation**
Kör `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/bin/chromium bun run scripts/breadth-smoke.ts` igen. Förväntat: `Gate1: N/N registered · classification: {"OK": N}` för intercom, eller en handfull kvarvarande misses med ny, mer specifik `reason` (t.ex. `coverage_exclusion`) — inte längre uniform `unresolved`.

### Inget kodlager ändras innan probet är kört
Probet ger oss en hård observation att bygga åtgärden på, istället för att gissa mellan cid:-vs-data:-spåret.