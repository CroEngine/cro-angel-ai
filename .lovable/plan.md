# Plan: `collect(buttons)` — första datainsamlings-steget

Lägg till ett nytt step `collect` i motorn som samlar interaktiva element från sidan via en enda `page.evaluate`. Vi börjar med `target: "buttons"` men bygger API:t så fler targets (links, forms, headings, images, all) kan läggas till utan att röra runtime-kontraktet.

## 1. Engine — `src/lib/tests/engine.server.ts`

Utöka `Step`-unionen:

```ts
| { kind: "collect"; target: "buttons" /* framtid: | "links" | "forms" | ... */ }
```

Lägg till en case `collect` i loopen som kör en `page.evaluate` som alltid plockar ut **alla** klickbara element från DOM och filtrerar i JS efter `target`. Per element returneras:

- `text` (trimmad innerText, max ~120 tecken)
- `tagName` (`button` / `a` / `input[type=submit]` / `[role=button]`)
- `selector` — prio: `#id` → `[data-testid]` → `[data-*]` → `tag:nth-of-type` fallback
- `href` (om `<a>`)
- `disabled` (boolean)
- `visible` (rect-area > 0 och inom viewport-bredd)
- `aboveFold` (rect.top < window.innerHeight)
- `rect` `{ x, y, w, h }` (avrundade ints)

Resultatet skickas som `data` i `step_passed`-eventet (samma kontrakt som `extract`/`observe` redan använder), plus en kort sammanfattning i `summary` som `collect buttons (N found)`.

Cost: en `page.evaluate`, ingen LLM, ~50 ms — samma mönster som `assertText`-optimeringen.

## 2. Default-test — `src/lib/tests/run.functions.ts`

Default-stegsekvensen ändras från:

```
goto → wait → assertText
```

till:

```
goto → wait → collect(buttons)
```

`assertText` är kvar i unionen och kan användas när en testdefinition skickas in — vi byter bara default.

## 3. UI — `src/components/browser-shell/ConsolePanel.tsx`

- Rendera `collect`-steget med samma status-ikoner (→ ✓ ✗) som övriga steg.
- När `step_passed.data` finns för ett collect-steg: visa en hopfällbar rad med antal hittade element + en kort lista (text + selector) för de första ~5, samt en "Download JSON"-knapp som laddar ner hela arrayen som `buttons-<runId>.json` (Blob → `URL.createObjectURL`).

Inga ändringar i `useTestStream.ts` behövs — `step_passed` med `data` finns redan.

## 4. Inget på `orchestrator.server.ts`, `browserbase.server.ts`, route-filer

Steget körs genom befintlig event-pipeline; ingen ny event-typ behövs.

## Utanför scope (medvetet)

- Lagring i Lovable Cloud — vi sparar inte data ännu, bara visar + ladda ner.
- Crawl över flera sidor — endast den URL som anges i `goto`.
- Andra targets (links/forms/headings/images) — strukturen är redo, men vi wirear bara `buttons` nu.
- Ny "Collect"-knapp i UI — Run-knappen kör default-testet som nu inkluderar collect.

## Verifiering

Efter implementation: klicka Run på `https://glutenforum.se` och bekräfta i ConsolePanel att `collect buttons` listar förväntade knappar (t.ex. "Logga in", "Bli medlem") med selectors, samt att JSON-downloaden fungerar.
