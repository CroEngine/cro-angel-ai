# Städa upp restposter efter Laboratory-narrowing

Granskningen efter de fyra commits avslöjar fem residuala motsägelser/stale-artefakter. Alla är följdverkningar av att Laboratory-raden smalnades från `sample-defining + body-structure` till `neutral + meta-attr envelope only` — flera filer hänvisar fortfarande till den gamla framingen.

## 1. `scripts/mechanism-inventory.ts` — felaktig score-impact för Laboratory

Rad 40–44: `ab:hubspot-laboratory` står som `scoreImpact: "sample-defining"` med noten *"drives body structure variance at <body> open"*. Båda direkt motsagda av round3-narrowingen:
- Score-impact ska vara `neutral` (envelope = meta-attr value).
- Body-structure-klausulen är explicit borttagen ur WHITELIST.md.

Fix: byt till `scoreImpact: "neutral"`, skriv om noten till envelope-formuleringen och cross-referera WHITELIST.md round3. Behåll `ab:` ID-prefixet eller byt till `session-token:hubspot-laboratory` (`ab:` antyder bucket-DOM-påverkan som nu är frånskild). Förordat: byt prefixet, så taxonomin är konsistent med score-impact.

## 2. `fixtures/drift-survey/MECHANISM-INVENTORY.md` är stale

Auto-genererad 2026-06-17T21:07Z innan inventory-skriptet uppdaterats. Tabellraden för `ab:hubspot-laboratory` visar fortfarande `sample-defining`. Den ska antingen:
- (a) regenereras efter fix #1 (kräver build mode + `bun run scripts/mechanism-inventory.ts`), eller
- (b) tas bort ur commit och listas i `.gitignore` som ett rent build-artifact (samma klass som de stora drift-survey-MHTML:erna).

Förordat: (a) regenerera. Filen är liten (~kilobytes) och refereras direkt från SUMMARY.md och WHITELIST.md som autoritativ inventory — den ska finnas i tree.

## 3. `corpus/README.md` rad 70–76 — felaktig påstående om hubspot

Texten lyder: *"Determinism is proven on hubspot only. Hubspot is the representative hard case..."*. Detta är falskt post-round3. Determinism är **inte** proven på hubspot — hubspot är `pending-determinism` (samma fil, rad 90 i nya numreringen, från commit 3).

Fix: skriv om stycket till *"Determinism has been **attempted** on hubspot as the representative hard case. Current status: `pending-determinism` (see corpus/hubspot/meta.json + fixtures/determinism/hubspot/diff.json round3). Proof requires resolving the bot-tarpit body-structure drift surfaced by the narrowed whitelist."* Behåll resten av paragrafens beskrivning av N=3 + pairwise-mekaniken.

## 4. `fixtures/determinism/WHITELIST.md` OneTrust-rad — felaktig pre-listings-motivering

Rad 91: *"Pre-listed for the Grind 1 hubspot determinism-check so a RED on it reads as..."*. Men `corpus/hubspot/meta.json` säger explicit *"HubSpot's hs-eu-cookie-confirmation (eget system, inte OneTrust)"* — hubspot använder inte OneTrust. Pre-listings-motiveringen är felriktad.

Fix: ta bort "Pre-listed for the Grind 1 hubspot..."-meningen från OneTrust-raden; behåll bara `Inventory consent-cmp:onetrust`-citationen. Motiveringen var aldrig korrekt för hubspot och bör inte hänga kvar.

## 5. `fixtures/determinism/WHITELIST.md` "Hubspot-specific notes" — saknar nuvarande status

Verdict-logiken (rad ~122ff) listar GREEN/AMBER/RED-flöden men säger ingenstans att **nuvarande** verdict är RED-pending. Läsare som öppnar WHITELIST.md fristående får intrycket att Grind 1 är öppen-och-icke-körd, inte körd-och-RED.

Fix: lägg en `**Current status (2026-06-17 round3):** RED — pending-determinism. See fixtures/determinism/hubspot/diff.json round3_post_narrowing for evidence; corpus/hubspot/meta.json carries the pending flag.`-rad ovanför verdict-listan.

## Mindre (inte i scope men noterade)

- `fixtures/determinism/hubspot/diff.json` round1/round2 `whitelistVersion` är beskrivande strängar (`"sha256:pre-cid-widening (pre-existing tree state, no recorded hash)"`), inte riktiga hashar. Den retroaktiva osanning principen i commit 4 var byggd för att utesluta är nu märkt som okänd-hash — vilket är hederligt men förlorar spårbarheten. Inget rent sätt att rekonstruera utan att checka ut äldre tree-tillstånd; lämnas som-är.
- `scripts/freeze-determinism-check.ts` MECHANISM_HINTS rad ~82 har `ab:hubspot-laboratory`. Om #1 omklassificerar prefixet till `session-token:` ska hint-namnet följa med (annars är hint-output inkonsistent med inventory).

## Commit-ordning

1. Fix #1 (mechanism-inventory.ts) — fristående kodändring.
2. Fix #2 (regenerera MECHANISM-INVENTORY.md) — kräver `bun run scripts/mechanism-inventory.ts` efter #1.
3. Fix #3 + #4 + #5 (text-fixar i corpus/README.md + WHITELIST.md) — fristående, kan göras i en commit eftersom det är samma framings-residu.
4. Fix #1-följdjustering av MECHANISM_HINTS-namn i freeze-determinism-check.ts — fristående cosmetic.

## Vad denna plan inte gör

- Skapar inget nytt determinism-data (kräver Browserbase-körning som sandbox saknar).
- Rör inte hubspot-corpus-filerna fysiskt utöver `meta.json`.
- Försöker inte uttömma fler residualer — granskningen är fokuserad på Laboratory-narrowingens efterskalv.
