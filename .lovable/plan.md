Utöka `CollectedElement` med `position`, `visualWeight`, `intent` och bygg ett `summary`-aggregat. Justeringar enligt feedback inarbetade.

## 1. Nya fält på `CollectedElement`

```ts
position: {
  viewportZone: "above_fold" | "mid_page" | "below_fold";
  yPercent: number; // 0–100, relativt document height
  xPercent: number; // 0–100, relativt document width
};
visualWeight: {
  area: number;
  fontSize: number;
  fontWeight: number;
  backgroundContrast: number; // WCAG-ratio mot sidans bg
  score: number;              // 0–100, normaliserat efter insamling
};
intent: "conversion" | "information" | "navigation" | "social" | "utility" | "unknown";
```

## 2. Position — dokumentrelativt (justering #1)

```js
const docTop = rect.top + window.scrollY;
const docLeft = rect.left + window.scrollX;
yPercent = docTop / document.documentElement.scrollHeight * 100;
xPercent = (docLeft + rect.width / 2) / document.documentElement.scrollWidth * 100;

viewportZone =
  docTop < window.innerHeight ? "above_fold" :
  docTop < 2 * window.innerHeight ? "mid_page" :
  "below_fold";
```

## 3. visualWeight

Per element räknar vi `area`, `fontSize`, `fontWeight`, `backgroundContrast` (WCAG relativeLuminance mot `document.body` bg, fallback `#fff`).
Andra passet normaliserar `score` (0–100):
- 40 % `area / maxArea`
- 20 % `clamp(fontSize, 10, 48)` normaliserad
- 10 % `clamp(fontWeight, 300, 800)` normaliserad
- 30 % `clamp(backgroundContrast, 1, 10)` normaliserad

## 4. Intent — ordlistor

- `conversion`: book, buy, demo, start, get started, sign up, signup, subscribe, request, trial, checkout, order, beställ, köp, boka, prova, kom igång
- `information`: learn, read, explore, see, how, why, about, läs, mer, utforska, så funkar
- `navigation`: login, sign in, account, menu, home, logga in, mina sidor, hem
- `social`: facebook, instagram, linkedin, twitter, x, youtube, tiktok, share, dela
- `utility`: search, sök, language, cookie, accept, godkänn, contact, kontakt
- Form-submits utan ord → `conversion` default
- Inget → `unknown`

## 5. Summary-aggregat (justering #2 — intent-aware)

```ts
data.summary = {
  total,
  aboveFold,
  primaryCtaCount,        // category === "cta_primary" && intent === "conversion"
  competingAboveFold,     // category in ["cta_primary","cta_secondary","form_submit"]
                          // && viewportZone === "above_fold"
                          // && intent !== "navigation"
  topVisualWeight: [{ selector, text, score }] // top 5
  intentBreakdown: Record<intent, number>,
};
```

Loggrad: `collect clickables: 47 · 6 above fold · 3 primary CTA · competing above fold: 5`.

## 6. Konsol-UI

Under befintliga kategori-chips:
- Andra chip-rad: `↑ 6 above fold` · `★ 3 primary CTA` · `⚔ Competing above fold: 5`
- Mini-lista "Top visual weight" (top 3, text + score)

## 7. Overlay

Ingen ändring i denna iteration. Färg per kategori räcker.

## Filer som ändras

- `src/lib/tests/engine.server.ts` — typer + COLLECT_SCRIPT + collect-case (bygg summary)
- `src/components/browser-shell/ConsolePanel.tsx` — typer + chip-rad + top-weight-lista