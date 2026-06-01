## Mål

Lyfta motorn från ~60% CRO / 15% SEO till en hel första audit-grund. Vi gör fyra fokuserade tillägg, ingen UI-omdesign denna omgång.

## Filer

Allt i `src/lib/tests/engine.server.ts` + två små tillägg i `ConsolePanel.tsx` för att rendera ny data.

---

## 1. Bättre intent-klassificering

**Problem**: 263 av 324 element blir `unknown`. "Skapa konto" → unknown.

**Fix**: Multi-signal classifier, inte bara regex på text:

- Utöka `INTENT_RX` med fler verb (svenska + engelska): `skapa konto`, `registrera`, `gå med`, `gratis`, `try free`, `request access`, `download`, `ladda ner`, `add to cart`, `lägg i varukorg`, `apply`, `ansök`, `donate`, `bidra`.
- Lägg till `engagement` som ny intent — fångar like/save/share/vote/comment/follow (idag försvinner de i `unknown`).
- Signaler utöver text:
  - `href` startar med `tel:` / `mailto:` → `utility`.
  - `href` matchar social-domäner → `social`.
  - `aria-label` används om `text` är tom (idag bara fallback i ett ställe).
  - `data-event` / `data-cta` / `data-track` attribut → läs värdet och matcha mot regex.
  - Position: above_fold + `cta_primary` + tom intent → fallback `conversion` (idag bara för `form_submit`).
- Sista fallback för helt textlösa icon_buttons: `engagement` om de sitter i en kort horisontell rad med ≥2 syskon (typiskt feed-toolbar).

## 2. Gruppering av repetitiva controls

**Problem**: 30× "Rösta upp", 30× "Spara" → dominerar all statistik.

**Fix**: I `runSteps` efter `filtered`-listan, lägg `groupRepeatedControls()`:

- Gruppera element vars `(text, category, intent, ~size, ~xPercent)` är nära identiska och dyker upp ≥3 gånger.
- Behåll *första* förekomsten med `groupId` + `groupCount`. Övriga får `groupId` + `groupedAway: true` och filtreras bort ur de aggregerade siffrorna (count, byCategory, intentBreakdown, topVisualWeight) — men finns kvar i `elements` så overlay fortfarande ritas på alla.
- Lägg `groups` i `data.summary`:
  ```ts
  groups: Array<{ label: string; count: number; category; intent; exampleSelector: string }>
  ```
- Console-panelen får en liten "Repeated controls"-sektion ovanför element-previewen.

## 3. SEO / page-collector

**Nytt step**: `pageAudit` (vid sidan av `collect`). Körs typiskt efter `goto` + `wait`.

Samlar i en enda `page.evaluate`:

- **Head**: `title`, meta description, canonical, og:title/description/image/type/url, twitter:card/title/image, robots, lang, viewport.
- **Headings**: array `{ level, text, id }` i dokumentordning.
- **Images**: total, utan `alt`, utan dimensioner, lazy-loaded.
- **Länkar**: internal vs external (same origin?), nofollow, totala.
- **Structured data**: alla `<script type="application/ld+json">` → parsar typer (Organization, Article, Product, FAQPage, BreadcrumbList…).
- **Content**: word count i `<main>` (fallback `<body>`), antal `<section>`/`<article>`.
- **Indexability**: läses från robots meta + `x-robots-tag` (om vi har response headers — annars bara meta).

Plus serverside-fetch i `pageAudit` (via Playwright `page.request`):

- `/robots.txt` → exists, har Disallow:/, har Sitemap-direktiv.
- `/sitemap.xml` → exists, antal URL-entries.

**Sammanställning** i `pageAudit`-data:
```ts
{
  head: {...},
  headings: { h1Count, h2Count, hierarchy: [...] },
  images: { total, missingAlt, missingAltPct },
  links: { internal, external, nofollow },
  schema: { types: ["Organization", "Article"] },
  content: { wordCount, sections },
  robots: { hasRobotsTxt, blocksAll, hasSitemap },
  sitemap: { exists, urlCount },
  flags: ["missing_meta_description", "multiple_h1", ...]
}
```

Streamas som eget `step_passed`-event och får en egen kollapsbar `<PageAuditDetails>` i `ConsolePanel.tsx`.

## 4. Section detection

**Problem**: idag är allt "ett flack lista element". CRO vill veta att 30 vote-knappar sitter i feed-cards, inte i nav.

**Fix**: Lätt heuristik i COLLECT_SCRIPT:

- För varje element, gå uppåt i DOM tills första matchande container hittas:
  - `header`, `[role=banner]` → `nav` (om i toppen) eller `hero`.
  - `nav`, `[role=navigation]` → `nav`.
  - `footer`, `[role=contentinfo]` → `footer`.
  - `main > section:first-of-type` ELLER första elementet med `rect.top < viewportHeight && height > viewportHeight*0.4` → `hero`.
  - Container som har ≥3 syskon med samma tagName + liknande höjd → `cards`.
  - Annars → `content`.
- Skriv `section: SectionKind` på varje element.
- Aggregera i `data.summary`:
  ```ts
  bySection: Record<SectionKind, number>
  ```
- Console får ett chips-rad: `nav 18 · hero 4 · cards 90 · content 25 · footer 12`.

## Inget i denna patch

- Lighthouse-port / Core Web Vitals (LCP, CLS, INP). Eget steg, kräver `PerformanceObserver`-fönster — separat plan.
- WCAG-kontrast text↔egen-bg per element. Adderas i en CX-runda.
- Visuell rapport-PDF / share-länk.
- Klickbara overlays i Frozen-vyn (CRO inspector).

## Förväntad effekt på siffrorna ChatGPT gav

| Område | Idag | Efter |
|---|---|---|
| CRO | 60–70% | 80–85% (gruppering + section + bättre intent) |
| UX  | 50–60% | 65–70% (section detection ger struktur) |
| SEO | 15–20% | 70–75% (pageAudit täcker on-page-checklistan; perf saknas) |

## Trade-offs

- `pageAudit` lägger ~0.5–1s per sida.
- Section-heuristiken är best-effort — komplexa sidor (single-page med pseudo-sektioner i CSS-grid) får ibland fel zon. Acceptabelt för v1.
- Intent-klassificeringen är fortfarande regex-baserad. När den når sin gräns: GPT-batch som efter-pass (separat plan).

## Frågor innan vi börjar

Föreslår vi kör alla fyra delar i samma patch — de är små och hänger ihop. Säg till om du hellre vill:

**(A)** Köra alla fyra delar nu (rekommenderas).
**(B)** Bara `pageAudit` (största SEO-vinsten ensam).
**(C)** Bara intent + grouping + section (CRO-vinsten ensam).
