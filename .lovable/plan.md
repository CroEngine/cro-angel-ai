## Status

### Klart
- Tech stack-detektion: wordpress, tealium, onetrust, vwo, etc. + förfinade scriptklassificering (first/third party).
- Favicon-extraktion i `head`-blocket.
- Mobil-viewport-pass: `layout.desktop` + `layout.mobile` + `viewportDelta` via CDP-emulering (390×844, iPhone UA, touch) + full reload, körs som sista DOM-beroende steg. Mobil-passet återställer alla overrides i `finally`-block; misslyckas tyst med `mobile: null` om CDP inte är tillgängligt.

### Nästa steg
`flag-rules.ts` — flag-motor som läser collected data och producerar `{ id, category, severity, evidence, confidence, recommendation }`.

Första kategorin: **Mobile Experience**, drivs av `viewportDelta` + `layout.mobile`:
- `cta_below_fold_mobile` — `viewportDelta.aboveFoldCtaCount.mobile === 0 && .desktop > 0`. Evidence pekar på `layout.mobile.primaryCtas[0].text` + `.foldDepthPx`.
- `hero_pushed_down_mobile` — `viewportDelta.heroVisibleMobile === false && layout.desktop.heroAboveFold === true`.
- `no_trust_above_fold_mobile` — `viewportDelta.aboveFoldTrustCount.mobile === 0 && .desktop > 0`.

Evidence-pekare ska stödja både `layout.desktop.*` och `layout.mobile.*` så desktop-flaggor (ex. `cta_low_contrast`) kan landa i samma motor utan ändring.
