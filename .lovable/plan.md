## Mål

Lös carousel-, wrapper- och responsiv-dubbletter genom att sluta deduplicera containrar och istället räkna unika logo-srcs på sidnivå.

## Ändringar i `src/lib/tests/scripts/trustSignals.ts`

### 1. Ersätt sektion `3) Customer logos` (rad ~439–455)

```js
// 3) Customer logos — globally dedupe by normalized src
const allImgs = Array.from(document.querySelectorAll('img'));
const seen = new Set();
const uniqueLogos = [];
for (const img of allImgs) {
  const r = img.getBoundingClientRect();
  if (r.width < 40 || r.width > 240 || r.height < 20 || r.height > 120) continue;
  const raw = img.getAttribute('src') || img.currentSrc || '';
  if (!raw) continue;
  const key = raw.split('?')[0];
  if (seen.has(key)) continue;
  seen.add(key);
  uniqueLogos.push(img);
}

if (uniqueLogos.length >= 4) {
  const vh = window.innerHeight;
  const aboveFoldLogoCount = uniqueLogos.filter((i) => {
    const r = i.getBoundingClientRect();
    return r.top < vh && r.bottom > 0;
  }).length;
  const altText = uniqueLogos
    .map((i) => (i.getAttribute('alt') || '') + ' ' + (i.getAttribute('src') || ''))
    .join(' ').toLowerCase();
  const recognized = [];
  for (const b of RECOGNIZED_BRANDS) if (altText.indexOf(b) >= 0) recognized.push(b);

  const anchor = uniqueLogos[0];
  push('customer_logos', `${uniqueLogos.length} logo images`, anchor, 'img_alt', {
    logoCount: uniqueLogos.length,
    aboveFoldLogoCount,
    recognizedBrands: Array.from(new Set(recognized)).slice(0, 20),
  });
}
```

### 2. Ta bort container-dedup-maskineriet för `customer_logos`

- I `push()` (rad 111): ta bort `customer_logos`-grenen, behåll `_block` enbart för `trusted_by`.
- I post-processing (rad 559–633):
  - Behåll `dedupeSameBlock` + `dropWrappers` för `trusted_by`.
  - Ta bort båda anropen för `customer_logos` (rad 593–594).
  - Ta bort hela `_debug`-blocket (rad 596–631).
- Behåll `delete e._block`-loopen.

### 3. Schema

Lägg till valfri `aboveFoldLogoCount?: number` på `TrustSignal` i `src/lib/tests/schema.ts`.

## Trade-offs

- En enda `customer_logos`-entry per sida — fold-signal bevaras via `aboveFoldLogoCount`.
- `currentSrc` kan ge olika URL per viewport-bredd; ofarligt eftersom Browserbase kör fast viewport.

## Verifiering

- **Personio** — ~60 unika srcs, 1 entry.
- **Teamtailor** — ~11–15 unika, 1 entry.
- **Talentium** — ~32, 1 entry.

## Inte i scope

`trusted_by` text-entries, stars, org_number FP, badge dedup, geo-proxies.
