# Freeze-fixar för identifierade motsägelser (reviderad)

Fyra fixar, en commit per fix, i fast ordning. Användarens framing antagen: 1a + 2a + 3a är grindade till varandra; whitelistVersion-pinningen är strukturell, inte kosmetisk.

## Commit 1 — Utöka confidence-schemat till fyra värden

**Filer:** `fixtures/determinism/WHITELIST.md`, `fixtures/drift-survey/SUMMARY.md`.

- Lägg till `confirmed-by-design` som fjärde värde i WHITELIST row-schema och i SUMMARY:s "Confidence is tri-state"-tabell (omdöp till fyrtillstånd).
- Definition: varians är känd a priori benign (RFC, integrationsspec, säkerhetsstandard). Oraklet up/downgraderar inte dessa rader.
- **Kritiskt:** Oraklet hoppar inte över raderna. Determinism-checken kör fortfarande mot dem; varians **utanför den dokumenterade by-design-enveloppen** ytar fortfarande som RED. Exempel som måste skrivas in: nonce-rotation är by-design, men nonce-format-förändring (längd, alfabet, attributnamn) är riktig drift och får inte maskeras av etiketten. Varje `confirmed-by-design`-rad ska därför ange envelope-formen (regex/struktur), inte bara mekanismnamnet.
- Inga rader ändrar värde i denna commit — bara schemat utökas och envelope-noter läggs till där de saknas.

Fristående. Ingen determinism-körning krävs.

## Commit 2 — Smalna Laboratory-raden, kör determinism, verifiera RED

**Filer:** `fixtures/determinism/WHITELIST.md`, `scripts/freeze-determinism-check.ts` (om mask-mönstret är hårdkodat där), ny `fixtures/determinism/hubspot/diff.json`-revision.

- Smalna raden till **enbart** `<meta name="laboratory-identifier-*" content="anon<32hex>">`-attributvärdet. Score-impact: `neutral` (det är en session-ID, inte sample-defining på egen hand). Confidence: `confirmed-drift`.
- Ta bort body-strukturklausulen ("presence/absence of tarpit-anchor right inside `<body>`") från raden. Motiv skrivs in i raden: bot-tarpit-injektion är heuristik/bot-score-driven, inte bucket-deterministisk → kategoriskt skild från Optimizely-bucket → inte en personalization-slot.
- Kör `freeze-determinism-check.ts` på de 3 stashade hubspot-MHTML:erna. Förväntan: RED med tarpit-anchor-närvaron som drift-källa. Verifiera att diff-output namnger L213-skiftet som icke-whitelistat.
- Skriv ny `diff.json`-rond ("round3_post-narrowing") med utfallet. Behåll round1/round2 oförändrade — de är historisk evidens.

Får inte gå vidare till commit 3 om körningen inte ytar RED — då har vi missförstått mekanismen och måste backa.

## Commit 3 — Markera corpus/hubspot/ som pending-determinism

**Filer:** `corpus/hubspot/` (ny `PENDING.md` eller flagga i `meta.json`), `corpus/README.md`.

- Framtvingat av commit 2. Hubspot uppfyller inte promotion-kriteriet i `corpus/README.md` (N≥3 freezes, 0 unexpected-drift) så länge body-strukturen ytar RED.
- Lägg `pending-determinism: true` (eller motsvarande explicit fält) i `corpus/hubspot/meta.json` med pekare till `fixtures/determinism/hubspot/diff.json` som evidens.
- Uppdatera `corpus/README.md`: lista `pending-determinism` som ett distinkt corpus-tillstånd (skild från `promoted`). Promoted-listan får inte inkludera pending-medlemmar.
- Behåll filerna på disk (`golden.json`, `render-canary.families.json` etc.) — de är pre-promotion baseline för den framtida score-impact-workstreamen som diff.json hänvisar till. Ta inte bort, bara avklassificera.

Bör falla ut rent från commit 2:s output.

## Commit 4 — whitelistVersion pinnas till sha256

**Filer:** `scripts/freeze-determinism-check.ts`, eventuellt skrivande av `diff.json`.

- Ersätt strängen `"fixtures/determinism/WHITELIST.md (pre-Laboratory-row)"` med `sha256:<hex>` av WHITELIST.md vid run-tid.
- Same fix-klass som breadth-corpus sha256-manifestet. Strängen kan då inte ljuga retroaktivt — samma sträng = samma filinnehåll, alltid.
- Backfill round1/round2/round3 i `fixtures/determinism/hubspot/diff.json` med korrekta hash-värden (round1 och round2 hashar pre-Laboratory-versionen; round3 hashar post-narrowing-versionen från commit 2).

Fristående. Kan teoretiskt köras före eller efter, men placeras sist så commit 2 och 3 inte måste sno tid med hash-bokföring.

## Vad denna plan inte gör

- Mäter inte Laboratory-mekanismens score-impact på de 3 stashade MHTML:erna. Det är den separata workstream diff.json hänvisar till; den är förutsättning för att eventuellt återöppna 2b senare, inte för denna freeze.
- Påstår inte att de identifierade motsägelserna är uttömmande. Tre + en är vad denna granskning ytat; ytterligare kan finnas och kräver separat genomgång.
- Rör inte hubspot-filerna fysiskt — markering, inte radering.
