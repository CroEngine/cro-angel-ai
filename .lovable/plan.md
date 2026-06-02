
## Mål

Fixa två datafel som scoring-validering avslöjade. Inga UI-/DB-ändringar. När detta är inne kör vi en ny analys mot Loopia/Teamtailor/Semrush för att verifiera datan, sedan bygger vi scoring-motorn i nästa steg.

## Bugg 1: `pageSummary.averageRating` / `reviewCount` alltid 0

### Rot

`audit-helpers.ts → buildPageSummary` summerar redan korrekt från `trustSignal.rating` / `trustSignal.reviewCount` — problemet är **uppströms**:

- `trustSignals.ts` har en `extractRatingMeta()` som plockar rating/reviewCount ur text, MEN den körs bara när PATTERNS.`review_rating` matchar (kräver `"X.Y/5"`-format i texten).
- Stjärn-blocket (rad 180–200) pushar `'stars'`-signaler **utan extras** — så även när "★★★★★ 4.7 (2,143 reviews)" finns nära stjärnorna, plockas talen aldrig.
- Resultat: Teamtailor (1 `stars`), Semrush (1 `stars`) — båda ger 0 rating/reviewCount. Loopia har varken stjärnor eller rating-text → 0 är korrekt där.

### Fix

I `src/lib/tests/scripts/trustSignals.ts`, i stjärn-blocket:

1. När en stjärn-kluster (≥3 stjärnnoder med samma parent) hittas, leta rating/reviewCount i **parent + grandparent + nästa syskon** via `extractRatingMeta()` på deras `innerText`.
2. Lika för Unicode-stjärn-blocket (★⭐✦ ≥3 i text).
3. Pusha `'stars'` med dessa extras (rating/reviewCount/reviewSource).

Ingen schema-ändring. `buildPageSummary` plockar upp värdena automatiskt.

## Bugg 2: `visualHierarchy[0].role` = HTML-tag, inte semantisk

### Rot

`visualHierarchy.ts → role()` returnerar bara `tag.toLowerCase()` (`'h2'`, `'button'`, `'link'`, `'image'`). Scoring-checken "top är hero CTA/headline" behöver semantik (`hero_headline` / `hero_cta` / `nav_item` / `heading` / `image` / `other`).

### Fix

1. I `src/lib/tests/scripts/visualHierarchy.ts`:
   - Byt `role()` så den tar `(el, sectionKind)` och returnerar semantisk roll:
     - h1–h3 i `hero` → `hero_headline`
     - button/a/[role=button] i `hero` → `hero_cta`
     - a/button i `nav` → `nav_item`
     - a/button i `footer` → `footer_link`
     - h1–h6 utanför hero → `heading`
     - img → `image`
     - p → `paragraph`
     - annars → `other`
   - Lägg till nytt fält `tagName` (oförändrad HTML-tag) så vi inte tappar info.
2. I `src/lib/tests/schema.ts`:
   - `VisualHierarchyEntry.role` → snäv union `'hero_headline' | 'hero_cta' | 'nav_item' | 'footer_link' | 'heading' | 'image' | 'paragraph' | 'other'`.
   - Lägg till `tagName: string`.
3. Kontrollera `src/components/browser-shell/findings.ts → hierarchyFindings()` — den läser `h.role` och visar som text. Fortfarande OK eftersom union-värdena är läsbara strängar.

## Filer som ändras

- `src/lib/tests/scripts/trustSignals.ts` — utöka stjärn-blocket med rating-extraktion från närliggande noder
- `src/lib/tests/scripts/visualHierarchy.ts` — semantisk `role()` + nytt `tagName`-fält
- `src/lib/tests/schema.ts` — uppdatera `VisualHierarchyEntry`-typen

## Validering

Efter fix kör vi om en analys av Teamtailor (har stjärnor + reviews i text) och Semrush, och kontrollerar:
- `pageSummary.averageRating > 0` för båda
- `pageSummary.reviewCount > 0` för båda
- `visualHierarchy[0].role` är `hero_headline` eller `hero_cta` för minst en av sajterna med tydlig hero (Teamtailor)

Om något inte stämmer justerar vi reglerna innan vi går vidare till scoring-motorn.

## Inte i scope nu

- Scoring-motorn (`src/lib/tests/scoring/*`)
- DB-tabell / `saveRun`
- UI-ändringar i `FindingsView`
