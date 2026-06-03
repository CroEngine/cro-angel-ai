# Snapshot-rensning + saknade trendmått (sekvenserad)

Verifierat: CTA `section` är `'header' | 'nav' | 'footer' | 'hero' | 'content'` (rad 39–46 i `ctas.ts`). Filtret `section !== "nav" && section !== "header"` är alltså korrekt — bra att du flaggade.

Tre faser, körs i ordning så att varje commit kan verifieras isolerat.

---

## Fas 1 — Schema + auditedAt + null-konvertering

Berör grunden, allt annat bygger på detta.

**`src/lib/tests/schema.ts`**
- `PageAuditData.auditedAt?: string` (ISO, optional för bakåtkompatibilitet med gamla snapshots i DB)
- `PageSummary.ctaTotalCount: number`
- `PageSummary.foldDepthFirstCtaPx: number | null` (null när inga CTAs utanför nav/header finns)
- `PageSummary.avgRating?: number` och `ratingCount?: number` (ersätter dagens loop)
- `TrustSignal` får ny variant `type: "stars_aggregate"` med `averageRating: number, count: number, aboveFoldCount: number`
- Head-fält till `string | null`: `ogType`, `ogUrl`, `ogImage`, `twitterCard`, `twitterTitle`, `twitterImage`, `canonical`, `robots`, `viewport`

**Migration för gamla snapshots:** `auditedAt` är optional. När frontend/trendlogik läser snapshots utan fältet, fall tillbaka på radens `created_at` från DB. Ingen SQL-migration behövs eftersom fältet är optional i JSON-blobben. Dokumenteras i ett kort kommentar-block ovanför `PageAuditData`-typen.

**`src/lib/tests/scripts/pageAudit.ts`**
- Efter `head`-objektet konstrueras: konvertera tomma strängar till `null` för alla fält listade ovan via en helper `nullIfEmpty(s)`.

**`src/lib/tests/runners/pageAudit.server.ts`**
- Sätt `auditedAt: new Date().toISOString()` på det returnerade objektet.

Verifiering: kör en ny audit, kolla att `auditedAt` finns och att `ogType: null` istället för `""`.

---

## Fas 2 — Stars-aggregering + hero-rect-fix

Oberoende av varandra, kan göras parallellt men i samma commit.

**`src/lib/tests/scripts/trustSignals.ts`** — efter alla pushes, före return:
```
const starsEntries = out.filter(e => e.type === "stars");
if (starsEntries.length > 0) {
  const withRating = starsEntries.filter(e => typeof e.rating === "number");
  const avg = withRating.length > 0
    ? withRating.reduce((s, e) => s + e.rating, 0) / withRating.length
    : null;
  const aboveFoldCount = starsEntries.filter(e => e.aboveFold).length;
  // Remove individuals, push single aggregate
  const filtered = out.filter(e => e.type !== "stars");
  filtered.push({
    type: "stars_aggregate",
    averageRating: avg !== null ? Math.round(avg * 100) / 100 : null,
    count: starsEntries.length,
    aboveFoldCount,
    aboveFold: aboveFoldCount > 0,
  });
  return filtered;
}
```
Behåll `derivedFromStars: true` på testimonials — de är inte stars-entries, de pushas som `testimonial` och berörs inte.

**`src/lib/tests/scripts/sections.ts`** — i `addNode`, före `seen.add(el)`:
```
// Skip wrappers that span almost the whole page
if (rect.height > viewportH * 1.5 && el.tagName === 'DIV') {
  const totalElements = document.body.querySelectorAll('*').length;
  const ownCount = el.querySelectorAll('*').length;
  if (ownCount > totalElements * 0.8) return;
}
```
Och i `classifyType` — hero-detektion med height-cap:
```
if (docTop < viewportH * 0.4 && rect.height > 200 && rect.height < viewportH * 1.5) return 'hero';
```

**`src/lib/tests/audit-helpers.ts`** — `buildPageSummary`:
- `ctaTotalCount: ctas.length`
- `foldDepthFirstCtaPx`: minsta `c.rect.y` bland CTAs där `c.section !== "nav" && c.section !== "header"`, eller `null` om listan är tom
- Läs `avgRating/ratingCount` från `stars_aggregate`-entryn istället för gamla loopen över individuella `rating`-fält

Verifiering: trustSignals-arrayen ska tappa ~80% av sin storlek på en sida med stars-carousel; `section_2` (hero) ska få realistisk `h` istället för 9371.

---

## Fas 3 — Sitemap-discovery + headings-slim + selector-strip

Minst kritiska, kommer sist.

**`src/lib/tests/runners/pageAudit.server.ts`** — ersätt dagens enkla sitemap-fetch:

1. Om `robotsTxt.exists`: regex-extrahera `Sitemap:\s*(\S+)` (alla matches, kan vara flera). Fetcha första som svarar 200.
2. Annars fall tillbaka på kandidater i ordning: `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap-index.xml`, `/wp-sitemap.xml`.
3. När en sitemap hittas: kolla om body innehåller `<sitemapindex`. Om ja, plocka ut första 5 child `<loc>`-URL:erna, fetcha dem, summera deras `<url>`-count till `sitemap.urlCount`. Sätt `sitemap.isIndex: true`.
4. Annars räkna `<url>`-taggar som idag.

Lägg `sitemap.url: string | null` (vilken URL som faktiskt hittades) och `sitemap.isIndex?: boolean` i schema.

**`src/lib/tests/scripts/pageAudit.ts`** — `headings.hierarchy` reduceras:
```
const h1Texts = hs.filter(h => h.tagName === 'H1')
  .slice(0, 2)
  .map(h => (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120));
```
Ersätt `hierarchy: [...]` med `h1Texts: string[]`. Schema uppdateras därefter; `hierarchy` tas bort från `Headings`-typen.

**`src/lib/tests/runners/pageAudit.server.ts`** — efter `enrichSections`, mappa sections till variant utan `selector`:
```
const sectionsForSnapshot = sectionsTyped.map(({ selector, ...rest }) => rest);
```
Kolla först om `selector` används nedströms (overlay/llmContext). Om ja, behåll den i en separat `sectionSelectors: Record<sectionId, selector>` som inte sparas i snapshot, eller markera fältet `// transient` och stripa i serialisering. Verifiering körs först.

Verifiering: snapshot-JSON blir märkbart mindre, sitemap.urlCount > 0 på sajter med sitemapindex, `hierarchy` är borta från output.

---

## Filöversikt

| Fil | Fas 1 | Fas 2 | Fas 3 |
|---|---|---|---|
| `schema.ts` | ✓ nya fält | ✓ stars_aggregate | ✓ sitemap.url/isIndex, headings |
| `runners/pageAudit.server.ts` | ✓ auditedAt | | ✓ sitemap-discovery, selector-strip |
| `scripts/pageAudit.ts` | ✓ null-konv | | ✓ headings-slim |
| `scripts/trustSignals.ts` | | ✓ aggregat | |
| `scripts/sections.ts` | | ✓ hero-cap + wrapper | |
| `audit-helpers.ts` | | ✓ foldDepth, avgRating | |

Ingen UI berörs. Inga DB-migrationer (auditedAt är optional, fallback på `created_at`).

GSC-integration sparas till nästa runda enligt din tidigare bedömning.
