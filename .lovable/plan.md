## Plan: Gate-1 reason — diagnostikrunda (instrumentering, ingen taxonomi-ändring än)

Accepterat: Option 1 i nästa runda (`descriptor_missing` som egen reason; `check_mismatch` återinförs som strikt `distinct && !fontsCheckPass`). Splitten är ren by construction — `distinct` kräver `faceCount>0`, A2-grenen kräver `faceCount===0`, så grenarna kan inte fyra samtidigt och prioritetsordningen är irrelevant. De två fallen har olika rotorsaker och olika fixar:

- `distinct && !fontsCheckPass` → fonten renderade (bredden bevisar det), men `fonts.check` säger nej → check-strängen är icke-kanonisk. **Fix: kanonisering av check-strängen.**
- A2-no-descriptor → ingen face matchar familjen alls → den extraherade familjen är ett spöke. **Fix: `extractDeclaredFamilies`.**

### Denna runda: diagnostik only

Mål: gör reason-kompositionen bevisbar för hela körningen innan vi rör vare sig taxonomin eller embedding.

### Branch-enumet (uttömmande, inga blinda fläckar)

Persisteras per familj i `render-canary.families.json` som `diag.branchTaken` plus rådata (`loadResult.kind`, `faceCount`, `hasDescriptorMatch`, `deltaLoad`, `fontsCheckPass`, `epsilonLoadPx`). Enumet täcker hela klassificeringsgrafen, inte bara post-load-matrisen:

Load-failure-vägar (early returns idag, måste ytläggas):
- `load-rejected` (loadResult.kind === "rejected")
- `load-timeout` (loadResult.kind === "timeout")

Post-load-vägar:
- `A2-no-descriptor` (loaded, faceCount===0, !hasDescriptorMatch) → reason=check_mismatch idag
- `coverage-exclusion` (loaded, faceCount===0, **hasDescriptorMatch===true**) → reason=fallback idag, **men måste ytläggas separat** — det är unicode-range-uteslutningsfallet från v3, och dess fix är sample/range, inte extraction. Att klumpa den med `!distinct+!check` döljer exakt den distinktion diagnostiken ska hitta.
- `distinct+check` → ok
- `distinct+!check` → check_mismatch (efter Option 1: enda återstående check_mismatch)
- `!distinct+check` → metric_twin
- `!distinct+!check` (faceCount>0) → fallback (genuin fallback; skild från coverage-exclusion)

Branch-fältet skrivs som rent diagnostiskt sidofält denna runda — `reason` rörs inte än.

### Kanoniseringsassert för hasDescriptorMatch

Under Option 1 blir `hasDescriptorMatch` enda diskriminatorn mellan `descriptor_missing` och `fallback` för empty-load-rader. Då är dess kanonisering load-bearing — en under-match (returnerar false för en riktig descriptor pga kanoniseringskvirk) felrouter en coverage-exclusion till `descriptor_missing` och skickar nästa runda till `extractDeclaredFamilies` av fel skäl.

Den nya konsistenskontrollen Option 1 skapar ligger inte mellan width och fonts.check (de är redan rena, samma family + sampleText, rad 282/287–289). Den ligger mellan `hasDescriptorMatch` och resten av kedjan. Lägg därför in i samma instrumenteringspass:

- Persistera råsträngarna som faktiskt jämförs: `manifestFamily`, `descriptorFamilies[]` (efter samma `stripQuotes`/lowercase som rad 271–273), `checkString` (det `quote(family)` som går in i `document.fonts.check`), `widthString` (det `quote(family)` som går in i `measureWidth`).
- Assert: alla fyra ska kanonisera identiskt under den kanoniseringsfunktion som används för match-jämförelsen. Avvikelse loggas som `diag.canonMismatch` med vilket par som diffar. Detta är den check som faktiskt validerar Option 1:s splitt.

### Browser-pinning i kvittot

Per determinismkravet, persistera i `diag.env`:
- `chromium.path` (`/bin/chromium-browser` vs Playwright-pinnad)
- `chromium.version`
- `pinned: boolean` — false så länge vi kör mot systemets chromium

Rader med `pinned: false` räknas inte mot acceptans. Vid `deltaLoad=0.00` på familj där det inte borde inträffa, noteras explicit att utfallet kan vara en freetype/harfbuzz-artefakt och behöver en pinnad körning för att räknas.

### Körning

1. Patcha instrumenteringen i `render-canary.server.ts` (diagnostiska sidofält + kanoniseringsassert + env-block; ingen ändring av reason-grenarna).
2. Re-run hubspot + hibob i sandboxen med `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/bin/chromium-browser`.
3. Rapportera per familj:
   - branchTaken vs reason — konsistent eller inkonsistent
   - canonMismatch ja/nej
   - env.chromium + pinned

### Beslutsgrind för nästa runda

Gå vidare till Option 1-implementation först om:
- Lexend Deca verifieras ha `branchTaken=A2-no-descriptor` med `fontsCheckPass=true` och `deltaLoad=0` (bekräftar diagnosen i koden).
- `canonMismatch=false` för alla rader (annars måste kanoniseringen fixas innan splitt, annars routas coverage-exclusion fel).
- Inga andra rader visar `branchTaken` ↔ `reason`-inkonsistens utöver de två kända Option 1 löser.

### Nedströms-edits Option 1 tvingar fram (planeras nu, görs i nästa runda)

- v3:s Vitest-case i `src/lib/tests/snapshot/__tests__/render-canary.test.ts` som asserterar `check_mismatch` för typo-familjen ("Brnad") måste flippas till `descriptor_missing`. Test-first-disciplinen kräver att testet uppdateras i samma commit som taxonomi-ändringen.
- Part-A steg-3-triagetabellen behöver en `descriptor_missing`-rad med åtgärd "fixa `extractDeclaredFamilies`".
- Existerande `check_mismatch`-rader i triagedokument får ny implicit semantik (kanonisera check-strängen) och bör läsas igenom.

### Inte i denna runda

- Ingen ändring i `mhtml-fonts.server.ts`.
- Ingen taxonomi-fix (`descriptor_missing` införs i nästa plan, efter att diagnostiken bekräftat splitten).
- Ingen Lexend Deca-embedding-undersökning förrän klassificeraren är verifierad och raden har sin korrekta etikett.

### Leverabler

- Patchad `render-canary.server.ts` (diagnostiska sidofält + kanoniseringsassert + env-block, reason-grenar orörda).
- Uppdaterade `corpus/hubspot/render-canary.families.json` och `corpus/hibob/render-canary.families.json` med `diag`-block.
- Rapport: tabell över alla familjer med (reason, branchTaken, canonMismatch, env.pinned) + explicit go/no-go för Option 1.