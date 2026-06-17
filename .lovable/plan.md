# Kör freeze-determinism-check mot hubspot + verifiering

Browserbase-credentials finns (`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`). Sandboxen kan köra scriptet skarpt.

## Förvarning — förväntat utfall är RED, inte GREEN

Per round3-analysen och de fyra commits + fem cleanups vi precis stängde är hubspot dokumenterad som `pending-determinism`. En körning nu reproducerar RED med hög sannolikhet — bot-tarpit-ankaret är inte whitelistat och det är *därför* hubspot är pending. Att begäran ber om att "klarar promotion-kriterierna" kolliderar med detta dokumenterade tillstånd.

Tre möjliga utfall, alla legitima:
- **RED reproduceras** (förväntat): bekräftar att narrowingen + cleanups gör sitt jobb. Diff.json round-N skrivs som ytterligare evidens. Hubspot kvar i pending.
- **AMBER**: endast 1 av 3 par driftar. Per WHITELIST verdict-logik: läs diff först, klassificera mekanism, dokumentera. Ingen auto-promotion.
- **GREEN**: bot-tarpit-ankaret råkade vara närvarande/frånvarande likformigt i alla tre runs (heuristik är icke-deterministisk). En grön körning är **inte** bevis för score-determinism — det är ett ostabilt N=3-sample. Detta noteras explicit i utfallsrapporten; pending lyfts inte på en enstaka grön.

## Steg

### 1. Sanity-check — residualer från cleanups

Statiskt verifierar (innan kostsam Browserbase-körning):
- `scripts/mechanism-inventory.ts` och `scripts/freeze-determinism-check.ts` använder båda `session-token:hubspot-laboratory` (cleanup #1 + #4).
- `fixtures/drift-survey/MECHANISM-INVENTORY.md` regenererad, ingen `ab:hubspot-laboratory`-rad.
- `corpus/README.md` "Determinism has been attempted" + `pending-determinism`.
- `fixtures/determinism/WHITELIST.md` OneTrust-raden saknar hubspot-pre-listing-meningen, Hubspot-notes-sektionen har current-status-rad, Laboratory-raden är narrowed envelope-only.
- `corpus/hubspot/meta.json` har `pending-determinism: true`.

Om något saknas → stoppa, fixa, börja om från 1.

### 2. Browserbase-körning

`bun run scripts/freeze-determinism-check.ts --name=hubspot --n=3`

Cost: 3 Browserbase-sessioner mot hubspot.com, ~5 min totalt. Skriver:
- `fixtures/determinism/hubspot/diff.json` (overskriver — tidigare round1/2/3 historiken försvinner)
- Field-level diff till stdout per drift-par

**Bevarad data:** flytta nuvarande `diff.json` till `diff.history.json` (eller append-mode) *före* körning så round1-3-evidensen behålls. Plan-default: rename till `diff.round1-3.json`; ny diff blir `diff.json`.

### 3. Tolkning + golden-check

- Läs verdict + per-par hintCounts. För varje drift-row som klassificeras `unclassified`, namnge mekanismen manuellt (tarpit-anchor förväntat).
- Verifiera `whitelistVersion`-fältet börjar med `sha256:` (cleanup #4 / commit 4 i förra rundan).
- Verifiera att Laboratory-meta-attr-driften är *frånvarande* från drift-listan (envelope maskar bort den).

För golden.json-jämförelse: kräver extractor-pass på en frisk MHTML. Letar reda på relevant script (troligen `scripts/rescore-corpus.ts` eller liknande) under exekvering — om sådant inte finns för "kör extractor mot godtycklig MHTML och jämför mot golden", noterar jag att denna del är out-of-scope för befintlig substrat och rapporterar.

### 4. Rapportera

Skriver `fixtures/determinism/hubspot/REPORT-<timestamp>.md` med:
- Verdict + driftedPairCount
- Top-15 drift-rader klassificerade per mekanism
- Score-determinism (golden-jämförelse) om gjord, annars "out of scope, no script"
- Promotion-status: oförändrad (pending) om RED/AMBER; lyfts inte på enstaka grön per förvarningen ovan

## Vad denna plan inte gör

- Lyfter inte hubspot ur pending-determinism oavsett verdict — det kräver det separata score-impact-workstream som diff.json round3 hänvisar till.
- Modifierar inte WHITELIST.md även om en ny mekanism dyker upp — rapporterar bara; widening är separat human-review-beslut.
- Försöker inte fixa bot-tarpit-injektionen (kan inte — det är hubspots egen bot-detection).
