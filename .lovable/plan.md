## Mål

Bygga ut datainsamlingen med deterministisk **trust signal detection** och en explicit **sections-struktur** i `pageAudit`-outputen. Allt sker i `page.evaluate` (Playwright-delen av Stagehand). **Ingen AI i detta steg** — AI kommer senare som tolkningslager ovanpå `pageAudit + clickables + sections + trustSignals`.

## Vad finns redan

- Section-detection per element finns i `COLLECT_SCRIPT.detectSection` → `nav / header / hero / cards / content / footer` (rapporteras som `bySection`-summering).
- `pageAudit` samlar head/headings/images/links/schema/robots/sitemap/flags.

## Vad som saknas

1. **Sections som egen lista** (inte bara summering per element) — en deterministisk inventering av strukturen.
2. **Trust signals** — finns inte alls idag.

## Ändringar

### 1. `src/lib/tests/engine.server.ts`

**A. Utöka `PageAuditData`**

```ts
sections: Array<{
  kind: "nav" | "header" | "hero" | "cards" | "content" | "footer" | "aside";
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  aboveFold: boolean;
  childCount: number;
  repeatedChildren: number; // ≥3 lika barn → cards/grid
  headingText: string;      // första H1-H3 i sektionen
}>;
trustSignals: Array<{
  type: "testimonial" | "review_rating" | "stars" | "trusted_by" |
        "customer_logos" | "certification" | "guarantee" |
        "secure_payment" | "contact_info" | "org_number" |
        "press_mention" | "social_proof_count";
  text: string;
  section: SectionKind;
  aboveFold: boolean;
  selector: string;
  visualWeight: number;     // area-baserat enkelt score
  source: "text" | "attr" | "schema" | "img_alt";
}>;
trustSummary: {
  total: number;
  byType: Record<string, number>;
  aboveFold: number;
};
```

**B. Ny `SECTIONS_SCRIPT` (page.evaluate)**

Walk efter strukturella noder:
- `header, nav, main, section, article, aside, footer`
- `[role=banner|navigation|main|contentinfo|complementary]`
- Top-level direkta children av `<main>` om de är ≥ 200px höga

För varje sektion: rect, aboveFold, antal barn, `repeatedChildren` (samma-tag-räknare för cards/grid), första rubriken som label, `selector` via samma `buildSelector`-helper som redan finns.

**C. Ny `TRUST_SIGNALS_SCRIPT` (page.evaluate)**

Deterministiska regex + DOM-signaler. Patterns (SE + EN):

```
testimonial  : /testimonial|kundröst|kundcitat|"[^"]{40,}"\s*[—–-]\s*\w+/i
review_rating: /\b(\d[.,]\d)\s*\/\s*5\b|\b(\d[.,]\d)\s*av\s*5\b/i
stars         : count of ★ ✦ ⭐ + svg/i[class*="star"] grouped (≥3 in a row)
trusted_by    : /trusted by|används av|våra kunder|featured in|som setts i/i
customer_logos: <section> with ≥4 <img> alla med width<200, monokrom heuristik via filter/style? → bara räkna ≥4 img i bredd-rad
certification : /ISO\s?\d{4,5}|GDPR|HIPAA|SOC ?2|PCI[- ]DSS|certifierad|certified/i
guarantee     : /(\d+)[- ]?(day|dagars?)\s+(money[- ]back|nöjd[- ]kund|garanti)|garanti|guarantee|return policy|öppet köp/i
secure_payment: /secure (checkout|payment)|säker betalning|ssl|stripe|klarna|swish|visa|mastercard/i + img alt-match
contact_info  : tel:/mailto: links, /\b\+?\d{2,3}[\s-]?\d{3,4}[\s-]?\d{2,4}/, postadress med postnr
org_number    : /\b\d{6}-\d{4}\b/ (SE), /VAT[: ]?[A-Z]{2}\d+/i
press_mention : /as seen in|featured in|som setts i|i pressen/i
social_proof_count: /\b(\d{1,3}(?:[ ,.]\d{3})+|\d{4,})\+?\s*(customers|users|kunder|användare|downloads|nedladdningar|reviews|recensioner)/i
```

Per match: bestäm section via samma ancestor-walk, beräkna `aboveFold` mot `window.innerHeight`, plocka närmaste container-element som `selector` (inte raw text node), `visualWeight = rect.w * rect.h`.

Dedupe: samma `type + text(slice 60) + section` räknas en gång.

**D. Anropa i `pageAudit`-case**

```ts
const sections = await page.evaluate(SECTIONS_SCRIPT);
const trust   = await page.evaluate(TRUST_SIGNALS_SCRIPT);
// merge into PageAuditData; add flags:
if (trust.length === 0) flags.push("no_trust_signals");
if (!trust.some(t => t.aboveFold)) flags.push("no_trust_above_fold");
```

### 2. `src/components/browser-shell/findings.ts`

Lägg till två nya finding-sektioner under SEO/CRO/UX-blocken:

- **Struktur (UX)**: lista varje section (kind, aboveFold, childCount, repeatedChildren, headingText).
- **Trust (CRO)**: gruppera trustSignals per `type`, visa total + aboveFold-andel. Warns:
  - `trust.total === 0` → ⚠ "Inga trust signals upptäckta"
  - `trust.aboveFold === 0 && trust.total > 0` → ⚠ "Inga trust signals above the fold"
  - saknar `contact_info` → ⚠
  - saknar `guarantee` / `secure_payment` på sida med form_submit → ⚠

### 3. `src/components/browser-shell/FindingsView.tsx`

Inga nya tabs — bara rendera de nya findings inom befintliga kategorier (UX för sections, CRO för trust). "Download JSON" inkluderar redan hela `pageAudit` så `sections` + `trustSignals` följer med automatiskt.

## Vad som inte ingår

- **AI-tolkning.** Nästa iteration: ett `aiAnalysis`-step som tar `{ pageAudit, collect, sections, trustSignals }` och returnerar CRO-prioriteringar via Lovable AI Gateway. Inte i denna PR.
- Inga ändringar i overlay, frozen-view, Lighthouse, eller export.
- Ingen ändring i Activity-tabben.

## Acceptanskriterier

- `pageAudit.data` innehåller `sections: [...]` och `trustSignals: [...]` + `trustSummary`.
- Findings-vyn visar "Struktur" (sections) under UX och "Trust signals" under CRO.
- Inga nya `act/observe/extract`-anrop — allt körs som `page.evaluate`.
