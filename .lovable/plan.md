## Status: Steg 0-3 klara

### Steg 0 — f2-revert orsak
- Sökt chathistorik (733 msg) på `revert`, `övergav`, `trasig`, `crashed`, `f2 branch failure`. Inga träffar tidigare än msg #731 där användaren först nämner f2-grenen.
- Slutsats: orsaken till f2-reverten finns inte dokumenterad i chatten. Hypotesen "layout/viewportDelta eller wiring" kvarstår men kan inte bekräftas.
- Riskreducering: portade INTE `layout`/`viewportDelta` (Steg 4 hoppas över). De tre låg-risk-ändringarna (trustDebug, testimonial-strikthet, CTA-rename) hölls isär så de kan revertas individuellt vid behov.

### Steg 1 — `trustDebug` (klar)
- Lade till `debug`-array och `logDecision(stage, decision, reason, el, text, extras)`-helper i `TRUST_SIGNALS_SCRIPT` (`src/lib/tests/scripts/trustSignals.ts`).
- Loggar accept/reject för: text-pattern testimonial-träffar, quote-block scan (med isSlide/hasQuote/hasStrongAuthor/hasLogoImg/hasTestimonialClass + meta), stars-anchor pass, text-dedup.
- Skriptet returnerar nu `{ signals, _debug }` istället för bara `signals`.
- Konsumenten i `pageAudit.server.ts` destruktureras och `trustDebug` exponeras på `PageAuditData.trustDebug` (optional, `Array<Record<string, unknown>>`).

### Steg 2 — Strikt testimonial-attribution (klar)
- I quote-block scan ersattes den breda `hasAuthor`-selektorn (`[class*="title" i]`, `[class*="name" i]`, `[class*="role" i]`) — den matchade sektionsrubriker och produktkort.
- Ny attribution-gate kräver minst ett av:
  - `hasQuote` (typografiska citattecken eller "— Namn"-mönster)
  - `hasStrongAuthor` (explicit `<cite>`/`<figcaption>` med text 3–120 tecken)
  - `hasLogoImg` (kundlogga i kortet)
  - `meta.personName && meta.company` (namn+företag extraherat ur text)
  - `hasTestimonialClass` (class innehåller `testimonial|quote|review`)
- Gäller både slides OCH `[class*="testimonial"]`/`[class*="quote"]`-containers (CMS-författare återanvänder ofta dessa class-namn för produktkort).
- `<blockquote>`-taggar släpps fortfarande igenom oberoende — taggen i sig är attribution.

### Steg 3 — Fix 1 portad (klar)
- `PageSummary.primaryCtaCount` → **`primaryConversionCtaCount`** (filter: `category==='cta_primary' && intent==='conversion'`).
- Nya fält: **`iconButtonCount`** (`category==='icon_button'`) och **`otherCtaCount`** (rest).
- Reconcile-assertion i `buildPageSummary` (warn till konsol om summan inte = `ctaTotalCount`).
- Uppdaterade konsumenter: `audit-helpers.ts`, `findings.ts:250`, `engine.server.ts:404`.
- `CollectSummary.primaryCtaCount` (separat typ i `schema.ts:518`) lämnades orörd — den används av `collect`-steget, inte `pageAudit`.

### Steg 4 — Hoppad
`layout`/`viewportDelta` portas inte (orsak till f2-revert okänd; ingen nedströmskonsument behöver dem just nu).

## Verifiering att köra
Kör page audit mot `https://www.hibob.com/se/` och kontrollera JSON:
- `trustDebug` finns och innehåller per-element-beslut (stage, decision, reason, selector, attribution-flags).
- `testimonialCount === 3` — Uala, Elation Health, TourRadar. Produktblurbarna ("Bob hjälper…", "Personalansvariga Led…", etc.) ska INTE räknas som testimonials.
- `pageSummary.primaryConversionCtaCount` finns; `primaryCtaCount` är borta. `iconButtonCount` + `otherCtaCount` finns. Summan = `ctaTotalCount`.
- Inga konsolfel/-varningar (utöver reconcile-warn om mismatch).

## Efter verifiering
- När detektionen verifierats på ≥2 sidor: ta bort `_debug`-array och `trustDebug`-fält.
- Nästa: `flag-rules.ts`.
