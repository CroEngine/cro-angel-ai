# Robust cookie-banner-filter

## Problem
Nuvarande `isCookieBanner()` i `src/lib/tests/scripts/sections.ts` matchar bara på `id`/`class`/`aria-label` (regex på vendornamn) plus role=dialog/alertdialog med textcheck. Den missar:

- **Greenhouse**: cookie-banner som ren `<div>` med Tailwind-utility-klasser utan "cookie"/"consent" i id eller class. Hero-CTA-sloten kapas → `hero.primaryCtaText: "Accept all cookies"`.
- **Rippling**: banner injicerad i portal (utanför `<main>`) med generiska wrapper-klasser; nuvarande 3-hops parent-check hittar inget.
- **Ashby**: tidigare identifierat samma mönster, aldrig fixat.

Effekten: när banner råkar ligga `top < viewportH * 0.4` blir den klassad som `hero` i `classifyType()`, vilket sedan låser `deriveHero()` till bannerns CTA-text.

## Lösning
Skärp `isCookieBanner()` till en **flerlagrad detektion**: utöver befintliga regex-checkar, lägg till en **innehållsbaserad signal** som triggas oavsett klass/id. När en kandidat har banner-typisk text + banner-typiska CTA-knappar betraktas den som cookie-banner.

### Ändringar i `src/lib/tests/scripts/sections.ts`

**1. Utökad vendor-regex** (befintlig `COOKIE_RX`)
Lägg till: `truste|quantcast|iubenda|secureprivacy|termly|cookieyes|cookiehub|ketch|tealium|sourcepoint`.

**2. Ny text/CTA-baserad detektion med nav-guard**
Inuti `isCookieBanner(el)`, efter befintliga checkar, lägg till. Nav-guarden hindrar falska träffar på mega-menyer som innehåller "Cookie policy"-länkar (Personio/HiBob-mönster):

```js
// Pure content signal: short, banner-shaped text + cookie CTA wording.
// Triggers oavsett klass/id/role så portal-rendered banners fångas.
// Nav-guard hindrar mega-menyer med "Cookie policy"-länkar från att matcha.
const isNav = el.tagName === 'NAV' || (el.closest && el.closest('nav, header') !== null);
const rect = el.getBoundingClientRect();
const text = (el.innerText || '').toLowerCase();
if (!isNav && rect.height > 0 && rect.height < viewportH * 0.9 && text.length > 0 && text.length < 1500) {
  const BANNER_PHRASES = /(we use cookies|this (site|website) uses cookies|cookie (preferences|settings|policy)|by clicking ["“']?accept|manage (your )?cookies|your privacy choices|tracking technologies|essential cookies|för att förbättra din upplevelse|vi använder cookies|samtycke till cookies)/;
  const ACCEPT_CTA = /(accept (all )?cookies?|allow all|godkänn (alla )?cookies|tillåt alla|acceptera alla|reject (all )?cookies?|avvisa alla|neka alla)/;
  if (BANNER_PHRASES.test(text) || ACCEPT_CTA.test(text)) return true;
}
```

Engelsk + svensk wording täcker våra benchmark-domäner (HiBob, Workable, Teamtailor, Ashby, Greenhouse, Rippling, Personio).

**3. Belt-and-suspenders i `classifyType()`**
Som extra skyddsnät — om en kandidat passerar `isCookieBanner` men ändå råkar landa i `classifyType` (t.ex. p.g.a. cache), neka hero-klassificering när banner-text upptäcks:

```js
// In classifyType, före hero-checken:
const txt = (el.innerText || '').toLowerCase().slice(0, 600);
if (/accept (all )?cookies?|godkänn (alla )?cookies|we use cookies|vi använder cookies/.test(txt)) {
  return 'content'; // never hero/header for cookie-banner residue
}
```

Detta är en backstop — primärfiltret är `addNode()` → `isCookieBanner()`. Lägger vi denna också i `classifyType` skyddas vi om bannern kommer in via "Direct children of `<main>`" eller "Explicit `<section>/<article>`"-paths där hero-klassificeringen är dominerande.

**4. Diagnostik**
Lägg till `window.__cookieDebug = window.__cookieDebug || []` push när text/CTA-signalen träffar, så vi kan verifiera vad som filtrerats:

```js
try {
  window.__cookieDebug.push({
    tag: el.tagName,
    id: el.id || null,
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
    rectH: Math.round(rect.height),
    matchedBy: 'text', // eller 'regex', 'role'
    sample: text.slice(0, 120),
  });
} catch (_) {}
```

I `src/lib/tests/runners/pageAudit.server.ts` plocka `window.__cookieDebug` på samma sätt som `__wrapperDebug` och `__lazyDebug`. Lägg till `cookieDebug` i `PageAuditData` (`src/lib/tests/schema.ts`) som optional array med samma form.

## Verifiering
- **Rippling**: `hero.primaryCtaText` ska bli "Create free account" (inte tomt och inte "Accept all cookies"); ingen `section[i]` ska ha heading som matchar cookie-wording.
- **Greenhouse**: `hero.primaryCtaText` ska INTE längre vara "Accept all cookies".
- **HiBob/Workable/Teamtailor**: ingen regression — `cookieDebug` visar 0–1 bannerträff per körning; hero stannar oförändrad. Mega-menyer med "Cookie policy"-länkar filtreras bort av nav-guarden.
- **Personio**: ingen påverkan (banner var aldrig hero där); mega-meny stannar som nav.

Efter detta är `flag-rules.ts` redo att köras utan att triggas falskt av cookie-banner-artefakter.

## Filer
- `src/lib/tests/scripts/sections.ts` — utökad regex, text/CTA-detektion med nav-guard i `isCookieBanner`, backstop i `classifyType`, debug-push
- `src/lib/tests/runners/pageAudit.server.ts` — plocka `window.__cookieDebug`
- `src/lib/tests/schema.ts` — `cookieDebug?: Array<...>` på `PageAuditData`
