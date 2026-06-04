## Mål
Köra layout-känsliga delar av pageAudit i två viewports (desktop + mobil) på samma Browserbase-session via CDP-emulering + reload, så vi får mobil-specifik data (CTA under fold, hero pushed down, trust borta från fold) som idag saknas. SEO/headers/schema körs inte om.

## Vad som körs i mobil-passet
Endast viewport-känsliga scripts:
- `SECTIONS_SCRIPT`
- `CTAS_SCRIPT`
- `TRUST_SIGNALS_SCRIPT`
- `VISUAL_HIERARCHY_SCRIPT`
- `dims` (`pageHeightPx`, `foldHeightPx`)

Hoppas över: head, schema, hreflang, images, links, robots/sitemap, httpHeaders, indexability, contentMetrics, tech stack, videos, resourceHints, forms, navigation. Dessa är viewport-oberoende.

## Viewport-strategi mot Browserbase
Stagehand exponerar `stagehand.context` (Playwright BrowserContext). Vi har bara *en* kontext per session — `newContext()` är inte garanterat tillgängligt. CDP-override fungerar på samma `page` och persisterar tills den rensas.

**Kritisk ordning** (flip-only räcker inte — JS-driven responsivitet som hamburgermeny initieras vid load via `matchMedia` utan resize-lyssnare, så desktop-DOM:en sitter kvar efter en ren metrics-flip):

```ts
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
});
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
await cdp.send("Emulation.setUserAgentOverride", {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});
await page.reload({ waitUntil: "networkidle" }); // mobil-renderad från noll
// scroll-warmup för lazy-content
// window.scrollTo(0,0) + kort vänta på reflow
// collectLayoutPass(page)
// rensa ALLA tre overrides
await cdp.send("Emulation.clearDeviceMetricsOverride");
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
await cdp.send("Emulation.setUserAgentOverride", { userAgent: "" });
```

**Pipeline-ordning**: mobil-passet körs som *sista DOM-beroende steg*. Allt overlay/screenshot/desktop-arbete sker före, eftersom reload i mobilläge ger en mobil-renderad DOM som inte återställs av `clearDeviceMetricsOverride` (det rensar bara metrics, inte HTML som servern levererat under mobil-UA).

**Korrekthet under mätning**: explicit `window.scrollTo(0,0)` + kort sleep före `collectLayoutPass` i mobil-passet, eftersom `getBoundingClientRect().top` är viewport-relativ och scroll-warmup lämnar sidan nedscrollad.

**Fallback** om CDP-callet kastar (äldre Browserbase-image): logga warning, sätt `layout.mobile = null` + `viewportDelta = null` istället för att krascha runnern.

## Ändringar

### 1. `src/lib/tests/runners/pageAudit.server.ts`
- Refaktorera viewport-känsliga delarna av `Promise.all` till `collectLayoutPass(page)`:
  ```ts
  async function collectLayoutPass(page: Page) {
    const [sections, trustSignals, ctas, visualHierarchy, dims] = await Promise.all([
      page.evaluate(SECTIONS_SCRIPT),
      page.evaluate(TRUST_SIGNALS_SCRIPT),
      page.evaluate(CTAS_SCRIPT),
      page.evaluate(VISUAL_HIERARCHY_SCRIPT),
      page.evaluate("({ pageHeightPx: document.documentElement.scrollHeight, foldHeightPx: window.innerHeight })"),
    ]);
    return { sections, trustSignals, ctas, visualHierarchy, dims };
  }
  ```
- Desktop-passet använder `collectLayoutPass` direkt (befintlig logik).
- Efter overlay/screenshot/desktop-arbete: kör mobil-passet (emulering → reload → warmup → scroll 0 → `collectLayoutPass` → rensa overrides).
- Bygg `pageSummaryMobile` via befintliga `enrichSections` + `buildPageSummary` på mobil-datan.
- **`foldDepthFirstCtaPx` är redan absolut dokument-Y** i `buildPageSummary` (använder `c.rect.y` som sätts via `top + window.scrollY` i sections-scriptet — bekräfta detsamma gäller i `ctas.ts` när vi implementerar). Båda passen jämför då samma enhet.
- I returobjektet, lägg till `layout` + `viewportDelta`. Behåll top-level `sections`, `ctas`, `trustSignals`, `pageSummary`, `hero` (desktop) oförändrade.

### 2. `src/lib/tests/schema.ts`
Lägg till på `PageAuditData`:
```ts
layout?: {
  desktop: {
    pageSummary: PageSummary;
    trustSummary: TrustSummary;
    heroAboveFold: boolean;
  };
  mobile: {
    pageSummary: PageSummary;
    trustSummary: TrustSummary;
    heroAboveFold: boolean;
    // Bevarad flag-specificitet — räcker för "BOKA EN DEMO hamnar under fold på mobil"
    primaryCtas: Array<{ text: string; intent: string; aboveFold: boolean; foldDepthPx: number }>;
    aboveFoldTrust: Array<{ type: string; text?: string }>;
  } | null;
};
viewportDelta?: {
  aboveFoldCtaCount: { desktop: number; mobile: number };
  foldDepthFirstCtaPx: { desktop: number | null; mobile: number | null };
  aboveFoldTrustCount: { desktop: number; mobile: number };
  heroVisibleMobile: boolean;
} | null;
```
Tunt schema + minimal element-info (~3–4 element) bevarar payload-storleken och ger flag-motorn namngivna element att referera till.

### 3. Inga ändringar i `pageAudit.ts`-scriptet
`window.innerHeight` används redan för fold-beräkningar i sections/ctas/trust/visualHierarchy. CDP-emuleringen skriver över `window.innerWidth/innerHeight` enligt CDP-specen — ingen scriptändring behövs.

### 4. `.lovable/plan.md`
Uppdatera: tech stack klar (wordpress + tealium + favicon), mobile-viewport tillagt. Nästa steg: `flag-rules.ts` med mobil-flaggor (`cta_below_fold_mobile`, `hero_pushed_down_mobile`, `no_trust_above_fold_mobile`) som första kategori.

## Verifiering
Kör page audit mot `https://www.hibob.com/se/` och kontrollera i JSON:
- `layout.desktop.pageSummary.foldDepthFirstCtaPx` är ett finit tal
- `layout.mobile.pageSummary.foldDepthFirstCtaPx` är ett finit tal (inte hårdkodat > desktop — kortare mobil-hero kan lyfta CTA:n; assertera bara att fold-räkningen är korrekt omräknad mot mobil `foldHeightPx`)
- `viewportDelta.heroVisibleMobile` är boolean (inte undefined)
- `layout.mobile.primaryCtas[0].text` innehåller faktisk CTA-text (t.ex. "Boka en demo")
- Befintliga desktop-fält oförändrade (snapshot-diff mot tidigare run)
- **Sanity-diff**: kör en flip-only-variant lokalt och jämför sektion/CTA-counts mot reload-varianten. Om de skiljer materiellt på HiBob bekräftar det att reload-vägen är nödvändig (förväntat).

## Out of scope (denna runda)
- Mobil-specifik tech stack / forms / navigation
- Full mobil-section-array i JSON
- Flag-generering i `flag-rules.ts` (nästa steg, separat plan — gärna designad innan så `evidence`-pekaren kan referera både `layout.desktop.*` och `layout.mobile.*`)
