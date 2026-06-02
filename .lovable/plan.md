Två lager, två separata ändringar. Scoring fortsätter att läsa `PageAuditData` (maskinläsbar); LLM-prompten får en ny komprimerad vy.

## Fas 1 — Städa rå-auditen

**`src/lib/tests/scripts/sections.ts`** (browser-script, källan):
- Sluta emitta: `kind`, `headingText`, `heightPx`, `repeatedChildren`.
- Sluta emitta `rect.x` (behåll y/w/h i sektions-rect).
- `subheading`: emitta bara om icke-tom och ≠ `heading`.

**`src/lib/tests/schema.ts`**:
- Behåll global `Rect` orörd — CTA/trust-proximity använder `rect.x`.
- Ny `SectionRect = { y: number; w: number; h: number }` för `PageSection.rect`.
- Ta bort `kind`, `headingText`, `heightPx`, `repeatedChildren` från `PageSection`. Gör `subheading` valfri.

**`src/lib/tests/scripts/visualHierarchy.ts`**:
- Filtrera bort entries där `text === ""` innan top-20 trunkering.
- Dedupa på nyckel `text + tagName + Math.round(fontSize) + Math.round(area/1000)` så h1/p-dubbletten försvinner.

**`src/components/browser-shell/findings.ts`** — sök på sträng, inte radnummer:
- Raden som läser `s.heightPx` → läs `s.rect.h` istället.
- Raden som läser `s.repeatedChildren` → ta bort helt.
- Raden `s.heading || s.headingText` → bara `s.heading`.

## Fas 2 — Ny LLM-kontextbyggare

**Ny fil `src/lib/tests/llmContext.ts`** (pure, ingen IO):
- Exporterar `buildLlmContext(audit: PageAuditData, url: string): LlmAuditContext`.
- Returnerar strukturen i ditt exempel: `{ url, seo, cro, trust, ux }`.
- Härleder:
  - `seo.altTextCoverage` från `images.missingAltPct` → `"30% (70% of images missing alt)"`.
  - `cro.hero` från `audit.hero`.
  - `cro.ctas`: mappa till `{ text, intent, aboveFold }`. **Tak**: alla `aboveFold: true`, plus max 3 below-fold med högst `visualWeight`. Hard cap totalt 8.
  - `cro.aboveFoldCtaCount` / `secondaryCtaCount` från `pageSummary`.
  - `trust.trustStatements`: **explicit** `trustSignals.filter(s => s.type === 'trusted_by').map(s => s.text)` — inte testimonials.
  - `trust.reviewBadges/customerLogos/testimonials/certifications`: från `trustSummary.byType`.
  - `ux.sectionFlow` = `audit.sectionOrder`.
  - `ux.navigation.has*` från `navigation`.
  - `ux.performance` direkt från `performanceProxy`.
- Definiera `LlmAuditContext`-typ i samma fil och exportera.

**Wire-up**: ingen ändring i `pageAudit.server.ts` eller event-streamen. `buildLlmContext` anropas senare där findings-prompten byggs. Just nu räcker att funktionen + typen finns och är enhetstesterbar.

## Vad som inte ändras

- Scoring-/findings-motorn konsumerar fortfarande `PageAuditData`.
- Global `Rect` (CTA/trust använder `rect.x` för proximity).
- `collect`-pipeline, overlay, screenshot.

## Filer

- `src/lib/tests/scripts/sections.ts`
- `src/lib/tests/scripts/visualHierarchy.ts`
- `src/lib/tests/schema.ts`
- `src/components/browser-shell/findings.ts`
- `src/lib/tests/llmContext.ts` (ny)