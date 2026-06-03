## Två småfixar

### 1. Hero-detektion för aggressiv
I `src/lib/tests/scripts/sections.ts` → `classifyType()`: höj hero-cap från `viewportH * 1.5` till `viewportH * 2.5` (golv `> 200` kvar). Wrapper-filtret i `addNode()` skyddar redan mot full-page DIVs, så denna inre cap kan vara generös.

### 2. Selector-strip för trustSignals + ctas
I `src/lib/tests/runners/pageAudit.server.ts`, efter att helpers (`buildTrustSummary`, `pageSummary`, `deriveHero`) körts:

```ts
const sectionsForSnapshot = sectionsTyped.map(({ selector: _s, ...rest }) => rest);
const ctasForSnapshot = ctasTyped.map(({ selector: _s, ...rest }) => rest);
const trustForSnapshot = trustTyped.map((t) => {
  const { selector: _s, _block, ...rest } = t as TrustSignal & { _block?: unknown };
  return rest;
});
```

Använd `*ForSnapshot` i return-objektet.

**Om `_block`:** kollar först schema. `_block` läggs på dynamiskt i browser-scriptet (`trustSignals.ts` rad 148: `if (type === 'trusted_by') entry._block = block;`) och är en DOM-Element-referens. Vid `JSON.stringify` av en DOM-node returneras `{}` (eller kastar i vissa fall), så det är värt att strippa explicit. Cast via `as TrustSignal & { _block?: unknown }` undviker `any` och TS-fel om fältet inte finns i typen.

Båda ändringarna är oberoende, inga schema-ändringar.
