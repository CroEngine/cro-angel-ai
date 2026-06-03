## Mål

Lägg till `techStack._debug` med rådata så vi i nästa körning kan se exakt vad evaluate-scopet samlade in — utan att gissa varför detektion eller first-party-räkning ser fel ut.

## Ändringar

**`src/lib/tests/scripts/pageAudit.ts`** (enda filen som rörs)

I evaluate-scopet, efter att `scriptUrlMap` är fylld och `baseDomain` är definierad — bygg ett `_debug`-objekt och inkludera det i `techStack`:

```js
const _debug = {
  allScriptUrls: Array.from(scriptUrlMap.keys()),
  domScriptCount: 0,
  resourceTimingCount: 0,
  locationHostname: location.hostname,
  locationBaseDomain: pageBase,
};
for (const srcType of scriptUrlMap.values()) {
  if (srcType === 'script') _debug.domScriptCount++;
  else if (srcType === 'resource_timing') _debug.resourceTimingCount++;
}
```

Lägg `_debug` sist i `techStack`-objektet med en kommentar `// DEBUG — ta bort när detektionen är stabil`.

**`src/lib/tests/schema.ts`**

Utöka `techStack` i `PageAuditData` med ett optional fält:

```ts
_debug?: {
  allScriptUrls: string[];
  domScriptCount: number;
  resourceTimingCount: number;
  locationHostname: string;
  locationBaseDomain: string;
};
```

Optional så det enkelt kan tas bort senare utan att bryta gamla rapporter.

## Inte i denna PR

- Inga ändringar i flag-rules, UI, runners eller PSI.
- `_debug` används inte i någon downstream-logik — bara observerbart i JSON-output.

## Verifiering

Efter körning på HiBob ska `techStack._debug` finnas i JSON med icke-tom `allScriptUrls`, och `domScriptCount + resourceTimingCount` ska motsvara `allScriptUrls.length`.
