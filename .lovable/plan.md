Bredda knapp-insamlingen så vi fångar allt klickbart, fokuserar visuellt på CTA, och scrollar igenom sidan innan vi samlar.

### 1. `src/lib/tests/engine.server.ts` — `COLLECT_SCRIPT`

Bredda selektorn:
```
button, a[href], input[type=submit], input[type=button],
[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"],
[onclick], [tabindex]:not([tabindex="-1"])
```

Plus en andra sweep som plockar element med `computedStyle.cursor === "pointer"` och meningsfull text (>1 tecken, <120) som inte redan är med.

Walk shadow DOM rekursivt (samla `el.shadowRoot` och fortsätt querySelectorAll där).

Per element:
- Skip om osynligt: `display:none`, `visibility:hidden`, `opacity:0`, `width=0||height=0`, `aria-hidden="true"`, `disabled`.
- Dedupe: om en träff ligger inuti en annan träff, behåll yttersta (skippa inre om dess closest interactive ancestor redan är insamlad).
- Klassificera till `category`:
  - `form_submit` — `input[type=submit]` eller `button[type=submit]`
  - `cta_primary` — `button` eller `a` med kraftig bakgrundsfärg (alpha > 0.5, kontrast > 3 mot body bg), padding ≥ 8px, text-längd 1–40
  - `cta_secondary` — `button`/`a` med border eller svag bakgrund, text 1–40
  - `icon_button` — width/height < 56 och text-längd ≤ 2 (eller bara aria-label)
  - `nav_item` — `a[href]` inuti `<nav>`/`<header>`/`role=navigation`
  - `link` — övriga `a[href]`
  - `other` — allt annat klickbart
- Lägg till `category` i `CollectedElement`-typen.

### 2. `filterCollected`

För `target: "buttons"`: returnera ALLT klickbart (alla kategorier). Användaren vill se hela bilden.

### 3. Skrollsekvens före `collect`

I `case "collect"` i `runSteps`, innan `page.evaluate(COLLECT_SCRIPT)`:
- Skrolla till 0%, 25%, 50%, 75%, 100% av `document.body.scrollHeight` med 400ms paus mellan.
- Skrolla tillbaka till 0.
- Logga `scrolled page to trigger lazy content`.

### 4. Gruppering i event-data

`data` för collect-step blir:
```ts
{
  target: "buttons",
  count: filtered.length,
  byCategory: { cta_primary: n, cta_secondary: n, ... },
  elements: filtered
}
```

### 5. Overlay-färger i `OVERLAY_FN`

Skicka in `[selector, category]`-par istället för bara selektor. Färgkarta:
- `cta_primary` → emerald (`#10b981`)
- `cta_secondary` → cyan (`#22d3ee`)
- `form_submit` → amber (`#f59e0b`)
- `icon_button` → violet (`#a78bfa`)
- `nav_item` → slate (`#64748b`)
- `link` → blå (`#60a5fa`)
- `other` → rosa (`#f472b6`)

Badge visar `#index` som idag.

### 6. ConsolePanel

Om `data.byCategory` finns på ett `step_passed` collect-event, rendera en liten chip-rad under stegtexten med antal per kategori. Liten visuell uppdatering — ingen ny komponent behövs.

Inga backend-/session-livscykeländringar. Allt sker i collect-steget.