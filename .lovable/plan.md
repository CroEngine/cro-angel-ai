## Mål

Lägg in en URL-mot-URL-reconciliation i breadth-smoken som kan fyra MISMATCH på en riktig harvest-divergens. Två oberoende implementationer av "hitta absoluta font-URLer" måste få förbli oberoende — annars är checken tautologisk.

## Designprincip (det här är hela poängen)

- **Fetcher = artefakt under test.** `FONT_URL_RE` och `embedMhtmlFonts` rörs INTE. Den fortsätter matcha `https?://` och missa protocol-relative `//`. Det är en (misstänkt) bugg vi vill att detektorn ska upptäcka, inte tysta.
- **Diagnostik = oberoende orakel.** Egen `url()`-extraktion i `extractFontFaceDiagnostics` med den korrekta absolut-definitionen — `^(https?:)?\/\/` (inkluderar `//`). Ingen delad helper, ingen delad regex med fetchern. DRY är fel här; vi vill att koden kan vara oense.
- **Invariant**: `M (fetcher unique abs urls) === P (diagnostik unique abs urls)`. Mismatch på en `//`-fixture är detektorns första riktiga fångst.

`FONT_URL_RE`-fixen + `//`-fetch/embed/replay-validering = **separat commit senare**, ihop med replay-frågan. Inte den här rundan.

## Ändringar

### 1. `src/lib/tests/snapshot/mhtml-fonts.server.ts`

- `FONT_URL_RE` och `embedMhtmlFonts`: **orörda**.
- Utöka `FontFaceDiagnostic` (klassificering körs inuti `extractFontFaceDiagnostics`, oberoende kod-väg):

```ts
export interface FontFaceDiagnostic {
  family: string;
  hasRemoteSrc: boolean;
  hasAbsoluteHttpUrl: boolean;    // NYTT — face har minst en url() som matchar ^(https?:)?//
  hasOnlyRelativeUrl: boolean;    // NYTT — face har url() men ingen absolut per def ovan
  hasLocalOnly: boolean;
  hasMetricOverrides: boolean;
  absoluteUrls: string[];         // NYTT — råa absoluta url()-värden (https://..., http://..., //...)
}
```

- I diagnostik-klassificeraren: lokal url()-extraktion (egen liten parser/regex för `url\((['"]?)([^)'"]+)\1\)`), egen absolut-check `/^(https?:)?\/\//`. Skriv den medvetet som en separat implementation från fetcherns — kommentera varför ("oracle for cross-impl reconciliation; do not share with FONT_URL_RE").

### 2. `scripts/breadth-smoke.ts`

Efter `extractFontFaceDiagnostics`:

```ts
const allAbs = new Set<string>();
for (const d of diags) for (const u of d.absoluteUrls) allAbs.add(u);
r.b1UniqueAbsUrls = allAbs.size;
r.b1AbsUrlSet = [...allAbs].sort();
r.faceAbsoluteHttp = diags.filter(d => d.hasAbsoluteHttpUrl).length;
r.faceRelativeOnly = diags.filter(d => d.hasOnlyRelativeUrl).length;
```

Summary-block, harmonisering som **invariant** (inte tautologi):

```
  Harmonisering (B1-diag vs B2b-fetcher, oberoende implementationer):
    b1_remote_faces        = N
    b1_faces_w_abs_url     = X    (beskrivande)
    b1_faces_relative_only = Y    (beskrivande, → MHTML-inline)
    b1_unique_abs_urls     = P    ← diagnostik-oraklet (https?:// eller //)
    b2_absolute_urls       = M    ← fetcher-harvest (https?:// only)
    invariant: P == M → [OK | MISMATCH]
```

Vid `MISMATCH`: dumpa set-diffen (`P \ M` och `M \ P`) till `/tmp/corpus-breadth/<site>/harmonization-diff.json`. Inte hård-fail — synligt och loggat så en växande korpus avslöjar gapet (förväntat utfall första gången en `//`-URL dyker upp i en site).

### 3. `src/lib/tests/snapshot/__tests__/fetch-records.test.ts`

Tre nya tester (totalt 11):

1. **Klassificering, relativ**: `url("/fonts/x.woff2")` → `hasOnlyRelativeUrl=true, hasAbsoluteHttpUrl=false, absoluteUrls=[]`.
2. **Klassificering, absolut https**: `url("https://cdn.example/x.woff2")` → `hasAbsoluteHttpUrl=true, absoluteUrls=["https://cdn.example/x.woff2"]`.
3. **End-to-end MISMATCH-fixture** (det här är detektorns valideringstest): bygg en minimal MHTML-fixture med ett `@font-face` som har `src: url(//cdn.example/proto-rel.woff2)`. Kör både diagnostik och fetcher-harvest på samma fixture. Assertera:
   - Diagnostik: `absoluteUrls` innehåller `//cdn.example/proto-rel.woff2` (eller motsv. kanoniserad form), `P = 1`.
   - Fetcher: `FONT_URL_RE` matchar inte → `M = 0`.
   - Reconciliations-funktionen (utbruten ren funktion `reconcile(P, M) → {ok, onlyInP, onlyInM}`) returnerar `ok=false, onlyInP=[…/proto-rel.woff2]`.

   Testet validerar end-to-end att detektorn fyrar på riktig data, inte bara att diff-rapporteringen formatterar rätt.

## Det här ändrar inte

- `FONT_URL_RE`, `embedMhtmlFonts`, fetch/embed-vägen, cid:-rewrite.
- B1-rensning (`extractEmbeddedFamilies`), `hasRemoteSrc`-filter, kontroll-prober, guard-klassificering, completeness-assert.
- De 8 existerande fetch-records-testerna.

## Vad som skjuts till en egen commit (medvetet)

- `FONT_URL_RE` → matcha `//` + normalisera vid fetch.
- Validera att `//`-fonter resolvar vid replay (öppna replay-frågan).
- Det här blir en beteendeändring i fetch/embed som ska valideras vid replay, inte smygas in i en diagnostik-runda.

## Förväntad effekt

- **Stripe/Intercom/Vercel** (nuvarande corpus, ingen `//`): `P == M` → OK × 3. Identiska siffror som idag i M, P speglar samma värden eftersom datan inte har `//`.
- **Test #3** fyrar MISMATCH på konstruerad `//`-fixture → detektorn är validerad mot ett verkligt positivt utfall.
- När en framtida site har `//`-fonter: breadth-smoke fyrar MISMATCH, set-diffen pekar exakt på URLerna fetchern missar → input till `FONT_URL_RE`-commiten.

## Kör efter implementation

1. `bunx vitest run fetch-records.test.ts` — 11/11 (inkl. MISMATCH-testet).
2. `bunx vitest run src/lib/tests/snapshot` — pre-existing Chromium-bug i hubspot ignorerad som tidigare.
3. `bun run scripts/breadth-smoke.ts` — invariant OK × 3.
