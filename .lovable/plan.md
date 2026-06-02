# Markera trust signals i overlay + lätt code-cleanup

## Del 1 — Overlay för trust signals

Idag används `OVERLAY_FN` bara av `collect`-steget. `pageAudit` lägger ingen overlay alls. Varje trust signal har redan `selector` + `rect` + `type`, så det är trivialt att rita.

### Ändringar

**`src/lib/tests/scripts/overlay.ts`** — utöka `COLORS` med trust-typer (samma `Record<string,string>`-form, så vi kan återanvända samma funktion). Förslag:

```ts
testimonial:        "#f97316",  // orange
review_rating:      "#eab308",  // amber
stars:              "#facc15",  // gul
trusted_by:         "#0ea5e9",  // sky
customer_logos:     "#06b6d4",  // cyan
review_badges:      "#a855f7",  // violet
certification:     "#84cc16",  // lime
guarantee:          "#22c55e",  // grön
secure_payment:     "#14b8a6",  // teal
contact_info:       "#94a3b8",  // slate
org_number:         "#475569",  // mörk slate
press_mention:      "#ec4899",  // rosa
social_proof_count: "#f43f5e",  // röd
```

Badge-text ändras till första 2 bokstäverna av typen (`TE`, `RB`, `LO`) istället för index — då blir det självförklarande i screenshot.

Liten justering: lägg till en optional tredje del i `pairs` för badge-text:
```ts
export function OVERLAY_FN(pairs: Array<[string, string, string?]>) {
  // ...
  badge.textContent = pairs[i][2] ?? String(i + 1);
}
```

Bakåtkompat: `collect`-anroparen skickar fortfarande 2-tuples och får index som badge.

**`src/lib/tests/engine.server.ts`** — i `pageAudit`-caset (rad 339-352), efter `runPageAudit(page)`, rita overlay:

```ts
const trustPairs: Array<[string, string, string]> = full.trustSignals
  .filter((t) => !!t.selector && !!t.rect)
  .map((t) => [t.selector, t.type, badgeLabel(t.type)]);
try {
  await page.evaluate(`(${OVERLAY_FN.toString()})(${JSON.stringify(trustPairs)})`);
} catch (e) {
  onEvent({ type: "log", message: `overlay failed: ${e instanceof Error ? e.message : String(e)}` });
}
```

`badgeLabel` är en liten lookup: `testimonial → TE, trusted_by → TB, customer_logos → LO, review_badges → RB, stars → ★, …`.

Overlay läggs på sidan i Browserbase-sessionen — användaren ser den i live-iframen och i ev. screenshot som tas efter `pageAudit`-steget. Screenshot capture (om det finns) sker redan i sandbox-flödet; vi behöver inte rendera om.

### Frågor till dig

- Vill du även ha en overlay för CTAs i `pageAudit`-steget, eller bara trust? CTAs har redan stöd i `OVERLAY_FN` (`cta_primary` etc.) — då kan vi rita både i samma pass.

## Del 2 — Code cleanup (lätt)

Efter shape-fallback och debug-blocken togs bort:

| Plats | Status |
|---|---|
| `nearestHeadingText` helper | ✅ borttagen |
| `_badgeDebug` block i `trustSignals.ts` + runner | ✅ borttagen |
| `// TODO badge-debug`-markörer | ✅ inga kvar (rg-resultat tomt) |
| `dedupeSameBlock` / `dropWrappers` | Behåll — används av `trusted_by` |
| `aboveFoldLogoCount` på `TrustSignal` | Behåll — designbeslut för framtida LLM |

**Enda riktiga skräpet:**

- `detectionMethod?: "keyword" \| "shape"` i `src/lib/tests/schema.ts` — `"shape"` används aldrig längre. Trimma unionen till `"keyword"`:
  ```ts
  detectionMethod?: "keyword";
  ```
  Alternativt: ta bort fältet helt eftersom det idag bara har ett möjligt värde. Förslag: behåll fältet (självdokumenterande att det är keyword-baserat) men trimma unionen.

- `src/lib/tests/scripts/trustSignals.ts` rad 611-612: två sekventiella `let filtered = …` följt av `filtered = …` på `trusted_by` ser ut som de kunde slås ihop, men de gör olika saker (dedupe sedan wrapper-drop) — låt dem vara.

Inget annat skräp upptäckt.

## Filer som ändras

- `src/lib/tests/scripts/overlay.ts` — fler färger + valfri 3:e badge-text
- `src/lib/tests/engine.server.ts` — rita overlay i `pageAudit`-caset
- `src/lib/tests/schema.ts` — trimma `detectionMethod` till `"keyword"`

## Inte i scope

- Ny separat overlay-komponent (UI-rendering).
- Screenshot-export från sandbox — sker via befintligt flöde.
