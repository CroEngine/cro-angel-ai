## Bypass höjdkrav för kända cookie-vendor-id:n

**Rotorsak:** OneTrust renderar `#onetrust-consent-sdk` med h=0 initialt (animeras in via CSS). Tröskeln `h > 30` slår aldrig och `data-lovable-cookie-root` sätts inte → CTA-filtret missar "Accept cookies".

### Ändring

**`src/lib/tests/runners/pageAudit.server.ts`** — i polling-IIFE:n, lägg in en `isKnownVendor`-bypass så att element med känt id (onetrust/cookiebot/usercentrics/didomi/osano) taggas direkt utan storlekskrav:

```js
const isKnownVendor = /onetrust|cookiebot|usercentrics|didomi|osano/i.test(found.id || '');
if (isKnownVendor || (r.width > 50 && r.height > 30)) {
  // existerande tag-block: setAttribute, __cookieRootTagged, __cookieWaitMs, break
}
```

Övrig polling-logik (selektorlista, STYLE/SCRIPT/LINK-filter, `__cookieFoundEl`, `__cookiePollAttempts`) lämnas orörd.

### Verifiering

Kör Greenhouse igen:
- `cookieRootTagged` ska bli ifylld trots `cookieFoundEl.h: 0`
- `ctaCookieFilterHits > 0`
- `hero.primaryCtaText` ska vara verklig CTA, inte "Accept cookies"
