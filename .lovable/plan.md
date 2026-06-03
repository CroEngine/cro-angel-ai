## Varför "Används av 10 000+ företag" inte markeras

Trust-signalen detekteras korrekt i `trustSignals.ts` (både `trusted_by` på rubriken och `customer_logos` på logotypraden) och Playwright ritar overlay-boxar i DOM:en innan skärmdumpen tas. **Men** rects som skickas tillbaka till React-klienten för rendering i `BrowserShell`-vyn filtreras hårt i `src/lib/tests/engine.server.ts` rad 370–373:

```ts
const trustOverlay = full.trustSignals
  .filter((t) => ... &&
    (t.type === "testimonial" || t.type === "review_badges" || t.type === "social_proof_count"))
```

`trusted_by` och `customer_logos` är inte med i listan → inga boxar ritas i klienten över logotyp-strippen, trots att signalerna finns i `trustSignals`-arrayen.

## Fix

I `src/lib/tests/engine.server.ts` — utöka filtret till:

```ts
(t.type === "testimonial" ||
 t.type === "review_badges" ||
 t.type === "social_proof_count" ||
 t.type === "trusted_by" ||
 t.type === "customer_logos")
```

Inga andra ändringar behövs — färger för båda typerna finns redan i `overlay.ts` (`trusted_by: #0ea5e9`, `customer_logos: #06b6d4`) och `TRUST_LABELS` täcker dem.

## Varning som är värd att verifiera efter fix

Om logotyperna på sidan är inline `<svg>` (inte `<img>`) hittar `customer_logos`-passet (rad 514–527 i `trustSignals.ts`) bara 0 logos och regeln `uniqueLogos.length >= 4` faller. Då markeras bara rubriken (`trusted_by`), inte själva logoraden. Om så är fallet behöver vi ett separat steg — säg till efter att vi sett resultatet, så utökar vi logotyp-detektionen till SVG.