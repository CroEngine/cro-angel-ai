# C2 Hubspot-only — macOS handoff

**Branch-status:** verifierings-branch, **inte merge-kandidat**. Hubspot ensam, hibob `it.skip`-patchad. Mergar du till main förblir main röd på hibob.

## Vad sandbox redan gjort

Riktig (icke-dry-run) freeze körd. `corpus/hubspot/`:

| Fil | Storlek | Status |
|---|---|---|
| `page.mhtml` | 6967 kB | ✅ embedded (1878 → 6804 kb, ≈3.6×) |
| `freeze-report.json` | — | ✅ alla gates gröna |
| `meta.json` | — | ✅ regenererad |
| `screenshot.jpg` | 558 kB | ✅ regenererad |
| `golden.json` | 52 kB | ⚠️ **stale** — macOS skriver över |

### Gate-readouts (från freeze-report.json)

| Fält | Värde |
|---|---|
| `externalFontSrcCount` | `0` |
| `embeddedFontCount` | `31` |
| `fontFetchFailures` | `[]` |
| `mhtmlKbBeforeFontEmbed → mhtmlKb` | `1878 → 6804` |
| `consent.dismissedAfterMs` | `1858` |
| `consent.dismissCheck` | `hidden` |

### Skip-patch

`src/lib/tests/snapshot/__tests__/snapshot.test.ts` använder loop (`for (const name of sites)`), så skippen är inline:

```ts
const run = name === "hibob" ? it.skip : it;
run(name, async () => { ... });
```

Skippat test skriver inget → hibob-golden ska inte röras vid `SNAPSHOT_UPDATE=1`.

## Steg du kör på macOS

### 1. Regenerera hubspot-golden

```bash
SNAPSHOT_UPDATE=1 bun run snapshot
```

Logga ska innehålla `[replay] fonts: { families: [...], loaded: [...] }` — **spara den**, det är B-prob-baseline för cross-env-jämförelsen.

### 2. Verifiera att bara hubspot-golden rörts

```bash
git status
```

**Ska visa:** `corpus/hubspot/golden.json` modified.
**Får INTE visa:** `corpus/hibob/golden.json`. Dyker den upp tog inte skippen → kör:

```bash
git checkout corpus/hibob/golden.json
```

…innan commit. Annars smyger en fallback-replay av stale fontlös hibob-MHTML in i branchen och förorenar exakt det vi isolerar.

### 3. Verifiera att hubspot-golden faktiskt ändrades

```bash
git diff corpus/hubspot/golden.json | head -50
```

Tom diff = `SNAPSHOT_UPDATE=1` regen skedde inte → felsök lokalt, inte i CI. Förväntad diff: `area`/`yBand`-värden reflekterar embedded-font-layout, consent/content rena.

### 4. Commit + push

```bash
git add corpus/hubspot/golden.json
git commit -m "C2: regenerate hubspot golden against embedded-font MHTML"
git push origin <branch>
```

## Vad sandbox-commiten innehåller (redan staged av build mode)

- `corpus/hubspot/page.mhtml`
- `corpus/hubspot/meta.json`
- `corpus/hubspot/freeze-report.json`
- `corpus/hubspot/screenshot.jpg`
- `src/lib/tests/snapshot/__tests__/snapshot.test.ts` (it.skip-patch)
- `.lovable/c2-handoff.md` (denna fil)

Sandbox-commiten taggas `[skip ci]` så bara macOS-pushen (med golden) triggar verdikt-CI.

## PR-body — tolkningsguide

Läs i denna ordning:

1. **Scope:** verifierings-branch, hubspot-only, hibob skippad. Inte merge-kandidat.
2. **A2-mekanism:** post-capture MHTML rewriter med `cid:`-parts → självbärande artefakt → env-invariant replay. Implementerad i `src/lib/tests/snapshot/mhtml-fonts.server.ts`.
3. **Gate-readout** (tabell ovan) — bevis på embedding.
4. **Hur CI-diffen läses (B-prob primär, diff sekundär):**
   - **Först:** jämför `[replay] fonts: {families, loaded}` Linux CI vs macOS-baselinen ovan. Skillnad = en font faller tillbaka på en env → diagnos klar, diff är sekundär bekräftelse.
   - **Identiska families på båda env** → diff är legitim residual drift (line-height-default, DPR, zoom). Läs **första** `area`/`yBand`-divergensen, **inte** volymen. Positionsbaserad diff utan F-aligner kaskaderar; ett tidigt fel skiftar alla efterföljande element.
5. **Exkluderat:**
   - Hibob-consent — separat utredning, geo-pinning först (egress-region varierar artefakten geografiskt).
   - Subset-optimering (bara laddade fonter istället för alla harvested) — mät bloaten per corpus först, optimera bara om absurd.
