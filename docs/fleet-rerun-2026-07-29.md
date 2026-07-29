# Flottomkörning på slutliga kedjan — aggregatet som saknades

Kedjeversion: superset-regeln (gateClean ⊃ applicable) + viewport-fixen (390×844 genom hela render-vägen) + browser-först-frysningen. Baslinjer att jämföra mot (ADR-002): 52 % verifierade på 254 (v1 fri generering), 61 % day0-105 (v1), 55 % day0-105 (v2-endast).

### Hela flottan (254 sajter)

| mått | antal | andel |
|---|---:|---:|
| capture ok (status=ok) | 212 | 83.5 % |
| **verifierad variant** (inkl. fallback) | **112** | **44.1 %** |
| — varav via reserv-/placeringsstegen (fallback) | 13 | 11.6 % av verifierade |
| verifierad-andel av capture-ok | 112 | 52.8 % |
| **yield: ≥1 grind-rent drag i menyn** | **97** | **38.2 %** |
| yield: meny fanns alls (katalogväg) | 137 | 53.9 % |
| plan via katalog/selector | 130 | 94.9 % av katalogplaner |
| plan via katalog/floor (golvet) | 7 | 5.1 % av katalogplaner |
| plan via fria designern | 75 | 29.5 % |

Utfallsfördelning: verified 112 · gate_fail 52 · rejected_by_validation 33 · designer_empty 25 · not_applicable 15 · freeze_failed 10 · thin_page 7

Menystorlek: ingen katalogväg: 117 · 1: 39 · 2: 19 · 3: 30 · 4+: 49

Kandidattratten (summerad över 137 sajter med katalogväg): genererade 511 → applicerbara 435 (85.1 %) → grind-rena 276 (54 %)

### Day0-105 (jämförbar med ADR-002-baslinjerna) (104 sajter)

| mått | antal | andel |
|---|---:|---:|
| capture ok (status=ok) | 96 | 92.3 % |
| **verifierad variant** (inkl. fallback) | **58** | **55.8 %** |
| — varav via reserv-/placeringsstegen (fallback) | 4 | 6.9 % av verifierade |
| verifierad-andel av capture-ok | 58 | 60.4 % |
| **yield: ≥1 grind-rent drag i menyn** | **55** | **52.9 %** |
| yield: meny fanns alls (katalogväg) | 79 | 76 % |
| plan via katalog/selector | 75 | 94.9 % av katalogplaner |
| plan via katalog/floor (golvet) | 4 | 5.1 % av katalogplaner |
| plan via fria designern | 17 | 16.3 % |

Utfallsfördelning: verified 58 · gate_fail 26 · rejected_by_validation 9 · designer_empty 4 · freeze_failed 3 · not_applicable 3 · thin_page 1

Menystorlek: ingen katalogväg: 25 · 1: 21 · 2: 8 · 3: 16 · 4+: 34

Kandidattratten (summerad över 79 sajter med katalogväg): genererade 314 → applicerbara 275 (87.6 %) → grind-rena 183 (58.3 %)

### Breda korpusen (150 sajter)

| mått | antal | andel |
|---|---:|---:|
| capture ok (status=ok) | 116 | 77.3 % |
| **verifierad variant** (inkl. fallback) | **54** | **36 %** |
| — varav via reserv-/placeringsstegen (fallback) | 9 | 16.7 % av verifierade |
| verifierad-andel av capture-ok | 54 | 46.6 % |
| **yield: ≥1 grind-rent drag i menyn** | **42** | **28 %** |
| yield: meny fanns alls (katalogväg) | 58 | 38.7 % |
| plan via katalog/selector | 55 | 94.8 % av katalogplaner |
| plan via katalog/floor (golvet) | 3 | 5.2 % av katalogplaner |
| plan via fria designern | 58 | 38.7 % |

Utfallsfördelning: verified 54 · gate_fail 26 · rejected_by_validation 24 · designer_empty 21 · not_applicable 12 · freeze_failed 7 · thin_page 6

Menystorlek: ingen katalogväg: 92 · 1: 18 · 2: 11 · 3: 14 · 4+: 15

Kandidattratten (summerad över 58 sajter med katalogväg): genererade 197 → applicerbara 160 (81.2 %) → grind-rena 93 (47.2 %)

### Topp-vägransorsaker (100 hållna med capture ok)

- 18 × an inserted block is not hit-testable after apply (covered or hidden) — it helps no one
- 15 × op-mål/sektion kunde inte upplösas på sidan (v3 fail closed)
- 14 × 1 move(s) have no valid previous sibling to land above — the snippet fails the whole variant on this (unservab
- 7 × targetId "sec-2-section" is not an existing section (invented)
- 7 × 0 conversion CTAs were hit-testable before apply — the CTA gate was vacuous (no extracted CTAs and no goal tex
- 6 × targetId "sec-3-section" is not an existing section (invented)
- 3 × targetId "sec-8-features" is not an existing section (invented)
- 3 × 1 move(s) did not lift their section (DOM order ≠ visual order) — the snippet's reorder self-check rolls the w
- 3 × targetId "sec-5-section" is not an existing section (invented)
- 3 × targetId "sec-7-section" is not an existing section (invented)
- 2 × move set is a net no-op — the moves cancel each other out and the page ends unchanged
- 2 × targetId "sec-3-features" is not an existing section (invented)
