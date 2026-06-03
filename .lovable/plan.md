# Dokumentera `schema.count` vs `schema.blocks`

## Bakgrund

På HiBob: `schema.count: 1` men `schema.blocks.length: 5`. Inte en bugg — `count` räknar `<script type="application/ld+json">`-taggar, `blocks` räknar individuella `@type`-entries (inklusive utpackade `@graph`-arrays). Utan dokumentation kommer detta att förvirra när vi skriver `flag-rules.ts`.

## Ändring

Bara JSDoc-kommentarer på schemat. Ingen logikförändring, ingen ny data, inga flags.

### `src/lib/tests/schema.ts`

Uppdatera `schema`-fältet i `PageAuditData` med kommentarer:

```ts
schema: {
  /** Antal <script type="application/ld+json"> element på sidan. */
  count: number;
  /** Unika @type-värden som hittats över alla block (inkl. @graph-utpackning). */
  types: string[];
  /**
   * Ett entry per individuellt JSON-LD-objekt. Ett enda <script>-block med
   * @graph: [...] packas upp till flera blocks här, så blocks.length kan vara
   * större än count. Använd blocks.length för per-typ-analys, count för
   * att räkna script-taggar.
   */
  blocks: Array<{
    type: string | null;
    missingRequired: string[];
    parseError: string | null;
  }>;
};
```

### `src/lib/tests/scripts/pageAudit.ts`

Lägg en kort kommentar ovanför `checkBlock` som förklarar @graph-utpackningen, så att framtida läsare ser varför `blocks.length !== ldNodes.length`:

```ts
// Ett script-block kan innehålla ett @graph-array med flera @type-objekt.
// Vi packar upp @graph och pushar ett entry per inre objekt till ldBlocks,
// så schema.blocks.length kan vara > schema.count (antal script-taggar).
```

## Vad som INTE ingår

- Inga ändringar i `flag-rules.ts` (kommer som separat steg)
- Ingen ny data, inga nya fält
- Ingen UI-ändring
- Inga ändringar i `pageAudit.server.ts`

## Verifiering

Ren TypeScript-build — inga runtime-ändringar att testa.
