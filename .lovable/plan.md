## Problem

När man expanderar alla kategorier i en `PageCard` växer kortet förbi viewporten och måste skrollas — men header-raden (med URL + **Download JSON**) skrollar bort tillsammans med innehållet. Det är då Download JSON "försvinner".

## Lösning

Gör kortets header sticky inom Console-panelens scrollkontainer så Download JSON alltid är nåbar oavsett hur mycket man expanderar.

### Ändring i `src/components/browser-shell/FindingsView.tsx` (rad 88)

```tsx
<div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-3 py-2 rounded-t-md">
```

(Lägger till `sticky top-0 z-10` + `bg-card` + `rounded-t-md` så den inte blir transparent när den limmar fast.)

Inget annat behöver ändras — ScrollArea i `ConsolePanel.tsx` hanterar redan vertikal skroll, och kortets innehåll växer naturligt nedåt.

## Resultat

- Expandera SEO/CRO/UX/Interaktioner → panelen växer nedåt och blir skrollbar.
- URL + Download JSON limmar i toppen av kortet medan man bläddrar igenom findings.