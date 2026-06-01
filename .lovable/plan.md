## Mål

Lyfta `pageAudit`-datamodellen till en nivå där vi kan bygga CRO / UX / Trust / CTA / Funnel / AI-insights på **samma insamlade data** — utan ny crawl om sex månader. All insamling sker deterministiskt i `page.evaluate` (Playwright-delen av Stagehand). Ingen AI i detta steg.

## Designprincip

Varje entitet ska bära tillräckligt med kontext (section, aboveFold, visualWeight, avstånd till andra entiteter) för att vi ska kunna beräkna scores utan att gå tillbaka till DOM:en.

## Ny datamodell (PageAuditData v2)

### 1. `sections[]` — rik sektionsmodell

```ts
{
  id: "section_1",
  type: "hero" | "logos" | "benefits" | "features" | "testimonials"
      | "reviews" | "pricing" | "faq" | "cta" | "form"
      | "nav" | "header" | "footer" | "content" | "aside",
  position: number,                  // 1-baserad i DOM-ordning
  heading: string,
  subheading: string,
  aboveFold: boolean,
  heightPx: number,
  visualWeight: number,              // 0-100 normaliserat
  elementCount: number,
  containsPrimaryCTA: boolean,
  containsTrustSignals: boolean,
  containsForm: boolean,
  containsPricing: boolean,
  containsNavigation: boolean,
  selector: string,
  rect: { x, y, w, h }
}
```

Klassificering av `type` sker via heuristik: rubriktext, child-mönster (≥3 likt = `logos`/`cards`/`testimonials`), närvaro av `<form>`, prisformat (`$`, `kr`, `/mo`), accordion-mönster för `faq`, position 1 + stor hero-rubrik för `hero`.

### 2. `sectionOrder[]`

Härleds från `sections[].type` i positionsordning. Möjliggör "fel ordning"-insikter (t.ex. `pricing` före `testimonials`).

### 3. `trustSignals[]` — utökad

```ts
{
  type, text, section, aboveFold, visualWeight, selector,

  // typ-specifika fält:
  personName?: string,         // testimonial
  company?: string,            // testimonial
  hasImage?: boolean,          // testimonial

  rating?: number,             // review
  reviewCount?: number,        // review
  reviewSource?: string,       // "Trustpilot" | "Google" | ...

  logoCount?: number,          // customer_logos
  recognizedBrands?: string[]  // matchning mot lista över top brands
}
```

Person/företag extraheras via mönster `"…" — Name, Company` eller intilliggande `<cite>`/`<figcaption>`. Review-källa via närliggande logotext/alt. Recognized brands via inbäddad lista (Spotify, Stripe, HubSpot, Google, Microsoft, Apple, …).

### 4. `ctas[]` — egen entitet (inte bara `collect`-elements)

```ts
{
  text, intent: "conversion" | "navigation" | "secondary" | "utility",
  category: "cta_primary" | "cta_secondary" | "form_submit"
          | "nav_item" | "link" | "icon_button",
  section, aboveFold, visualWeight,
  competingActions: number,            // # konkurrerande CTA i samma sektion
  nearestTrustSignalDistance: number,  // px till närmaste trustSignal
  nearestFormDistance: number,         // px till närmaste form (0 om i form)
  selector, rect
}
```

Distansberäkningar görs en gång i `page.evaluate` mot redan insamlade `sections` + `trustSignals` + `forms`.

### 5. `forms[]`

```ts
{
  section, aboveFold, selector,
  fieldCount, requiredFields,
  containsEmail, containsPhone, containsCompany,
  containsPassword, containsCreditCard,
  multiStep: boolean,
  submitText: string,
  fields: Array<{ name, type, required, label }>
}
```

`multiStep` heuristik: förekomst av `[aria-current=step]`, `.step`, `progress`, eller `fieldset` med "Step N".

### 6. `navigation`

```ts
{
  topNavCount: number,
  footerNavCount: number,
  topNavLinks: string[],
  footerNavLinks: string[],
  loginPresent, signupPresent, pricingPresent,
  contactPresent, blogPresent, docsPresent,
  languageSwitcherPresent,
  cartPresent
}
```

Detektering via text-matching (SE+EN) i `<header>`/`<nav>` resp. `<footer>`.

### 7. `visualHierarchy[]` — top-N viktigaste element

För `top 20` element rankade på `visualWeight`:

```ts
{
  selector, text, role,
  visualWeight, area, fontSize, fontWeight,
  contrast: number,            // WCAG-kontrast mot bakgrund
  position: { xPct, yPct },    // % av viewport
  aboveFold, section
}
```

Möjliggör "Vad ser användaren först?" utan AI.

### 8. `pageSummary`

```ts
{
  primaryCtaCount, secondaryCtaCount,
  aboveFoldCtaCount, aboveFoldTrustCount,
  trustSignalCount, testimonialCount, logoCount,
  reviewCount: number,           // summa rating-counts från reviews
  averageRating: number,
  formCount,
  navigationLinks,
  sectionCount,
  pageHeightPx,
  foldHeightPx
}
```

Allt detta är ren reduktion över de andra arrayerna — billigt att beräkna, men sparar konsumenter (UI, framtida AI) från att räkna om.

## Tekniska ändringar

### `src/lib/tests/engine.server.ts`

1. **Utöka `PageAuditData`** med fälten ovan; behåll bakåtkompatibilitet med befintliga fält (`head`, `headings`, `images`, `links`, `schema`, `content`, `robotsTxt`, `sitemap`, `flags`).
2. **Skriv om `SECTIONS_SCRIPT`** så att den producerar v2-strukturen (id, position, type-klassificering, alla `contains*`-flaggor, `heightPx`, `visualWeight`, `elementCount`).
3. **Utöka `TRUST_SIGNALS_SCRIPT`** med extraktion av `personName`, `company`, `hasImage`, `rating`, `reviewCount`, `reviewSource`, `recognizedBrands`. Lägg in en konstant `RECOGNIZED_BRANDS` (~50 namn).
4. **Ny `CTAS_SCRIPT`** — bygger på samma element-detektering som `COLLECT_SCRIPT` men returnerar CTA-entiteter med `competingActions` + distanser.
5. **Ny `FORMS_SCRIPT`** — itererar `document.querySelectorAll("form")`, klassificerar fält.
6. **Ny `NAVIGATION_SCRIPT`** — analyserar `<header>/<nav>/<footer>`.
7. **Ny `VISUAL_HIERARCHY_SCRIPT`** — rankar synliga element på `area * fontSize * contrast`, returnerar top 20.
8. **Beräkna `pageSummary`** + `sectionOrder` i Node efter `page.evaluate`-anropen.
9. **Nya flags**: `wrong_section_order` (pricing före social proof), `cta_no_trust_nearby` (closest > 400px), `form_high_friction` (≥6 required fält).

### `src/components/browser-shell/findings.ts`

Utöka interfaces, lägg till finding-generatorer:
- `ctaFindings` (CRO): primary count, competing, trust-distance, intent-blandning
- `formFindings` (CRO): friction score, required-andel, multi-step
- `navigationFindings` (UX): nav-bredd, saknade essentials (pricing/contact)
- `hierarchyFindings` (UX): top-3 viktigaste element + warn om primary CTA inte i top-5
- `sectionOrderFindings` (CRO): visa ordning, warn vid kända anti-mönster
- Utöka `structureFindings` med nya `containsX`-flaggor per sektion
- Utöka `trustFindings` med rating/reviewCount/recognizedBrands

### `src/components/browser-shell/FindingsView.tsx`

Inga nya tabs. "Download JSON" inkluderar redan hela `pageAudit` → all ny data följer automatiskt.

## Vad som inte ingår

- **AI-tolkning** — kommer som separat `aiAnalysis`-step ovanpå denna datamodell.
- **Scoring/index** (CTA Clarity Score, Form Friction Score etc.) — vi samlar råvarorna nu, beräknar score i en senare PR.
- Inga ändringar i overlay, frozen-view, Lighthouse, export, Activity-tab, eller `collect`-stegets befintliga output (vi *adderar* `ctas`/`forms`/`navigation` parallellt).

## Acceptanskriterier

- `pageAudit.data` innehåller alla nya fält ovan med korrekt typing.
- `sectionOrder` reflekterar DOM-ordning av sektioner.
- Varje CTA har `competingActions` + `nearestTrustSignalDistance` ifyllt.
- Findings-vyn visar nya CRO/UX-insikter; "Download JSON" exporterar hela v2-strukturen.
- Inga nya `act/observe/extract`-anrop — allt via `page.evaluate`.

## Trade-offs

- +1–2 s/sida för de nya scripten (5 nya `page.evaluate`-pass). Acceptabelt eftersom det ersätter framtida re-crawls.
- Större payload per sida (~uppskattat 30–80 KB JSON) — fortfarande inom rimligt för UI/stream.
- Heuristisk sektionsklassificering kommer ha edge cases (t.ex. hybrid hero+form); vi loggar `type: "content"` som fallback istället för att gissa fel.
