# Plan: utöka `collect(buttons)` med mer data + live overlay

## 1. Mer data per element (`engine.server.ts`)

Utöka `CollectedElement` med:

```ts
attributes: Record<string, string>;
computedStyles: {
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  padding: string;
  borderRadius: string;
  border: string;
  cursor: string;
  display: string;
};
```

Båda plockas i samma `page.evaluate` som redan körs — `el.attributes` och `window.getComputedStyle(el)`.

## 2. Live overlay i Browserbase-vyn

Efter collect, kör en andra `page.evaluate` som injicerar overlay-divs i sidan:

- Wrapper `<div id="__lovable_collect_overlay__">` med `pointer-events: none; z-index: 2147483647`.
- Per element: absolut-positionerad `<div>` med `rect + window.scrollX/Y`-offset, `outline: 2px solid #22d3ee`, fill `rgba(34,211,238,0.08)`, plus en nummer-badge i övre vänstra hörnet.
- Idempotent: ta bort tidigare `#__lovable_collect_overlay__` först.

Eftersom Viewport-komponenten visar Browserbase live-URL i en iframe ser användaren markeringarna direkt.

## 3. UI — `ConsolePanel.tsx`

`CollectDetails`-listan får per rad:
- Nummer framför (matchar overlay-badge)
- Liten färg-swatch (bg + text-färg från `computedStyles`)
- Badge för "above fold" / "hidden" när relevant

JSON-downloaden inkluderar automatiskt de nya fälten.

## Utanför scope
- Toggle av/på för overlay
- Hover → highlight
- Screenshot/tabell-view

## Verifiering
Kör på glutenforum.se: overlay-rektanglar syns i live-vyn med nummerbadge:r som matchar konsol-listan; JSON innehåller `attributes` + `computedStyles`.
