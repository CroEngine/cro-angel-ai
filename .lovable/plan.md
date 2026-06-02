## Scope
Endast `src/lib/tests/scripts/trustSignals.ts`. Fixar att Teamtailors testimonial-stjärnor (5 identiska SVG:er utan filled/active-klasser) ger `rating: null`.

## Plan

### 1. Smartare fallback i `extractStarRating(parent)`

Behåll nuvarande prioritet attrs → text → plain-decimal. Ersätt nuvarande filled-räknare med följande kedja:

1. **Empty-stjärnor först**
   ```
   empty = parent.querySelectorAll(
     '[class*="empty" i], [class*="outline" i], [class*="inactive" i], [class*="off" i], [aria-checked="false"]'
   )
   ```
   Om `empty.length > 0` och `allStars.length` är 3–5 → `rating = clamp(allStars.length - empty.length, 0, 5)`.

2. **Filled-varianten** (befintlig logik bibehålls)
   `[class*="filled" i], [class*="active" i], [class*="full" i], [aria-checked="true"]`. Om träff och `filled.length <= allStars.length` → `rating = filled.length`.

3. **SVG inline-fill heuristik** (begränsad enligt feedback)
   Bara `node.getAttribute('fill')` — **ingen** `getComputedStyle`. Räkna stjärnor vars fill-attribut finns och inte är `none`, `transparent`, eller `rgba(0,0,0,0)`. Om antalet är 1–5 → använd det. Skippa annars.

4. **"Alla synliga stjärnor är fyllda"** (löser Teamtailor)
   Trigger endast om ALLA villkor håller:
   - `allStars.length` mellan 3 och 5
   - Inga träffar i steg 1 (`empty.length === 0`)
   - **Visibility-skydd**: `allVisible = [...allStars].filter(s => { const r = s.getBoundingClientRect(); return r.width > 0 && r.height > 0; })` och `allVisible.length === allStars.length` (filtrerar bort dolda SVG-sprites).
   - **Testimonial-context inom 3 nivåer upp**: någon ancestor matchar `blockquote`, `figure`, eller har klassnamn matchande `/testimonial|review|quote|kund|card|feedback/i`.
   
   Då: `rating = allVisible.length` (cap 5).

### 2. Robusthet

- `clamp(n,0,5)` helper för rating-värden i alla grenar.
- Behåll `reviewCount`-merge från attrs i alla return-grenar.
- Inget `getComputedStyle` introduceras (SVG-heuristiken läser bara inline-attribut).

### 3. Verifiering

- **Teamtailor (uppladdat)**: `stars`-signalen ska få `rating === 5` via steg 4 (testimonial-card-kontext + alla 5 stjärnor synliga + ingen empty-variant).
- **Loopia**: ska fortsatt inte få falsk 5:a (ingen testimonial-context → steg 4 firar inte).
- **Hero-CTA med dekorativa stjärnor**: ska inte trigga steg 4 (saknar testimonial-context-klassnamn).
- Sanity via `jq`: inga rating < 0 eller > 5, inga `NaN`.

### Inte i scope
Scoring/`pageSummary`, testimonial author-extraktion, `social_proof_count` på `trusted_by`.
