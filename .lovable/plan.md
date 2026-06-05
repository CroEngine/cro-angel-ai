## Mål

Verifiera att replay-pipelinen (lokal Playwright + context-stabilitets-gate + Node-loop-scroll + Node-loop-cookie-stämpling) producerar **deterministiska OCH korrekta** goldens — först hibob (känd baseline: 103 element), sen hubspot (ny).

## Steg

### 1. Generera goldens
```bash
SNAPSHOT_UPDATE=1 bun run vitest run src/lib/tests/snapshot/__tests__/snapshot.test.ts
```
Förväntat: båda corpora replayar utan "Execution context was destroyed". `navHistory=[]` är **inte** ett framgångskriterium — om commit skedde och gaten höll så att diff är tom, gjorde gaten exakt sitt jobb. Döm på diff, inte på commit-frånvaro.

### 2. Korrekthets-anchor mot baseline (hibob)
```bash
jq '.collect.count' corpus/hibob/golden.json
jq '.pageAudit.ctas | length, .pageAudit.sections | length' corpus/hibob/golden.json
```
- `collect.count` ska ligga kring **103** (kända baseline). Avvikelse > ±10% = restruktureringen ändrade vad som samlas, även om det är stabilt. Stoppa och utred innan determinism-check.
- CTAs/sections rimliga (> 0, samma storleksordning som tidigare).

### 3. Determinism — 5 körningar, jämför actuals mot varandra
```bash
for i in 1 2 3 4 5; do
  bun run vitest run src/lib/tests/snapshot/__tests__/snapshot.test.ts || echo "RUN $i RÖD"
  cp corpus/hibob/actual.json /tmp/hibob.$i.json 2>/dev/null
  cp corpus/hubspot/actual.json /tmp/hubspot.$i.json 2>/dev/null
done
for site in hibob hubspot; do
  for i in 2 3 4 5; do
    diff <(jq -S . /tmp/$site.1.json 2>/dev/null) <(jq -S . /tmp/$site.$i.json 2>/dev/null) > /dev/null \
      && echo "$site run $i == run 1" || echo "$site run $i DIFFERS"
  done
done
```
Två gröna räcker inte för en commit-timing-flake (kan vara 1-på-5). Vi jämför körningar mot varandra, inte bara mot golden — annars kan vi inte skilja "golden är outliern" från "körningarna är inbördes inkonsekventa".

Notera: om `actual.json` inte skapas är diff tom (testet skriver bara `actual.json` vid icke-tom diff). Det betyder grön körning — `cp ... 2>/dev/null` swallowar saknad fil.

### 4. Sanity-check hubspot-golden
```bash
jq '.collect.count, .pageAudit.ctas | length, .pageAudit.sections | length, .pageAudit.trustSignals | length' corpus/hubspot/golden.json
```
Hubspot saknar baseline — rimlighetscheck: collect.count i hundratals, CTAs > 5, sections > 5. Om "Accept All"/"Decline All" syns som CTAs → notera för separat consentSelector-PR.

## Beslutspunkter — koppla symptom till rätt spak

| Symptom | Spak | Inte spaken |
|---|---|---|
| Replay kraschar | Läs felet, rapportera. Ingen patch utan diagnos. | — |
| collect.count på hibob ≠ ~103 | Stoppa, jämför vilka element-typer som saknas/lagts till. | Determinism-checken |
| Inbördes diff mellan körningar, `seenUrls` visar commit | Hårdna gaten: höj `need` (2→3), längre `gapMs`, eller längre post-gate settle. | Scroll-parametrar |
| Inbördes diff, `seenUrls=[]`, diff sitter i sections/visualHierarchy | Scroll-täckning instabil: öka scroll-gap (150→250ms) eller fler steg. | Gaten |
| Inbördes diff i timing-känsliga fält (auditedAt, dynamiska IDs) | Normalize-bug: lägg till stripp i `normalize.ts`. | Replay-koden |
| Cookie-bannerns knappar syns som CTAs i hubspot-golden | Notera. Separat PR med consentSelector vid freeze. | Denna körning |

## Vad denna körning inte gör

- Ingen kod-ändring om inget kraschar.
- Inga nya corpora.
- Ingen commit av golden.json — du granskar manuellt efter steg 3 är grönt.
