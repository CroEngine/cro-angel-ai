# B1: Filtrera local()-only @font-face strukturellt

**Mål:** Rensa `embeddedFamilies` från `@font-face`-block som aldrig var avsedda att fetchas (Next.js `size-adjust`-fallbacks och liknande system-font-alias), så att B2-nämnaren blir "familjer med faktisk remote-`src`".

**Princip:** strukturellt filter, inte namn-regex. Vi nyckelar på vad faces *är* (ingen remote `url()`), inte vad de heter (`__Inter_Fallback_<hash>` kontra " Fallback"-suffix). Samma signal förklarar varför de inte fetchas — ett filter förenar B1-rensningen och B2-nämnaren.

**Bekräftat vs hypotes (hålls åtskilda i kommentarer/test):**
- *Bekräftat från smoke-data:* Intercom listar 26 familjer, ≥13 har `Fallback`-mönster; dessa har `src: local(...)` utan `url()`.
- *Hypotes (ej mätt utan replay):* Dessa familjer registreras ändå i `document.fonts` vid replay → är *inte* `descriptor_missing`. Gate1-impact kvantifieras först när replay kör. Filtret är ändå rätt: extractorn ska inte rapportera faces utan remote-src som "embeddable".

## Ändringar

### 1. `src/lib/tests/snapshot/mhtml-fonts.server.ts`

Uppdatera `extractEmbeddedFamilies` så att ett `@font-face`-block bara räknas om body har minst en `url(...)`-källa som *inte* är `local(...)`. Behåll också en flagga för metric-override-deskriptorer som diagnostisk signal men använd den inte ensam som filter (en face med `url()` + `size-adjust` är fortfarande en riktig remote-font).

Skiss (final form skrivs i build-läge):

```ts
const SRC_DECL_RE = /src\s*:\s*([^;}]+)/i;
const URL_TOKEN_RE = /\burl\s*\(/i;

function hasRemoteSrc(faceBody: string): boolean {
  const m = faceBody.match(SRC_DECL_RE);
  if (!m) return false;
  // url(...) räknas; local(...) ensamt räknas inte.
  return URL_TOKEN_RE.test(m[1]);
}
```

…och i loopen: `if (!hasRemoteSrc(body)) continue;` före `seen.add`.

### 2. Diagnostik (utan att ändra returtypen)

Lägg till en ny export `extractFontFaceDiagnostics(mhtmlRaw)` som returnerar per face:
`{ family, hasRemoteSrc, hasLocalOnly, hasMetricOverrides }`. Används av `scripts/breadth-smoke.ts` för att skriva en `face-diagnostics.json` per sajt — så vi kan kvantifiera B1-andelen per corpus utan att blanda in fixen i hot-path-koden.

Påverkar inte `embedMhtmlFonts` eller `FontEmbedResult`-formen. `freeze.server.ts` fortsätter använda `extractEmbeddedFamilies` oförändrat.

### 3. Tester — `src/lib/tests/snapshot/__tests__/extract-families.test.ts`

Lägg till fall som låser strukturen, inte namn:
- `src: local("Arial")` ensam → familj filtreras bort.
- `src: local("Arial"), local("Helvetica")` → filtreras bort.
- `src: local("Arial"), url("cid:x")` → behålls (mixed src, är fortfarande remote).
- `src: url("cid:x"); size-adjust: 100.06%;` → behålls (override på remote = riktig font).
- `@font-face { font-family: "__Inter_Fallback_abc"; src: local("Arial"); size-adjust: 107%; ascent-override: 90% }` → filtreras bort (täcker Next.js-mönstret strukturellt).

### 4. Smoke-script — `scripts/breadth-smoke.ts`

Skriv ut två tal per sajt i sammanfattningen:
- `extractedFamilies` (efter filter)
- `localOnlyFiltered` (antal faces filtret strök)

Detta är B2-nämnaren vi behöver för nästa runda.

## Bekräftat efteråt
- Vitest grön (befintliga + nya fall).
- Smoke-körning på intercom + stripe + vercel: `localOnlyFiltered` > 0 för intercom; `extractedFamilies` för stripe oförändrad (sohne-var har `url()`).

## Medvetet *inte* i denna runda
- Ingen replay, ingen `descriptor_missing`-omklassificering — kräver chromium-libs i sandboxen, och Gate1-impact är hypotes tills dess.
- Ingen B2-fix. B2-instrumenteringen (per-URL `{matchad-extension, fetch-försökt, utfall, bytes}`) är nästa plan, körs efter att B1-talen är rena.
- Inget namnbaserat `/ Fallback$/`-filter. Skört, fångar inte `__Inter_Fallback_<hash>`, blandar ihop "vad är detta" med "vad heter detta".
