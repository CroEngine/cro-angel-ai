## Greenhouse: två separata bugs, två oberoende fixar

### Bug 1 — Cookie-banner: timing, inte detection
Bannern (OneTrust) finns **inte i statisk HTML** — den injiceras av ett 3rd-party-script som laddas asynkront. När `SECTIONS_SCRIPT` körs efter scroll-warmupens 1.5s är banner-elementet ofta inte i DOM:en än. Resultat: `cookieDebug: []`, bannern hinner sedan dyka upp och klassas som hero. Detection-koden (`isCookieBanner`) är inte problemet — den körs bara på saker som finns när den körs.

**Lösning: aktiv polling efter cookie-banner före script-batchen.** Efter scroll-warmup, polla upp till ~2.5s efter known cookie-selectors. Bryt så fort en hittas (vanligt fall ~200–500ms efter scroll). Detta ger inga falska väntningar på rena sajter.

```ts
// pageAudit.server.ts — efter scroll-warmup, före Promise.all
await page.evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SEL = [
    '[id*="onetrust" i]', '[class*="onetrust" i]',
    '#osano-cm-window', '[class*="osano-cm" i]',
    '[id*="cookiebot" i]', '[id^="CybotCookiebot" i]',
    '[id*="cookie-banner" i]', '[id*="cookie-consent" i]',
    '[class*="cookie-banner" i]', '[class*="cookie-consent" i]',
    '[id*="truste" i]', '[class*="truste" i]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
    '[id*="usercentrics" i]', '[id*="didomi" i]', '[class*="didomi" i]',
  ].join(',');
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const found = document.querySelector(SEL);
    if (found) {
      const r = found.getBoundingClientRect();
      if (r.width > 50 && r.height > 30) { window.__cookieWaitMs = Date.now(); break; }
    }
    await sleep(150);
  }
})()`);
```

Inget tvingande timeout-vänta — så fort bannern är synlig (`width>50 && height>30`) går vi vidare. Tillägg `window.__cookieWaitMs` för diagnostik (kan exponeras i `cookieDebug` senare om vi vill).

### Bug 2 — Multipla H1 i samma sektion
Greenhouse splittar rubriken över två `<h1>`:
```html
<h1>The only hiring platform you'll </h1>
<h1>ever need</h1>
```
`headings()` i `sections.ts` gör `querySelector('h1,...')` → plockar bara första. Resultat: `headline = "The only hiring platform you'll"`.

**Lösning: när flera `<h1>` finns i samma sektion, sammanfoga dem.** Behåll nuvarande beteende för h2/h3/h4 (alltid första).

```js
function headings(el) {
  const h1s = Array.from(el.querySelectorAll('h1'));
  let heading = '';
  if (h1s.length > 0) {
    heading = h1s.map(h => (h.textContent || '').trim()).filter(Boolean).join(' ');
  } else {
    const h = el.querySelector('h2,h3,h4');
    heading = h ? (h.textContent || '').trim() : '';
  }
  heading = heading.replace(/\\s+/g, ' ').slice(0, 200);
  // subheading: oförändrat
  const sub = el.querySelector('h2,h3,p');
  let subheading = '';
  if (sub && (h1s.length === 0 || !h1s.includes(sub))) {
    subheading = (sub.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200);
  }
  return { heading, subheading };
}
```

Slice höjs från 160 → 200 så längre sammanfogade rubriker inte trunkeras. Subheading: skippas om den sammanfaller med någon h1.

### Filer
- `src/lib/tests/runners/pageAudit.server.ts` — cookie-banner-polling efter scroll-warmup
- `src/lib/tests/scripts/sections.ts` — multi-H1 concat i `headings()`

### Verifiering
- **Greenhouse**: `hero.headline = "The only hiring platform you'll ever need"`, `hero.primaryCtaText` ≠ "Accept all cookies", `cookieDebug` har minst en träff
- **Rippling**: ingen regression — H1 är ett element, cookie-polling lägger till max ~200ms
- **Personio/HiBob/Workable/Teamtailor**: cookie-polling bryts tidigt om ingen banner finns (lägger ~150ms worst case), H1-logik oförändrad

Inga ändringar i klassificering, deriveHero eller CTA-matchning denna omgång.