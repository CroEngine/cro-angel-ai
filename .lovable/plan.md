## Mål
Lägg till `ogUrl` och `canonicalMatchesOgUrl` i `indexability`. Själva flaggan `canonical_og_url_mismatch` byggs i `flag-rules.ts` senare (tillsammans med WCAG-flaggorna) — runnerns `flags: []` förblir tom enligt befintlig "collect-only" arkitektur.

## Filer & ändringar

### 1. `src/lib/tests/scripts/pageAudit.ts` (browser-script)
I indexability-blocket (rad 97–117), efter `selfNorm`:

```js
const ogUrlRaw = og('og:url') || '';
const ogUrlNorm = ogUrlRaw ? normalizeUrl(ogUrlRaw) : '';
```

Lägg till två fält i `indexability`-objektet:
```js
ogUrl: ogUrlRaw || null,
canonicalMatchesOgUrl:
  (canonicalNorm === '' || ogUrlNorm === '') ? true :
  canonicalNorm === ogUrlNorm,
```

Sant-default när någondera saknas → flaggan i flag-rules.ts gate:as ändå på att båda finns, så det är säkert.

### 2. `src/lib/tests/schema.ts`
Utöka `indexability`-typen (rad 356–364) med:
```ts
ogUrl: string | null;
canonicalMatchesOgUrl: boolean;
```
(Inte optional — scriptet sätter alltid värden.)

### 3. `src/lib/tests/runners/pageAudit.server.ts`
**Ingen ändring.** `flags: []` förblir tom. Flaggan `canonical_og_url_mismatch` implementeras i `flag-rules.ts` (kommande PR) med villkoret:
```
indexability.ogUrl && indexability.canonicalUrl && indexability.canonicalMatchesOgUrl === false
```

## Verifiering
Kör audit mot HiBob. Förväntat i JSON:
- `indexability.ogUrl`: någon hibob.com-URL
- `indexability.canonicalUrl`: en annan URL
- `indexability.canonicalMatchesOgUrl: false`

Flaggan dyker upp först när flag-rules.ts är på plats.

## Filer
- `src/lib/tests/scripts/pageAudit.ts`
- `src/lib/tests/schema.ts`
