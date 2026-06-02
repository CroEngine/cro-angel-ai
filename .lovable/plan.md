
## Problem

Trust signals ritas idag bara som overlay på den **live** sidan (via `OVERLAY_FN` i pageAudit-steget). När sessionen fryses visas screenshoten från **collect**-steget med bara CTA-overlays — inga trust-markörer. Användaren ser därför aldrig testimonials, badges eller social proof count i den frusna vyn.

## Lösning

Låt pageAudit-steget exponera trust signals som `overlayElements` (samma form som collect gör för CTAs). `BrowserShell` slår sedan ihop dem med CTA-overlayen och Viewport ritar boxar för båda lagren ovanpå collect-screenshoten.

## Verifierat

- **Rect-format**: `TrustSignal.rect` och `CollectedElement.rect` är båda `Rect = { x, y, w, h }` (schema.ts). Viewport.tsx läser `el.rect.x / .y / .w / .h` — matchar. Inga `left/top/width/height` blandas in.
- **Immutable merge**: pageAudit-overlays appendas via `setFrozen(prev => prev ? { ...prev, overlayElements: [...prev.overlayElements, ...trustOverlay] } : prev)`. Ingen mutation av arrayen.

## Ändringar

### 1. `src/lib/tests/engine.server.ts` — pageAudit emitterar overlayElements

I `case "pageAudit"`, efter att `trustPairs` byggts, bygg också en `overlayElements`-array och inkludera i `data`:

```ts
const trustOverlay = full.trustSignals
  .filter((t) => !!t.selector && !!t.rect &&
    (t.type === "testimonial" || t.type === "review_badges" || t.type === "social_proof_count"))
  .map((t) => ({ selector: t.selector!, category: t.type, rect: t.rect! }));

data = { ...full, overlayElements: trustOverlay };
```

Scope:t till de tre typerna användaren bad om. `!!t.rect`-filtret rensar bort schema-entries automatiskt.

### 2. `src/components/browser-shell/BrowserShell.tsx` — merga in pageAudit-overlay

I `useEffect` som lyssnar på events: behåll collect-loopen för screenshot + CTA-overlay, men lägg till en andra pass som plockar `overlayElements` från senaste `pageAudit`-step och appendar immutabelt till befintlig `frozen.overlayElements`. Behåll collect-screenshoten (pageAudit tar ingen ny).

### 3. `src/components/browser-shell/Viewport.tsx` — färger för trust-typer

Utöka `CATEGORY_COLORS` med entries för `testimonial` (#f97316), `review_badges` (#a855f7), `social_proof_count` (#f43f5e) — samma värden som redan finns i `scripts/overlay.ts` `OVERLAY_FN` så live- och frozen-vyn matchar.

## Filer

- `src/lib/tests/engine.server.ts` (lägg `overlayElements` på pageAudit-data)
- `src/components/browser-shell/BrowserShell.tsx` (merga pageAudit-overlay in i frozen)
- `src/components/browser-shell/Viewport.tsx` (lägg trust-färger i `CATEGORY_COLORS`)

Scoring, schema och trustSignals-scriptet är oförändrade.


Skär bort karussel-bruset i `trustSignals` och städa de tre småfelen som blev kvar i audit-JSON:en. Inga ändringar i scoring-motorn — bara i de browser-scripts som producerar rådata, samt VH-dedupen.

## Ändringar

### 1. `src/lib/tests/scripts/trustSignals.ts` — filtrera offscreen stars

Inuti `push()`, INNAN `getBoundingClientRect()`-värdena konverteras till `{ x, y, w, h }`-rect, läs raw-recten från elementet och droppa stars som ligger utanför viewporten horisontellt:

```js
if (type === 'stars') {
  const raw = block.getBoundingClientRect();
  const viewportW = window.innerWidth || 1280;
  if (raw.left >= viewportW || raw.right <= 0) return;
}
```

Viktigt: använd `raw.left` / `raw.right` från `getBoundingClientRect()`, inte den konverterade `rect.x` (som är scrollX-justerad och inte längre har `.left`/`.right`). Påverkar bara `type === 'stars'`, andra typer behåller nuvarande beteende.

### 2. `src/lib/tests/scripts/trustSignals.ts` — trimma `social_proof_count`-text

I stat-blocket (raden `push('social_proof_count', numText + ' — ' + label, ...)`):

- Bygg en kort label genom att leta första matchningen av `STAT_KEYWORDS` i container-texten och plocka 2–3 ord runt den, istället för hela `container.innerText`.
- Fallback: bara `numText` om ingen keyword hittas.

Resultat: `"845 000 — Rekryteringar"` i stället för hela wrapper-texten.

### 3. `src/lib/tests/scripts/trustSignals.ts` — tunnare schema-entries

I de två schema-pushes (raderna `push('review_rating', ..., document.body, 'schema', ...)` och `push('contact_info', 'Schema Organization contact', document.body, 'schema')`), samt AggregateRating-microdata-pushen där `source === 'schema'`:

Lägg en post-process precis innan `return filtered`:

```js
for (const e of filtered) {
  if (e.source === 'schema') { delete e.rect; delete e.selector; }
}
```

Schema-entries är fakta, inte DOM-element — rect (0,0,docW,docH) och tom selector är brus.

### 4. `src/lib/tests/scripts/visualHierarchy.ts` — fixa dedupe på h1/p-dubbletter

Nuvarande nyckel innehåller `tagName`, så `<h1>X</h1>` och `<p>X</p>` med samma text aldrig kolliderar. Ta bort tagName ur nyckeln:

```js
const key = text + '|' + Math.round(s.fontSize) + '|' + Math.round(s.area / 1000);
```

Två element med samma text, fontSize och area-bucket räknas nu som en.

### 5. `src/lib/tests/schema.ts` — gör `rect` och `selector` valfria på `TrustSignal`

Eftersom schema-entries nu kan sakna båda fälten. Markera dem som `?:` på `TrustSignal`. Verifiera snabbt i `audit-helpers.ts` att inga `t.rect.x`-läsningar antar närvaro utan guard (proximity-koden använder typiskt bara CTA/trust där source !== 'schema').

## Filer

- `src/lib/tests/scripts/trustSignals.ts` (filter + label-trim + schema-strip)
- `src/lib/tests/scripts/visualHierarchy.ts` (dedupe-nyckel)
- `src/lib/tests/schema.ts` (`rect?`/`selector?` på TrustSignal)
- `src/lib/tests/audit-helpers.ts` (verifiera guards på rect-läsning)

Scoring/llmContext oförändrade.
