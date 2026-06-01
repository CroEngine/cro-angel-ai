## Implementera vald riktning: Structured metric cards

Fyra arbetsfiler. Innehållet komprimeras nedan.

### 1. Fonts + tokens (`src/styles.css`, `src/routes/__root.tsx`)

- Lägg till Google Fonts-länk för **Sora** (400/600/700) och **Manrope** (400/500/600) i `__root.tsx` `<head>`.
- I `styles.css`: lägg `--font-heading: 'Sora'` och `--font-body: 'Manrope'` på `:root`, sätt `body { font-family: var(--font-body) }`, och skapa en utility-klass `.font-heading { font-family: var(--font-heading) }` (eller mappa via Tailwind v4 `@theme`).
- Palett-tokens redan semantiska — inget byte krävs (prototypens `#fafbfc / #e8ecf1 / #94a3b8 / #3b82f6` matchar `background / border / muted-foreground / primary` i Cloud White-temat tillräckligt nära).

### 2. `findings.ts` — lägg till en lätt typ-tagg per Finding (valfritt fält)

Lägg till `kind?: "status" | "metric" | "quote" | "stats" | "text"` i `Finding`-typen. Sätt det på rätt ställe där finding skapas (snabb pass per kategori), så `FindingsView` kan välja kort-variant utan att gissa via regex.

### 3. `FindingsView.tsx` — rewrite enligt prototyp

**`PageCard` header (sticky):**
```tsx
<header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4 rounded-t-xl">
  <div className="flex flex-col gap-0.5">
    <h1 className="font-heading text-sm font-bold text-foreground">{hostname}</h1>
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <p className="text-xs text-muted-foreground">{count} datapoints analyzed</p>
    </div>
  </div>
  <Button variant="outline" size="sm" className="...">Download JSON</Button>
</header>
```

**Body:** `p-5 space-y-8`.

**`CategorySection` header:**
```tsx
<div className="mb-4 flex items-center gap-3">
  <h2 className="font-heading text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</h2>
  <div className="h-px flex-1 bg-border" />
  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{n}</span>
</div>
```
Klick på rubriken växlar öppet/stängt (samma som idag, men hela headern är toggle-zon).

**Grid:** `grid grid-cols-2 gap-3`. Vissa kort spänner 2 kolumner när värdet är långt (citat / sektionsordning) — använd `col-span-2`.

**Kort-varianter (en liten `<FindingCard>` med switch på `kind`):**

- `status` — pill (`Found` grön, `Missing` amber, `Set` blå) + valfri italic detalj.
- `metric` — stort tal (`font-heading text-xl font-bold`) + liten enhet under.
- `quote` — italic text + liten blå punkt vänster, `col-span-2`.
- `stats` — header-rad: label vänster + huvudsiffra blå höger, divider, 3-kol mini-stats (Primary/Secondary/Above fold etc.).
- `text` (default) — label + värde + ev. liten mono-chip (t.ex. `56 chars`).

Wrap: `rounded-xl border border-border bg-muted/30 p-4`. Hover: `hover:border-primary/40 transition-colors`.

**Tom-läge:** behåll `min-h-full items-center justify-center` med engelska texten.

### 4. Engelska kategori-namn

`CATEGORY_LABELS` byts till: `SEO Analysis · Conversion (CRO) · UX & Structure · Interactions`.

## Vad jag INTE gör

- Ingen ny data/sökning/filter — bara presentation.
- Ingen footer-rad ("scan v2.4.1 / 1.2s") — fabricerar inte data som inte finns.
- `findings.ts`-utdata för värden är oförändrad (bara `kind`-tagg läggs till).
- Inga ändringar i `engine.server.ts`, ConsolePanel-shell, Viewport.

## Resultat

Findings ser ut som prototypen: ren vit panel, kategori-band med uppercase-label + divider + count-pill, 2-kols kort-grid med varianter för status/metric/quote/stats/text. Sticky header med URL + grön ready-dot + Download JSON-knapp behålls.