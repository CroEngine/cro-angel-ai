## Fix cookie-banner polling: skip STYLE/SCRIPT/LINK matches

**Rotorsak:** Selektorn `[id*="onetrust" i]` matchar `<style id="onetrust-style">` först. Eftersom det elementet har w=0/h=0 faller det på storlekströskeln, och loopen returnerar utan att tagga den riktiga bannern.

### Ändring

**`src/lib/tests/runners/pageAudit.server.ts`** — i polling-IIFE:n, byt nuvarande `document.querySelector(SEL)` mot en filtrerad sökning som hoppar över vendor-injekterade icke-visuella taggar:

```js
const found = Array.from(document.querySelectorAll(SEL))
  .find(el => el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT' && el.tagName !== 'LINK');
```

Resten av polling-logiken (storlekströskel w>50 && h>30, `data-lovable-cookie-root="1"`, `__cookieFoundEl`, `__cookieRootTagged`, `__cookieWaitMs`, `__cookiePollAttempts`) lämnas orörd.

### Verifiering

Kör Greenhouse igen och kontrollera:
- `cookieFoundEl` ska peka på `#onetrust-consent-sdk` eller `#onetrust-banner-sdk` (inte `style#onetrust-style`)
- `cookieRootTagged: true`
- `ctaCookieFilterHits > 0`
- `hero.primaryCtaText` ska vara verklig CTA, inte "Accept all cookies"

Ingen ändring i `ctas.ts` eller `schema.ts` — diagnostiken från förra rundan räcker för att bekräfta fixen.
