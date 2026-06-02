
## Mål

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
