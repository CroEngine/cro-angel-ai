## Fix: hero null när hero-sektionen innehåller form (Rippling-mönstret)

Klassificeringen i `classifyType()` låter form vinna över hero när en above-fold-sektion har både H1 och ett formulär (vanligt PLG-mönster: signup-form i hero). Resultat: `section_2.type = 'form'`, `deriveHero()` hittar ingen `'hero'` och returnerar null.

### Lösning — Alternativ 2 (säkrast)

Utöka fallback-kedjan i `deriveHero()` i `src/lib/tests/audit-helpers.ts` så den även plockar above-fold form-sektioner med heading när ingen hero-typ finns. Klassificeringen i `sections.ts` lämnas orörd (section_2 förblir `form`), bara hero-derivation blir mer förlåtande.

```ts
const heroSection =
  sections.find((s) => s.type === "hero") ??
  sections.find((s) => s.aboveFold && s.containsPrimaryCTA && s.heading) ??
  sections.find((s) => s.type === "form" && s.aboveFold && s.heading);
```

Ordningen är viktig: existerande `containsPrimaryCTA`-fallback körs först (täcker majoriteten), form-fallback bara om inget annat matchar.

### Filer
- `src/lib/tests/audit-helpers.ts` — lägg till tredje fallback i `deriveHero()`

### Verifiering
- **Rippling**: `hero.headline` = H1 från section_2, `hero.sectionId = "section_2"`, `hero.primaryCtaText = "Create free account"`
- **Greenhouse / övriga**: ingen regression — fallback triggas bara när varken hero-typ eller above-fold + primaryCTA finns

Inget cookieDebug- eller klassificeringsarbete i denna omgång. Greenhouse-körningen kan göras direkt efter.