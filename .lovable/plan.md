## Problem

`hero.primaryCtaText` är fortfarande `"Accept all cookies"` på Greenhouse. Förra fixen (polling + `data-lovable-cookie-root` + filter i `ctas.ts`) verkar inte slå igenom, men vi har ingen signal som visar **var** det går fel:

- Körs polling-blocket alls?
- Hittar `document.querySelector(SEL)` bannern inom 2.5s?
- Sätts `data-lovable-cookie-root="1"` på rätt förälder?
- Och i så fall — varför filtreras inte CTA-knappen bort i `ctas.ts`?

Just nu sätter polling-blocket bara `window.__cookieWaitMs` men inget av detta läses tillbaka till `PageAuditData`. Vi flyger blint.

## Lösning: exponera full diagnostik i en runda

### 1. Utöka polling-blocket i `pageAudit.server.ts`

Lägg till räknare + info om hittat element och taggad rot:

```js
window.__cookiePollAttempts = 0;
window.__cookieFoundEl = null;
window.__cookieRootTagged = null;
window.__cookieWaitMs = null;

const start = Date.now();
const deadline = start + 2500;
while (Date.now() < deadline) {
  window.__cookiePollAttempts++;
  const found = document.querySelector(SEL);
  if (found) {
    const r = found.getBoundingClientRect();
    window.__cookieFoundEl = {
      tag: found.tagName, id: found.id || null,
      cls: (found.className || '').toString().slice(0, 120),
      w: Math.round(r.width), h: Math.round(r.height),
    };
    if (r.width > 50 && r.height > 30) {
      const root = (found.closest && found.closest(ROOT_SEL)) || found;
      try { root.setAttribute('data-lovable-cookie-root', '1'); } catch (_) {}
      window.__cookieRootTagged = {
        tag: root.tagName, id: root.id || null,
        cls: (root.className || '').toString().slice(0, 120),
      };
      window.__cookieWaitMs = Date.now() - start;
      return;
    }
  }
  await sleep(150);
}
window.__cookieWaitMs = Date.now() - start;
```

### 2. Läs tillbaka i `runPageAudit`

Efter `cookieDebug`-läsningen, lägg till:

```ts
const cookiePollAttempts = await page.evaluate("window.__cookiePollAttempts ?? null");
const cookieFoundEl      = await page.evaluate("window.__cookieFoundEl ?? null");
const cookieRootTagged   = await page.evaluate("window.__cookieRootTagged ?? null");
const cookieWaitMs       = await page.evaluate("window.__cookieWaitMs ?? null");
```

Och inkludera dem i returobjektet.

### 3. Lägg till fält i `PageAuditData` (`schema.ts`)

```ts
cookiePollAttempts?: number | null;
cookieFoundEl?: { tag: string; id: string | null; cls: string; w: number; h: number } | null;
cookieRootTagged?: { tag: string; id: string | null; cls: string } | null;
cookieWaitMs?: number | null;
```

Alla optional + nullable så befintliga snapshots inte breakar.

### 4. Lägg till en motsvarande diagnostik i `ctas.ts`

Räkna hur många CTA-element som **filtrerades bort** av cookie-root-checken, så vi ser om guarden träffade alls:

```js
window.__ctaCookieFilterHits = 0;
// inuti loopen:
if (el.closest && el.closest('[data-lovable-cookie-root="1"]')) {
  window.__ctaCookieFilterHits++;
  continue;
}
```

Och läs tillbaka som `ctaCookieFilterHits?: number | null` i `pageAudit.server.ts` → schema.

## Vad diagnostiken kommer berätta

| Värden i utfallet                                                  | Diagnos                                                                       |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `cookiePollAttempts: null`                                         | Polling-blocket körs inte → evaluate-strängen är trasig eller scopet är fel  |
| `cookiePollAttempts > 0`, `cookieFoundEl: null`                    | Polling kör men inga selektorer matchar → bannern har annan struktur          |
| `cookieFoundEl` satt, `cookieRootTagged: null`                     | Hittade element men det var för litet (`w<50 ‖ h<30`) → tröskeln för hård    |
| `cookieRootTagged` satt, `ctaCookieFilterHits: 0`                  | Taggning sker, men `#onetrust-accept-btn-handler` ligger utanför taggad rot → `closest()` missar och vi måste flytta taggen uppåt eller tagga knappen direkt |
| `cookieRootTagged` satt, `ctaCookieFilterHits > 0`, CTA ändå läckt | Något annat skript väljer CTA innan filtret → leta i `deriveHero` / sectionsCTA pipeline |

## Filer

- `src/lib/tests/runners/pageAudit.server.ts` — utöka polling + 4 nya `page.evaluate`-läsningar + spread i return
- `src/lib/tests/scripts/ctas.ts` — räkna filter-träffar
- `src/lib/tests/schema.ts` — 5 nya optional/nullable fält på `PageAuditData`

## Verifiering

Kör Greenhouse igen. Förvänta: ett av scenarierna i tabellen ovan blir tydligt sann och pekar exakt på nästa fix. Inga andra sajter ska påverkas (alla fält är optional).

## Ej i scope

Ingen ändring i klassificering, `deriveHero`, `isCookieBanner`-text-detektion eller H1-logiken denna runda. Vi samlar bara signal.