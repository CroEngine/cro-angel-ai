# Findings-tabben: tätare och bättre grupperad

Mål: mindre rörigt utan att tappa data. Relaterade findings ska ligga visuellt nära. Endast UI/presentation — `findings.ts` datastruktur ändras minimalt (lägger till `group`-fält), ingen ny data, ingen ny collector.

## Ändringar

### 1. `findings.ts` — lägg till `group` på Finding

```ts
export type FindingCategory = "seo" | "cro" | "trust" | "ux";

export type FindingGroup =
  | "meta" | "structure" | "indexing" | "links"        // seo
  | "hero" | "ctas" | "forms"                          // cro
  | "summary" | "byType" | "signals"                   // trust
  | "navigation" | "sections" | "hierarchy" | "page";  // ux

export interface Finding {
  category: FindingCategory;
  group: FindingGroup;
  label: string;
  detail?: string;
}
```

Mappning (omfördelning från dagens kod):

- **seo / meta**: Title, Meta description, Canonical, lang, OG image, Schema.org
- **seo / structure**: Headings, Word count
- **seo / indexing**: robots.txt, sitemap.xml
- **seo / links**: Links, Images alt
- **cro / hero**: Hero headline/sub/CTA
- **cro / ctas**: CTAs total + per primary CTA (flyttas från dagens "CRO"-bulkar)
- **cro / forms**: Forms total + per form
- **trust / summary**: Trust signals total/above fold, Aggregate rating
- **trust / byType**: By type, Recognized brands, Contact info signals
- **trust / signals**: per signal-rad
- **ux / navigation**: Top/Footer nav links, Nav entries
- **ux / sections**: Section order, Sections detected, per section
- **ux / hierarchy**: #1..#5 hierarki
- **ux / page**: Page summary (flyttas från borttagna "interaction"-kategorin)

Kategorin `interaction` tas bort — "X buttons captured / By category" är redan synlig i Activity-tabben och tillför inget i Findings.

### 2. `FindingsView.tsx` — två renderingslägen + subsektioner

Ny layout per `PageCard`:

```
[Page header]
  SEO ─────────────────────  6 findings
    Meta            (compact rows: Title, Description, Canonical, Lang, OG, Schema)
    Structure       (compact rows: Headings, Word count)
    Indexing        (compact rows: robots, sitemap)
    Links           (compact rows: Links, Images alt)

  Conversion (CRO) ────────  N findings
    Hero            (cards: headline/sub/CTA — narrative)
    CTAs            (compact rows + per-CTA cards)
    Forms           (compact rows + per-form cards)

  Trust ───────────────────  N findings
    Summary
    By type
    Signals         (per-signal cards)

  UX & Structure ──────────  N findings
    Navigation
    Sections
    Hierarchy
    Page
```

Två rendringslägen styrt av `parseFinding(f).kind`:

- `status` / `metric` / `text`-utan-meta → **kompakt rad** `label …………… value` (key/value-lista, en per rad, ingen kortram). Flera kompakta rader staplas direkt under subgrupp-rubriken.
- `quote` / `stats` / långa `text` → behåll dagens `FindingCard` (kortram, kan ta `col-span-2`).

Subgrupp-rubriken är liten (10px uppercase muted) + räknare. Ingen toggling på subgrupp; kategorin behåller dagens collapse.

### 3. `InterpretView` — oförändrat

Berörs ej. Findings-flikens nya `trust`-kategori råkar matcha Interprets `trust` redan.

## Effekt

- SEO-blocket går från 12 lika stora kort → 4 grupper med ~10 kompakta rader totalt.
- CRO-blocket renodlas till hero/ctas/forms; alla 8+ trust-findings flyttas till egen kategori.
- Trust-findings (idag spridda under CRO) hamnar samlat.
- "Interaction"-kategorin försvinner; page summary läggs under ux/page.
- Total höjd ungefär halveras utan att någon datapunkt tappas.

## Inte i scope

- `interpret.ts`, `InterpretView.tsx`, schema, collectors, scoring, rekommendationer.
- Filtrering / search / sort — endast gruppering och tätare layout.
