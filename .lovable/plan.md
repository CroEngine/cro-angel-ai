# Fix: matcha G2-badges via src-path

## Vad debug-datan visade

Teamtailors badges är `<img>` på `top: 1774`:
- `src` = `/assets/api/badges/file/RecruitmentPlatforms_Leader_…svg`
- `alt = ""`, `w = 288, h = 128` (landscape ~2.25:1)
- parent `<li class="basis-1/2-gap-4 lg:basis-1/5-gap-4 …">` (5 i rad)

Befintliga detektorer missar pga: BADGE_TITLES söks bara i `alt` (tomt), och shape-fallbacken kräver portrait (badges är landscape).

## Lösning

### 1) Lägg till path-baserad badge-signal

I `src/lib/tests/scripts/trustSignals.ts` runt rad 474:
```ts
const BADGE_PATH = /\/badges?\/(file\/)?/i;
```

I `badgeImgs.filter()` (~rad 481-493), lägg till en gren efter `BADGE_BRANDS`:
```ts
if (BADGE_PATH.test(src)) return true;
```

URL-segmentet `/badges/` är konventionen för G2/Capterra/Trustradius self-hosted badges. Snävt och säkert — inga fria ord i regexen.

### 3) Ta bort shape-fallbacken (block 3c)

Path-grenen täcker Teamtailor utan shape-heuristik. Shape-fallbacken hade portrait-bias och var en gissningsstrategi som inte triggade i praktiken. Ta bort hela block 3c plus `nearestHeadingText`-hjälparen.

Om vi senare ser sajter där varken keyword eller path triggar — bygg tillbaka shape-fallbacken då, utan portrait-krav.

### 4) Rensa debug-koden

- `src/lib/tests/scripts/trustSignals.ts`: ta bort `// TODO badge-debug`-blocket före `return`, återställ till `return filtered;`.
- `src/lib/tests/runners/pageAudit.server.ts`: återställ `trustTyped = trustSignals as TrustSignal[];` och ta bort `_badgeDebug` från return.

## Inte i scope (medvetet skippat)

- Utvidga `BADGE_TITLES` till att söka i `src` — risk för false positives (`leader`, `best`, `top rated` är vanliga ord i bild-URL:er av andra anledningar). Om path-fixen inte räcker för någon sajt → bygg ett snävt regex mot kända G2/Capterra filnamnsmönster, inte fria ord.

## Filer som ändras

- `src/lib/tests/scripts/trustSignals.ts`
- `src/lib/tests/runners/pageAudit.server.ts`

## Verifiering

Teamtailor: 1 `review_badges`-entry med `badgeCount: 5`, `detectionMethod: 'keyword'`.
Personio / Talentium: ingen regression.
