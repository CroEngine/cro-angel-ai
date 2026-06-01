# Interpret v2 — 20 nya regler + dynamisk severity

Bygger ovanpå nuvarande `interpret.ts`. Inga ändringar i collectors, `findings.ts`, `InterpretView.tsx`, `schema.ts` eller score-formel.

## Beslut (efter avstämning)

1. **`ux.abovefold.ratio` tas bort.** Svag signal, fold-kvalitet täcks bättre av nya UX-regler.
2. **`cro.cta.trust.distance`**: filtrera `audit.ctas` på `category === "cta_primary"`. Triggar om `min(nearestTrustSignalDistance) > 600` över alla primära CTA:n (eller `=== 9999` = ingen trust alls). En finding per sida. Evidence visar den värsta: `primary CTA "<text>" är <Npx> från närmaste trust signal`.

## Arkitekturändringar i `interpret.ts`

```ts
interface RuleCtx { audit: PageAuditData; collect?: CollectData }

interface Rule {
  id: string;
  category: Category;
  severity: Severity;          // default-severity
  weight?: number;
  title: string;
  passTitle: string;
  evaluate: (ctx: RuleCtx) => null | { evidence: string; severity?: Severity };
}
```

- `interpretOne()` plockar `audit` + ev. `collect` (typeguard `isCollect` på `report.rawCollect`) och bygger `ctx`.
- Regler som kräver `collect` men saknar det → returnera `null` (skip), samma mönster som dagens `hiddenInteractive`.
- Score använder `SEVERITY_WEIGHT[result.severity ?? rule.severity]`. Sortering i findings använder effective severity.

## Regler

Behålls oförändrade (v1): `seo.title.missing`, `seo.meta.description.missing`, `seo.h1.count`.

Tas bort: `ux.abovefold.ratio`.

### SEO (6 nya)

| id | Trigger | Severity | passTitle |
|---|---|---|---|
| `seo.canonical.missing` | `!head.canonical` | medium | Canonical tag present |
| `seo.schema.missing` | `schema.count === 0` | medium | Structured data present |
| `seo.images.alt.coverage` | `images.missingAltPct > 10` | medium, **high om >25** | Image alt coverage acceptable |
| `seo.images.dimensions.missing` | `images.missingDims > 0` | low, **medium om >10% av total** | Image dimensions set |
| `seo.content.thin` | `content.wordCount < 300` | medium, **high om <150** | Content length sufficient |
| `seo.h2.missing` | `headings.h2Count === 0` | low | H2 headings present |

### CRO (6 nya — ersätter/utökar)

Behåller: `cro.primaryCta.missing`, `cro.hero.headline.missing`, `cro.cta.competition`.

| id | Trigger | Severity | passTitle |
|---|---|---|---|
| `cro.hero.cta.missing` | `hero && hero.primaryCtaText.trim() === ""` | high | Hero CTA present |
| `cro.cta.aboveFold.missing` | `pageSummary.aboveFoldCtaCount === 0` | high | CTA above the fold |
| `cro.primaryCta.multipleAboveFold` | antal `ctas` med `category==="cta_primary" && aboveFold` > 1 | medium | Single primary CTA above fold |
| `cro.cta.trust.distance` | se beslut ovan | medium | Primary CTA near trust signal |
| `cro.form.aboveFold.missing` | `pageSummary.formCount > 0 && forms.every(f => !f.aboveFold)` | low | Form reachable above fold |
| `cro.pricing.missing` | `!sectionOrder.includes("pricing") && navigation.pricingPresent` | low | Pricing section present |

### UX (5 nya)

Behåller: `ux.hidden.interactive`.

| id | Trigger | Severity | passTitle |
|---|---|---|---|
| `ux.navigation.overload` | `navigation.topNavCount > 10` | medium, **high om >20** | Top nav within limits |
| `ux.footer.navigation.overload` | `navigation.footerNavCount > 40` | low, **medium om >60** | Footer nav within limits |
| `ux.interactive.aboveFold.density` | (kräver `collect`) `summary.aboveFold > 25` | medium | Above-fold interactive density OK |
| `ux.unknown.intent.ratio` | (kräver `collect`) `unknownPct = unknown/total > 0.3` | low, **medium om >0.5** | Element intent largely classified |
| `ux.lang.missing` | `head.lang.trim() === ""` | low | `<html lang>` set |

### Trust (3 nya)

Behåller: `trust.signals.none`, `trust.abovefold.missing`.

| id | Trigger | Severity | passTitle |
|---|---|---|---|
| `trust.diversity.low` | `trustSummary.total > 0 && Object.keys(trustSummary.byType).length < 2` | low | Trust signal diversity present |

(Plus ev. övriga från listan som passar — anpassas till exakt fältnamn i `schema.ts`.)

## Implementationsordning

1. Arkitektur: `RuleCtx`, dynamisk severity, `isCollect` guard.
2. Ta bort `ux.abovefold.ratio`.
3. Lägg till regler: SEO 1–6 → CRO 7–12 → UX 13–17 → Trust 18–20.
4. Manuell smoketest mot befintlig rapport: bekräfta att inga existerande findings/wins försvinner eller dubbelräknas.

## Inte i scope

- `findings.ts`, `InterpretView.tsx`, `schema.ts`, collectors.
- Score-formel oförändrad (poäng = 100 − Σ vikter per kategori).
- Ingen recommend, ingen AI.
