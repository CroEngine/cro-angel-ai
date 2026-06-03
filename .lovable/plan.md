
# Tech stack, HTTP-headers & PSI entities

Tre additioner — ren datainsamling, inga flags, ingen UI.

## 1. Tech stack-detektion (`pageAudit.ts` + `schema.ts`)

I `page.evaluate`-blocket i `pageAudit.ts`: iterera `document.querySelectorAll('script[src]')`, kör hostname-matchning mot en liten lookup-tabell, och returnera vilka tekniker som hittats.

**Detektorer** (regex/host-substring, körs i ordning):
- `gtm` — `googletagmanager.com/gtm.js`
- `ga4` — `googletagmanager.com/gtag/js` eller `google-analytics.com`
- `intercom` — `widget.intercom.io` / `js.intercomcdn.com`
- `hubspot` — `js.hs-scripts.com` / `js.hsforms.net` / `hubspot.com`
- `hotjar` — `static.hotjar.com`
- `optimizely` — `cdn.optimizely.com`
- `vwo` — `visualwebsiteoptimizer.com` (kategori: experimentation)
- `segment` — `cdn.segment.com`
- `mixpanel` — `cdn.mxpnl.com`
- `amplitude` — `cdn.amplitude.com`
- `fullstory` — `fullstory.com`
- `drift` — `js.driftt.com`
- `zendesk` — `static.zdassets.com`
- `salesforce_pardot` — `pi.pardot.com`
- `marketo` — `marketo.com`
- `facebook_pixel` — `connect.facebook.net`
- `linkedin_insight` — `snap.licdn.com`
- `tiktok_pixel` — `analytics.tiktok.com`
- `cookiebot` — `consent.cookiebot.com`
- `onetrust` — `cdn.cookielaw.org` / `otSDKStub`
- `cloudflare` — `static.cloudflareinsights.com`

Plus detektion via DOM-attribut för saker som saknar dedikerad script-host:
- `hubspot_forms` — `form[data-hsfc]` eller `script[src*="hsforms.net"]`
- `intercom_messenger` — `#intercom-container` finns
- `webflow` — `html[data-wf-page]`
- `wordpress` — `meta[name="generator"][content*="WordPress" i]`
- `shopify` — `script[src*="cdn.shopify.com"]` eller `Shopify`-global

**Schema** — nytt fält i `PageAuditData`:

```ts
techStack: {
  detected: string[];                // sorterad lista, ex. ["gtm", "intercom", "hubspot"]
  byCategory: {
    analytics: string[];             // gtm, ga4, segment, mixpanel, amplitude, hotjar, fullstory
    chat: string[];                  // intercom, drift, zendesk
    marketing: string[];             // hubspot, marketo, pardot
    advertising: string[];           // facebook_pixel, linkedin_insight, tiktok_pixel
    consent: string[];               // cookiebot, onetrust
    cms: string[];                   // webflow, wordpress, shopify
    cdn: string[];                   // cloudflare
    experimentation: string[];       // optimizely, vwo
  };
  thirdPartyScriptCount: number;     // script[src] där hostname !== location.hostname
  firstPartyScriptCount: number;
  items: Array<{                     // alla träffar för debug/transparens
    tech: string;
    category: string;
    source: "script" | "dom" | "meta";
    evidence: string;                // src eller selector
  }>;
}
```

## 2. HTTP response headers (`engine.server.ts` + `pageAudit.server.ts` + `schema.ts`)

Playwrights `page.goto()` returnerar en `Response` med `.headers()`. Idag kastar `goto`-stegget bort returvärdet.

**Ändring i `engine.server.ts`** (case `"goto"`): fånga response från `goto`-anropet och stash:a på page-objektet så pageAudit-steget kan plocka upp det:

```ts
case "goto": {
  const existing = stagehand.context.pages()[0];
  const target = existing ?? (await stagehand.context.newPage(step.url), stagehand.context.pages()[0]);
  const response = existing ? await existing.goto(step.url) : null;
  if (response) {
    (target as any).__lovableLastResponse = {
      status: response.status(),
      headers: response.headers(),  // Playwright lowercase:ar nycklar
      url: response.url(),
    };
  }
  break;
}
```

**I `runPageAudit`** (pageAudit.server.ts): läs `(page as any).__lovableLastResponse` och plocka ut SEO-relevanta headers (case-insensitivt — Playwright lowercase:ar).

**Schema** — nytt fält i `PageAuditData`:

```ts
httpHeaders: {
  status: number | null;
  finalUrl: string | null;            // efter redirects
  cacheControl: string | null;
  lastModified: string | null;
  etag: string | null;
  xRobotsTag: string | null;          // kan sätta noindex utan meta-tagg
  contentType: string | null;
  contentEncoding: string | null;     // gzip/br/zstd
  contentLength: number | null;
  server: string | null;
  poweredBy: string | null;
  strictTransportSecurity: string | null;
  contentSecurityPolicy: string | null;
  link: string | null;                // kan innehålla hreflang/preload via header
}
```

**Indexability — separera källorna.** Behåll `indexability.noindex` som *enbart* meta-baserad (oförändrad logik i browser-scriptet). Lägg till nya fält så flag-systemet kan skilja på dem:

```ts
indexability: {
  ...existing,
  noindexViaHeader: boolean;        // /noindex/i.test(xRobotsTag)
  noindexEffective: boolean;        // noindex || noindexViaHeader
}
```

`indexable` beräknas om i pageAudit.server.ts till `!noindexEffective && robotsTxtAllows`.

## 3. PSI entities (`pagespeed.functions.ts`)

PSI:s Lighthouse-resultat innehåller `audits["third-party-summary"].details.items[]` med per-entity-data.

**I `parsePsi`** — lägg till en parser bredvid `parseResourceSummary`. Entity-fältet kan vara antingen objekt `{ text }` eller rak sträng beroende på Lighthouse-version:

```ts
type ThirdPartyEntity = {
  entity: string;          // "Google Tag Manager", "Intercom", ...
  transferKib: number;
  blockingTimeMs: number;
  mainThreadTimeMs: number;
};

function parseThirdPartyEntities(audit: LighthouseAudit | undefined): ThirdPartyEntity[] {
  const items = audit?.details?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item: any) => {
      const name = typeof item.entity === 'string'
        ? item.entity
        : item.entity?.text ?? 'Unknown';
      return {
        entity: name,
        transferKib: bytesToKib(item.transferSize) ?? 0,
        blockingTimeMs: typeof item.blockingTime === 'number' ? Math.round(item.blockingTime) : 0,
        mainThreadTimeMs: typeof item.mainThreadTime === 'number' ? Math.round(item.mainThreadTime) : 0,
      };
    })
    .sort((a, b) => b.blockingTimeMs - a.blockingTimeMs)
    .slice(0, 10);
}
```

**Schema** — nya fält i `PsiStrategyResult`:

```ts
thirdPartyEntities: ThirdPartyEntity[];
thirdPartyBlockingTotalMs: number;   // summa av items, även de utanför top-10
```

## Vad som INTE ingår

- Inga flag-rules
- Ingen UI-rendering av nya fält
- Ingen normalisering mellan `techStack.detected` och `psi.thirdPartyEntities` (görs vid flag-tid)
- Ingen omskrivning av `goto`-logiken utöver att fånga response

## Verifiering på HiBob

- `techStack.detected` ska innehålla minst `gtm`, troligen `hubspot` + ev. `intercom` + `onetrust` + `vwo`
- `httpHeaders.cacheControl` och `httpHeaders.server` ska vara icke-null
- `httpHeaders.xRobotsTag` ska vara null → `indexability.noindexViaHeader: false`, `noindexEffective: false`
- `psi.mobile.thirdPartyEntities[0]` ska vara den tyngsta leverantören med både `blockingTimeMs` och `transferKib > 0`
- `psi.mobile.thirdPartyBlockingTotalMs` ska vara ≥ summan av topp-10
