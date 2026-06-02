## Status

Top-level coverage-fix implementerad. `_debug` återinfört temporärt. Cleanup i separat commit efter verifiering.

## Lösning

`dropWrappers` använder nu **top-level inner-siblings** (inner-block som inte själva ligger inuti ett annat inner-block) och `>= COVERAGE_SLACK` med tröskel 2 för stabilitet mot lazy-load.

Effekt:
- Teamtailor hero(11): top-level=[yttre 8] → diff 3 >= 2 → **keep**.
- Teamtailor footer-yttre(8): top-level=[4a, 4b] → diff 0 → drop.
- Personio: oförändrat (inga inner-siblings för hero).

## Verifiering

Kör teamtailor / personio / talentium och läs `_debug.diff` + `topLevelInnerCounts`.

## Nästa steg

Efter bekräftad fix: separat commit som tar bort `_debug`-blocket.

## Inte i scope

- Personio carousel-dubbletter (`animate-scroll-left/right` 66+60)
- Stars, `org_number` FP, badge/logo cross-type dedup, geo-proxies
