## Mål

Console ska sluta vara en rå event-logg och istället presentera **vad vi hittat** — strukturerat per sida och kategori (SEO / CRO / UX / interaktion). Live-loggen finns kvar som en sammanfälld "Activity"-flik för debugging.

## Ny struktur i `ConsolePanel.tsx`

Två lägen via tabs i headern:

```
[ Findings ]  [ Activity ]
```

### 1. Findings (default)

Aggregerar alla `step_passed`-events till en strukturerad rapport. Grupperas **per sida** (URL), sedan per kategori. Re-renderar live när nya events kommer in.

```text
┌─ https://example.com ─────────────────────────┐
│ ⚠ 4 issues   ✓ 12 checks   · audited 14:32:05 │
├───────────────────────────────────────────────┤
│ SEO                                           │
│  • Title: "Example — Home" (38 chars)         │
│  • Meta description: missing            ⚠     │
│  • H1: 2 found                          ⚠     │
│  • Canonical, lang=sv, og:image ✓             │
│  • Images: 24 total, 3 missing alt (12%) ⚠   │
│  • Schema: Organization, WebSite              │
│  • robots.txt ✓ · sitemap.xml ✓ (87 urls)    │
│                                               │
│ CRO                                           │
│  • Primary CTAs above fold: 1                 │
│  • Competing CTAs above fold: 5         ⚠    │
│  • Top visual weight: "Book a demo" (94)      │
│  • Repeated controls: ×12 "Like", ×8 "Share"  │
│                                               │
│ UX / Struktur                                 │
│  • Sections: nav 1 · hero 1 · cards 8 · ...  │
│  • Above fold: 14 / 67 elements               │
│  • Hidden but interactive: 2                  │
│                                               │
│ Interaktioner                                 │
│  • 67 elements totalt (collect step)          │
│  • CTAs 6 · nav 12 · links 34 · icons 15     │
└───────────────────────────────────────────────┘
```

Varje sektion är fällbar. "⚠ issues" är klickbara och scrollar till raden. Knapp "Download full JSON" per sida.

### 2. Activity

Nuvarande rå event-listan oförändrad (tidsstämpel + `renderEventLine`). För felsökning.

## Implementation

Endast frontend, ny fil + ändringar i `ConsolePanel.tsx`. Ingen ändring i engine/streaming.

**Nya filer:**
- `src/components/browser-shell/FindingsView.tsx` — tar `events: StreamEvent[]`, härleder `PageReport[]` via `useMemo`, renderar grupperat.
- `src/components/browser-shell/findings.ts` — ren funktion `buildPageReports(events)` + `Finding`-typer (`severity: "info" | "warn" | "error"`, `category: "seo" | "cro" | "ux" | "interaction"`).

**Ändrad fil:**
- `ConsolePanel.tsx` — wrappa nuvarande logg i `<Tabs>` (shadcn `Tabs`, redan i projektet), default-tab `findings`. Den befintliga `CollectDetails` + `PageAuditDetails` används bara i Activity-tabben.

**Härledningsregler (`buildPageReports`):**
- Gruppera på `goto`-events: varje `step_passed` med `kind: "goto"` startar ett nytt `PageReport`. Efterföljande `pageAudit` / `collect` / `click` / `screenshot` events hör till denna sida tills nästa `goto`.
- SEO findings: läs `pageAudit.head/headings/images/links/schema/robotsTxt/sitemap/flags`. `flags` blir warns; positiva fält ("title satt", "canonical satt") blir info-checks.
- CRO findings: läs `collect.summary` (primaryCtaCount, competingAboveFold, topVisualWeight, groups).
- UX findings: `collect.summary.bySection`, aboveFold-andel, hidden elements.
- Interaction findings: `collect.byCategory` + total.

**Trösklar för ⚠ (initiala, lätta att justera):**
- `competingAboveFold >= 4`
- `images.missingAltPct > 10`
- `headings.h1Count !== 1`
- `flags.length > 0` (varje flag = en warn)
- Saknad title/description/canonical/og:image

## Inte med i denna iteration

- Lighthouse / Core Web Vitals scoring
- Persistens / dela-länk
- Export till PDF
- Frozen-view overlay-koppling (findings → markera element i screenshot)

Allt detta blir naturliga nästa steg när Findings-vyn finns på plats.
