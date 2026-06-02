## Status

Coverage-baserad `dropWrappers` implementerad. Debug-block borttaget. Väntar på verifieringskörning av teamtailor / personio / talentium.

## Lösning

`dropWrappers` släpper en wrapper bara om dess `logoCount` förklaras av summan av inner-siblings (`a._block.contains(b._block)`). Tröskel `COVERAGE_SLACK = 3` — wrappers med fler oberoende logos behålls.

Effekt:
- Teamtailor hero-wrapper (11 logos, inner 4) → diff 7 > 3 → **keep** (hero räddas).
- Teamtailor footer-yttre (8 logos, inner 4+4) → diff 0 → drop.
- Personio: hero `containsSelf:false` mot footer → inga inner-siblings → keep.

## Kvarstår (inte i scope)

- Personio carousel-dubbletter (`animate-scroll-left/right` ger 66+60 duplicerade logos för infinite scroll). Lösning: ta `max(logoCount)` av parallella scroll-block istället för att summera.
- Stars rating exposure
- `org_number` postal code FP
- Badge/logo cross-type dedup
- Geo-targeting för proxies
