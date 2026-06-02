Lägg till detektion av tredjeparts-review-badges (G2, Capterra, Trustpilot, TrustRadius m.fl.) i `src/lib/tests/scripts/trustSignals.ts`.

## Mål

Fånga utmärkelser som "G2 Leader Winter 2026", "Capterra Best Value", "Trustpilot Excellent" — separat från `customer_logos` och `secure_payment`. Stark trust-signal som saknar kategori idag.

## Ny kategori: `review_badges`

Två regexar:

1. **`BADGE_BRANDS`** — plattformar (matchas mot alt + src):
   ```
   /\bg2\b|g2crowd|g2\.com|capterra|trustradius|trustpilot|software ?advice|getapp|gartner peer insights|sourceforge|product hunt|crozdesk|finances ?online|tekpon/i
   ```

2. **`BADGE_TITLES`** — utmärkelsefraser (matchas endast mot alt):
   ```
   /\b(leader|high performer|momentum leader|easiest to do business with|best (value|support|relationship|usability|est\.? roi)|top rated|best of \d{4}|users love us|fastest implementation|rising star|category leader|customers' choice|editors' choice)\b/i
   ```
   `best results` borttaget — för brett (false positive på produktbilder med alt="Best results from our platform").

## Implementation

Nytt block efter `customer_logos` (rad 455), före `secure_payment`:

```js
// 3b) Third-party review/award badges (G2, Capterra, Trustpilot, etc.)
const BADGE_BRANDS = /\bg2\b|g2crowd|g2\.com|capterra|trustradius|trustpilot|software ?advice|getapp|gartner peer insights|sourceforge|product hunt|crozdesk|finances ?online|tekpon/i;
const BADGE_TITLES = /\b(leader|high performer|momentum leader|easiest to do business with|best (value|support|relationship|usability|est\.? roi)|top rated|best of \d{4}|users love us|fastest implementation|rising star|category leader|customers' choice|editors' choice)\b/i;

// Precompute rects once to avoid forced layout per filter iteration
const allImgs = Array.from(document.querySelectorAll('img[alt], img[src]'));
const imgRects = new Map();
for (const img of allImgs) imgRects.set(img, img.getBoundingClientRect());

const badgeImgs = allImgs.filter((i) => {
  const r = imgRects.get(i);
  if (!r || r.width < 30 || r.height < 30 || r.width > 300 || r.height > 300) return false;
  const alt = i.getAttribute('alt') || '';
  const src = i.getAttribute('src') || '';
  const hay = (alt + ' ' + src).toLowerCase();
  if (BADGE_BRANDS.test(hay)) return true;
  // Title-only match: kräv badge-form (portrait/square) OCH att alt inte ser ut som meningstext.
  // Heuristik: alt < 60 tecken, max 6 ord, ingen avslutande punkt.
  if (BADGE_TITLES.test(alt) && r.height >= r.width * 0.8) {
    const wordCount = alt.trim().split(/\s+/).length;
    if (alt.length <= 60 && wordCount <= 6 && !/\.$/.test(alt.trim())) return true;
  }
  return false;
});

if (badgeImgs.length > 0) {
  // Group by nearest container
  const groups = new Map();
  for (const img of badgeImgs) {
    const block = img.closest('ul, ol, section, div, footer') || img.parentElement;
    if (!block) continue;
    const arr = groups.get(block) || [];
    arr.push(img);
    groups.set(block, arr);
  }
  // Dedupe wrapper-containers: drop a block if any OTHER block in the set is its descendant.
  // (Same semantics as trusted_by-dedup in plan.md: a.contains(b) → a is the wrapper, drop a.)
  const blocks = Array.from(groups.keys());
  const innermost = blocks.filter((a) => !blocks.some((b) => b !== a && a.contains(b)));
  for (const block of innermost) {
    const imgs = groups.get(block);
    const brandsFound = new Set();
    const titlesFound = new Set();
    for (const img of imgs) {
      const alt = img.getAttribute('alt') || '';
      const src = img.getAttribute('src') || '';
      const hay = (alt + ' ' + src).toLowerCase();
      const mb = hay.match(BADGE_BRANDS); if (mb) brandsFound.add(mb[0]);
      const mt = alt.match(BADGE_TITLES); if (mt) titlesFound.add(mt[0]);
    }
    push('review_badges', imgs.length + ' badge images', block, 'img_alt', {
      badgeCount: imgs.length,
      brands: Array.from(brandsFound).slice(0, 10),
      titles: Array.from(titlesFound).slice(0, 10),
    });
  }
}
```

### Konsistens med trusted_by-dedup

Båda använder samma mönster: `a.contains(b)` ⇒ a är förälder ⇒ droppa a, behåll b (innermost). Kommentar förtydligad så semantiken är explicit på båda ställena.

### Schema-uppdatering

Lägg `'review_badges'` i `TrustSignalType` (`schema.ts`). Inga nya properties krävs — `brands`/`titles` exponeras via samma fält som idag är optional på `TrustSignal`? Kollar: `recognizedBrands` finns redan, men `titles` är nytt. Två alternativ:
- **A:** Återanvänd `recognizedBrands` för brands, lägg till `badgeTitles?: string[]`.
- **B:** Använd `recognizedBrands` för brands och stoppa in titlar i `text`-fältet.

Går på **A** — explicit fält är tydligare för konsumenten.

## Förväntat resultat

- Sida med G2-badges: 1 entry `type: 'review_badges'`, `badgeCount: 5`, `recognizedBrands: ['g2']`, `badgeTitles: ['leader', 'momentum leader', 'easiest to do business with']`.
- teamtailor-auditen: 0 review_badges (regression-säkert).

## Inte i scope

- Icke-engelska BADGE_TITLES (svenska "marknadsledare" etc.) — vänta tills vi ser faktiska sajter
- Excludera BADGE_BRANDS-träffar från customer_logos (kan dubbelräknas i nuläget — konsumenten filtrerar)
- Stars rating-exponering (parkerad)
