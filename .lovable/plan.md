
# Gör Findings-chipsen begripliga

Rent presentationsproblem: chips som `af`, `competing 0`, `trust 396px`, `form 9999px`, `header` är intern jargong. Datan i `findings.ts` finns redan — skriv om `detail`-strängarna till naturligt språk via små formatter-helpers. Inga ändringar i collectors, schema, scoring, layout eller `FindingsView.tsx`.

## Endast i `src/components/browser-shell/findings.ts`

### 1. Konstanter + helpers överst i filen (efter `f`-helpern)

```ts
const SECTION_LABEL: Record<string, string> = {
  header: "in header",
  hero: "in hero",
  nav: "in navigation",
  navigation: "in navigation",
  footer: "in footer",
  content: "in content",
};

const INTENT_LABEL: Record<string, string> = {
  conversion: "Conversion intent",
  navigation: "Navigation intent",
  utility: "Utility",
  social: "Social",
  // unknown → utelämnas
};

const TRUST_TYPE_LABEL: Record<string, string> = {
  customer_review: "Customer review",
  trust_badge: "Trust badge",
  aggregate_rating: "Aggregate rating",
  contact_info: "Contact info",
  certification: "Certification",
  press_mention: "Press mention",
  client_logo: "Client logo",
  // fallback: titlecase av s.type.replace(/_/g, " ")
};

const formatSection = (s?: string) => (s && SECTION_LABEL[s]) || (s ? `in ${s}` : "");
const formatIntent = (i?: string) => (i ? INTENT_LABEL[i] : undefined);
const formatAboveFold = (af?: boolean) => (af ? "above the fold" : undefined);

const formatCompetingCTAs = (n: number) =>
  n === 0 ? "no competing CTAs" : n === 1 ? "1 competing CTA" : `${n} competing CTAs`;

function formatTrustDistance(px?: number) {
  if (px == null || px >= 1500 || px === 9999) return "no trust signal nearby";
  if (px <= 200) return `trust signal nearby (${px}px)`;
  return `trust signal ${px}px away`;
}

function formatFormDistance(px?: number) {
  if (px === 0) return "inside a form";
  if (px == null || px >= 9999) return "not near a form";
  return `form ${px}px away`;
}

const formatTrustType = (t: string) =>
  TRUST_TYPE_LABEL[t] ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// helper to join only defined bits with " · "
const joinBits = (...bits: Array<string | undefined | false>) =>
  bits.filter(Boolean).join(" · ");
```

### 2. Använd helpers — uppdaterade rader

**CTA per primary (rad 136–145):**
```ts
joinBits(
  formatSection(c2.section),
  formatAboveFold(c2.aboveFold),
  formatIntent(c2.intent),
  formatCompetingCTAs(c2.competingActions),
  formatTrustDistance(c2.nearestTrustSignalDistance),
  formatFormDistance(c2.nearestFormDistance),
)
```

**CTAs total (rad 118–127):**
`${ctas.length} CTAs · ${ps.primaryCtaCount} primary · ${ps.secondaryCtaCount} secondary · ${ps.aboveFoldCtaCount} above the fold`

**Competing CTAs above fold (rad 130):**
detail = `s.competingAboveFold === 0 ? "None" : \`${n} CTAs compete above the fold\``

**Hero primary CTA (rad 101–110):**
`joinBits(\`"${h.primaryCtaText}"\`, formatIntent(h.primaryCtaIntent), formatAboveFold(h.aboveFold))`

**Form-rader (rad 154–163):**
- Label: `Form ${formatSection(fm.section)}${fm.aboveFold ? " (above the fold)" : ""}` → t.ex. `Form in header (above the fold)`
- bits oförändrade

**Trust signal per rad (rad 210–224):**
- Label: `formatTrustType(s.type)`
- detail: `joinBits(formatSection(s.section), formatAboveFold(s.aboveFold), extras.join(" / ") || undefined, \`"${s.text.slice(0, 60)}"\`)`

**Hierarchy (rad 318–328):**
- detail: `joinBits(\`weight ${h.visualWeight}\`, formatSection(h.section), formatAboveFold(h.aboveFold), \`"${h.text.slice(0, 60)}"\`)`

**Sections per rad (rad 298–310):** ersätt jargong i bits:
- `"above fold"` → `"above the fold"`
- `"CTA"` → `"has primary CTA"`
- `"form"` → `"has form"`
- `"trust"` → `"has trust signal"`
- `\`×${n} repeated\`` → `\`${n} repeated items\``

### 3. Konsekvens
Sök/ersätt: alla förekomster av `"above fold"` → `"above the fold"` i filen.

## Inte i scope

- `FindingsView.tsx`, `interpret.ts`, schema, collectors, scoring
- Färgkodning av good/bad/neutral (nästa steg)
- Tooltips med förklaring

## Effekt

CTA `"SKAPA KONTO"` går från:
```
header · af · conversion · competing 0 · trust 396px · form 9999px
```
till:
```
in header · above the fold · Conversion intent · no competing CTAs · trust signal 396px away · not near a form
```
