## Väg A: Minimal rådata-utvidgning (1–2 dagar)

Lägg till 4 rådata-bitar. Inga scores, flags, quick wins eller UI-ändringar. Alla nya fält är optional. Efter bygget kör du scannern mot 10 siter, läser JSON-output, och vi designar scoring/flags-lagret (Väg B) baserat på faktiska mönster.

---

### 1. Schema — `src/lib/tests/schema.ts`

Lägg till 4 optional-fält på `PageAuditData`:

```ts
indexability?: {
  indexable: boolean;
  noindex: boolean;
  nofollow: boolean;
  canonicalUrl: string | null;        // råvärdet, för felsökning
  canonicalMatchesSelf: boolean;
  canonicalIsAbsolute: boolean;
  robotsTxtAllows: boolean;
};

contentMetrics?: {
  readingTimeMinutes: number;         // max(1, round(wordCount/220))
  paragraphCount: number;
  listCount: number;                  // ul + ol
  listItemCount: number;
  faqCount: number;                   // <details> + headings som slutar med "?"
  blockquoteCount: number;
  headingDepth: number;               // djupaste h-nivå som faktiskt används
};

performanceProxy?: {
  domNodes: number;
  aboveFoldElements: number;
  aboveFoldImageCount: number;
  largestImagePx: number;             // max(naturalWidth*naturalHeight)
  lazyLoadedImages: number;
  eagerImagesAboveFold: number;
  stylesheetCount: number;
  scriptCount: number;
};
```

Utöka `FormEntity`:
```ts
socialLogin: boolean;
socialProviders: string[];   // "google" | "apple" | "facebook" | "github" | "microsoft"
```

---

### 2. Browser-skript — `src/lib/tests/scripts/pageAudit.ts`

Lägg till 3 nya block i den befintliga IIFE:

- **`indexability`**: parsa `<meta name="robots">` content för `noindex`/`nofollow`. `canonicalUrl = canonicalEl?.getAttribute('href') ?? null`. Normalisera canonical mot `location.href` (strip trailing slash + query + fragment) → `canonicalMatchesSelf`. `canonicalIsAbsolute = /^https?:\/\//.test(canonicalUrl)`. `robotsTxtAllows` lämnas `true` här, sätts korrekt server-side.

- **`contentMetrics`**: `paragraphCount = querySelectorAll('p').length`. `listCount = querySelectorAll('ul,ol').length`. `listItemCount = querySelectorAll('li').length`. `blockquoteCount = querySelectorAll('blockquote').length`. `faqCount = querySelectorAll('details').length + headings vars text slutar med '?'`. `readingTimeMinutes = max(1, round(wordCount/220))`. `headingDepth = max h-nivå (1–6) som faktiskt finns på sidan`.

- **`performanceProxy`**: `domNodes = querySelectorAll('*').length`. `aboveFoldElements`: element vars `bbox.top < viewportH`. `aboveFoldImageCount`: `<img>` ovan fold. `largestImagePx`: loopa `<img>`, max `naturalWidth*naturalHeight` (fallback bbox). `lazyLoadedImages = imgs där loading==="lazy"`. `eagerImagesAboveFold = imgs ovan fold där loading !== "lazy"`. `stylesheetCount = querySelectorAll('link[rel="stylesheet"]').length`. `scriptCount = querySelectorAll('script').length`.

Returnera som top-level-fält i samma objekt som resten av `pageAudit`-output.

---

### 3. Browser-skript — `src/lib/tests/scripts/forms.ts`

Per form, sök knappar/länkar inom `form` eller direkt syskon vars text/aria-label matchar `/google|apple|facebook|github|microsoft|sso|single sign/i`. Bygg `socialProviders: string[]` (lowercased, deduped). `socialLogin = socialProviders.length > 0`.

GlutenForum har 0 forms, så denna kod aktiveras inte där — men är redo för siter med inloggning.

---

### 4. Server-side — `src/lib/tests/engine.server.ts`

Efter att `pageAudit`-skriptet returnerat:

```ts
if (audit.indexability) {
  audit.indexability.robotsTxtAllows = !audit.robotsTxt.blocksAll;
  audit.indexability.indexable =
    !audit.indexability.noindex && audit.indexability.robotsTxtAllows;
}
```

Inga andra ändringar i engine.

---

### 5. Vad som INTE ändras

- ❌ `findings.ts` — inga nya kort
- ❌ `FindingsView.tsx` — ingen ny kategori
- ❌ Inga scores, flags, quick wins, confidence, evidence, bucketing
- ❌ Inga nya filer
- ❌ Ingen multi-page crawl
- ❌ Ingen Lighthouse / extern data

Användaren ser ny data via **Download JSON**-knappen som redan finns.

---

## Filer som ändras (3 totalt)

- `src/lib/tests/schema.ts` — 4 optional-fält + `FormEntity`-utökning.
- `src/lib/tests/scripts/pageAudit.ts` — 3 nya block i IIFE.
- `src/lib/tests/scripts/forms.ts` — social-login-detektion.
- `src/lib/tests/engine.server.ts` — 3-radig härledning av `indexable`.

Totalt ~75 rader kod.

---

## Efter bygget — din testprocess

1. Kör scannern mot 10 siter (mix: SaaS, e-handel, blogg, community, B2B, lokal-tjänst).
2. Ladda ner JSON för varje.
3. Notera mönster: vilka fältkombinationer ropar "insikt" åt dig som människa?
4. Skriv ner empiriska tröskelvärden ("competing CTAs känns problematiskt > 6, inte > 4").
5. Det blir spec för Väg B — scoring + flags + insights med riktiga tal istället för gissningar.

---

## Resultat

JSON-export per sida innehåller nu `indexability` (med rå canonicalUrl), `contentMetrics` (inkl. headingDepth), `performanceProxy` (inkl. aboveFoldImageCount), och `socialLogin` på forms. UI:t är oförändrat. Du har rådata att fatta empiriska beslut på inför Väg B.
