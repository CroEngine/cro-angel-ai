# Determinism-rapport — hubspot, round6 (2026-06-20): score-determinism GREEN

**Verdict:** **#4 (score-determinism) GREEN** efter hero-animation-fixen.
#3 (capture-determinism, byte-identisk MHTML) kvar RED men bevisat
score-neutral. Hubspot fortfarande `pending-determinism` tills #3-bruset
maskas och två oberoende gröna körs (per corpus/README.md).

## Vad som ändrades

`freeze.server.ts` (commit 6eb8599): före `goto` emuleras
`prefers-reduced-motion: reduce` (CDP `Emulation.setEmulatedMedia`) PLUS en
`Page.addScriptToEvaluateOnNewDocument` som överrider `window.matchMedia` så
hero-init-JS:en ser reduced-motion från sitt första anrop. Båda krävs:
setEmulatedMedia ensam lämnade en init-race (2/3 captures statisk hero, 1/3
fångade roterande listan på `translateY(-240px)`).

## Mätningar (N=3 oberoende Browserbase-captures)

### Hero-animation — FIXAD
Alla 3 captures: `.wf-page-header_heading-animated-list` saknas helt
(statisk hero renderas), 0 nonzero `translateY`. Tidigare (round5) varierade
den `translateY(-240px/-480px/-720px)` mellan captures — den dominanta
score-påverkande driften.

### #3 capture-determinism — RED (men score-neutral)
`scripts/freeze-determinism-check.ts --name=hubspot`: driftCount ~31k–65k/par.
Klassificerat: `animation:mid-frame-transform` ~28–42 (nu ENBART dekorativa
transforms, inte hero), `session-token:csrf` ~4–6, `laboratory` 1,
`unclassified` ~31k–65k (dominerat av per-session HubSpot-tracking-tokens
`__hstc`/`__hssc` i länk-href + bot-tarpit-ankarets randomiserade inline-style).

### #4 score-determinism — GREEN ✅
Replay av de 3 captures genom extractorn (`replayCorpus` + `normalize`),
pairwise golden-diff:
```
PAIR[0,1] diffLines=0 IDENTICAL
PAIR[0,2] diffLines=0 IDENTICAL
PAIR[1,2] diffLines=0 IDENTICAL
```
Tre oberoende captures → byte-identiska goldens. Detta är promotion-kriterium
#4 (corpus/README.md), tidigare bedömt omätbart — nu mätbart via den fungerande
replay-pipelinen (samma som canary-fixen avblockade).

## Nyckelimplikation

Eftersom #4-goldens är identiska är HELA #3-driften (~31k–65k rader) **bevisat
score-neutral** — den ändrar inte extractor-outputen. Det gör varje kvarvarande
#3-mekanism whitelist-berättigad med evidens (inte gissning):

1. `__hstc`/`__hssc`/`__hsfp` tracking-tokens i href-query → session-noise.
2. Bot-tarpit-ankaret (dolt, aria-hidden, off-flow) → randomiserad men score-neutral.
3. Dekorativa `transform: translate(...)` (icke-hero carouseller/logoremsor).
4. `laboratory-identifier` / `csrf` meta — mask verkar ofullständig, undersök.

## Väg till att lyfta pending

1. Maska de 4 bevisat-score-neutrala mekanismerna ovan i
   `src/lib/tests/snapshot/mhtml-normalize.ts` (verifiera att masken FAKTISKT
   träffar — upprepa inte A-felet: no-op-mask mot QP-wire-shape).
2. Re-run #3 → förväntat GREEN (all drift i whitelistade mekanismer).
3. Två oberoende gröna (#3 + #4) på olika dagar → lyft `pending-determinism`.

## Metodik-not (kräver human-review)

#3 (byte-identisk MHTML) är **ovinnbar** på sajter som stämplar en per-session-
token i varje länk (HubSpot `__hstc`). #4 (score-determinism) är det
load-bearing kriteriet — det är vad som faktiskt skyddar golden som stabil
regressions-baseline. Överväg att omformulera promotion-kriterierna så #4 är
primärt och #3 är "0 *oväntad* (icke-whitelistad) drift", inte "byte-identisk".
Detta är ett metodik-beslut, inte verkställt här.
