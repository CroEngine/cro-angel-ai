## Mål
Tre "validera, inte bara existera"-checks i pageAudit-flödet, collect-only:
1. robots.txt syntax-validering
2. Canonical HTTP-status-check
3. JSON-LD schema required-fields-validering

Flaggor (`robots_txt_invalid`, `canonical_dead`, `schema_missing_required`) byggs senare i `flag-rules.ts`. Runnerns `flags: []` förblir tom.

## Filer & ändringar

### 1. `src/lib/tests/runners/pageAudit.server.ts`

**a) robots.txt-parser** (server-side helper):
```ts
function parseRobotsTxt(body: string) {
  const lines = body.split(/\r?\n/);
  const errors: string[] = [];
  const sitemapUrls: string[] = [];
  let currentUA: string | null = null;
  let sawUA = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) return;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) { errors.push(`Line ${i+1}: invalid syntax "${raw.trim()}"`); return; }
    const [, key, val] = m;
    const k = key.toLowerCase();
    if (k === "user-agent") { currentUA = val; sawUA = true; return; }
    if (["allow","disallow","crawl-delay"].includes(k)) {
      if (!currentUA) errors.push(`Line ${i+1}: "${key}" before any User-agent`);
      // Tom path = "tillåt allt" (valid). "*" accepteras av vissa crawlers.
      if (k !== "crawl-delay" && val !== "" && val !== "*" && !val.startsWith("/")) {
        errors.push(`Line ${i+1}: "${key}" path must start with /`);
      }
      return;
    }
    if (k === "sitemap") {
      if (!/^https?:\/\//i.test(val)) errors.push(`Line ${i+1}: Sitemap must be absolute URL`);
      else sitemapUrls.push(val);
      return;
    }
    if (!["host","cleanparam","noindex"].includes(k)) {
      errors.push(`Line ${i+1}: unknown directive "${key}"`);
    }
  });
  return { errors, sitemapUrls, hasUserAgent: sawUA };
}
```

**b) Parallella nätanrop med gemensam 5s-budget** (canonical HEAD + upp till 3 sitemap-HEAD):
```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5000);
const canonicalAbs = audit.indexability?.canonicalUrl && /^https?:\/\//i.test(audit.indexability.canonicalUrl)
  ? audit.indexability.canonicalUrl : null;
try {
  const results = await Promise.allSettled([
    canonicalAbs ? headCheck(canonicalAbs, controller.signal) : Promise.resolve(null),
    ...parsed.sitemapUrls.slice(0, 3).map(u => headCheck(u, controller.signal)),
  ]);
  // map results[0] → canonicalHttp, results[1..] → sitemapDirectives
} finally {
  clearTimeout(timer);
}
```

`headCheck` gör `fetch(url, { method: "HEAD", signal, redirect: "manual" })`, fallback till `GET` vid `405`/`501`. Returnerar `{ status, reachable, redirectsTo }`. Vid abort/nätfel → `{ status: null, reachable: false, redirectsTo: null }`.

### 2. `src/lib/tests/scripts/pageAudit.ts`
Utöka `schema`-blocket: ersätt nuvarande Set-baserad type-samling med per-block-parsning som returnerar:
```ts
schema: {
  count: number;
  types: string[];  // behåll bakåtkomp.
  blocks: Array<{
    type: string | null;
    missingRequired: string[];
    parseError: string | null;
  }>;
}
```
Required-fält-tabellen lever inline i scriptet (browser-side JS-literal):
- `Organization`, `WebSite`: name, url
- `Article` / `NewsArticle` / `BlogPosting`: headline, author, datePublished
- `Product`: name, image, offers
- `BreadcrumbList`: itemListElement
- `FAQPage`: mainEntity
- `LocalBusiness`: name, address
- `Person`: name
- `Event`: name, startDate, location
- Okänd `@type` → ingen check (inga falska larm)

### 3. `src/lib/tests/schema.ts`
```ts
robotsTxt: {
  exists: boolean;
  blocksAll: boolean;
  hasSitemap: boolean;
  syntaxErrors: string[];
  hasUserAgent: boolean;
  sitemapDirectives: Array<{ url: string; status: number | null; reachable: boolean }>;
};

indexability?: {
  // befintliga fält ...
  canonicalHttp: {
    status: number | null;
    reachable: boolean;
    redirectsTo: string | null;
  } | null;  // null när canonical saknas eller är relativ
};

schema: {
  count: number;
  types: string[];
  blocks: Array<{
    type: string | null;
    missingRequired: string[];
    parseError: string | null;
  }>;
};
```

## Verifiering
- **HiBob** — `robotsTxt.syntaxErrors` populerad (PSI rapporterade 2 errors), `canonicalHttp.status: 200`, schema-blocks med ev. missingRequired.
- **glutenforum.se** — verifiera att 5s-budgeten håller hela auditen tight; alla nätfält ska kunna degradera till `reachable: false` utan att blockera resten.
- Sajt utan canonical → `canonicalHttp: null`.
- Robots.txt med tom `Disallow:` → INGEN syntaxerror (regression-test för parsern).

## Filer
- `src/lib/tests/runners/pageAudit.server.ts`
- `src/lib/tests/scripts/pageAudit.ts`
- `src/lib/tests/schema.ts`

## Inte med
- `flag-rules.ts`-flaggor (nästa steg)
- UI i `PageInsightsView.tsx` (efter flaggor)
- ogImage-dimensions, hreflang, sitemap-XML-validering