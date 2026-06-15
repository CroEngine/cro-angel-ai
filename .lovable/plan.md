## Plan: triagera "Lexend Deca" (reviderad) — A1, A2 eller A3b

Diagnostik-runda. Read-only. Trädet är pruned: `descriptor_missing` utesluter A3a (src-fetch-miss) logiskt.

### Vad signalen redan säger

`reason=descriptor_missing` betyder faceCount=0 **och** ingen matchande descriptor i `document.fonts`. Chromium registrerar en FontFace-descriptor **innan** den hämtar binären — en misslyckad src ger `face.status="error"` men descriptorn finns kvar i `document.fonts`. Det skulle routa till `unresolved`/`fallback`, **inte** `descriptor_missing`. Tomt `fontFetchFailures` bekräftar att inget fetchfel inträffade. Lexend Deca registrerades alltså aldrig som descriptor överhuvudtaget av chromium under replay.

Konsekvens: A3a (din "src pekar på en URL vi aldrig fetchade") nås från `unresolved`, inte härifrån. Stryks från trädet. Fetch-loopen är inte misstänkt för denna signal.

### Reviderat beslutsträd (tre live-utfall)

| Utfall | Var "Lexend Deca" sitter i MHTML | Fix-kategori (nästa runda) |
|---|---|---|
| **A1 — false positive** | Inte i en riktig `@font-face`-CSS-kontext. Regex träffade data: kommentar, JSON-payload, JS-strängliteral, analytics-blob, CSS-in-JS-tema. | Strukturell snävning av extractorn (se notering nedan). |
| **A2 — oanvänd stylesheet** | Riktig `@font-face` i en `text/css`-part, men parten är inte länkad/`@import`:ad från huvud-HTMLn → chromium parsar den aldrig. | Per-korpus known-list (symptomdämpning; se notering). |
| **A3b — rewrite-korruption** | Riktig `@font-face` i en parsead stylesheet, men cid:-injectionen skadade just detta block så chromium inte kan registrera regeln. | Diff:a CSS-text för Lexend Deca-blocket pre/post rewrite. |

### Diagnos-pass (read-only, denna runda)

**Steg 1 — Lokalisera + reconciliera counts samtidigt.**

- Lista varje träff för "Lexend Deca" i rewritad MHTML: part-idx, Content-Type, Content-Location, omgivande ±200 tecken efter QP-decode. Klassificerar A1 vs A2/A3b på första passet.
- Samma pass: **räkna distinkta faces bland de 31 embeddade binärerna** (unika cid:-parts av font-mimetype). Billig probe.
  - **>14 distinkta**: embedded ≠ registered är demonstrerat i denna korpus → A2-priorn höjs konkret → steg 3 (reachability) blir avgöraren, kör det först.
  - **≤14 distinkta**: gapet 31→14 förklaras av multi-format (woff2+woff per face ≈ 2×14 = 28) — säger inget om A2 → luta åt A1 → steg 2 blir avgöraren.

**Steg 2 — @font-face-blockets struktur.**

För varje träff: är den inuti `@font-face { ... }` med valid CSS-syntax (klammer, semikolon, `font-family:` på rätt plats)? Har blocket en `src:`-deklaration? `has-src` är en svag adjunkt — en data-blob som råkar innehålla ett komplett face-stycke besegrar den — men frånvaron av `src:` är fortfarande en tydlig A1-signal när den syns.

**Steg 3 — CSS-partens reachability.**

För text/css-träffar: är Content-Location refererad från huvud-HTML-partens `<link rel="stylesheet">` eller `@import` (transitivt över andra CSS-parts)? Bygg en enkel reachability-graf från huvud-HTML → CSS-parts via Content-Location matchning. Oåtkomliga parts → A2.

**Steg 4 — Rewrite-korruption (bara om steg 1–3 säger "riktig, parsead").**

Diff:a Lexend Deca-blockets CSS-text pre vs post `embedMhtmlFonts`-rewrite. Förändringar i font-family-raden eller skadad blockstruktur → A3b.

**Steg 5 — Cross-check mot diag-output.**

Vi har redan `allDescriptorFamilies` per familj i `corpus/hubspot/render-canary.families.json`. Bekräfta att Lexend Deca verkligen saknas där (formaliserat via `canonMismatch=false`). Detta är dubbelkontroll av premissen, inte en separat hypotes.

### Förhandsnoteringar om fixarna (för nästa runda, planeras inte byggas nu)

**A1-fix — föredra strukturell snävning över "kräv src:":**
Den rena fixen är att bara läsa `text/css`-parts och `<style>`-elementinnehåll (via HTML-parser, inte regex över rå HTML-body). CSS-in-JS-teman och analytics-payloads inlinar ibland kompletta face-strängar i HTML-body — `has-src` stoppar dem inte. `has-src` kan finnas som svag adjunkt, men disease-fixen är strukturell scope-begränsning av vad extractorn ens tittar i.

**A2-fix — known-list är symptomdämpning, namnge valet:**
Den rena fixen vore att vid extraction-tid följa `<link>`/`@import`-kedjor mot Content-Locations och bara extrahera från nåbara stylesheets. Men reachability utan browser är skörare än att låta chromium avgöra. Known-list i `corpus/<name>/meta.json` med `expectedFamiliesIgnore: ["Lexend Deca"]` är pragmatiskt rätt — men meta.json-kommentaren ska säga rent ut att detta är symptom-vs-disease-valet och att disease-fixen (extraction-tid-reachability) valdes bort medvetet, så nästa person vet att alternativet finns.

**A3b-fix:** rewrite-loopens hantering av just det skadade blocket. Inte värt att förhandsplanera — beror på exakt korruptionstyp.

### Förbehåll

`pinned=false` påverkar inte denna runda. `faceCount=0` + ingen descriptor är absolut, inte EPSILON-känsligt. Diagnosen står sig under båda chromium-stackar.

### Inte i denna runda

- Ingen kodändring i `extractEmbeddedFamilies`, `embedMhtmlFonts`, `harness.server.ts` eller `meta.json`-läsning.
- Ingen known-list införd.
- Ingen pinnad Playwright-re-run.

### Leverabler

- Rapport per "Lexend Deca"-träff i MHTML (part-idx, Content-Type, kontext-utdrag).
- Distinkt-face-count bland 31 embeddade binärer.
- Reachability-utfall för varje träffs CSS-part (om träffarna är CSS).
- A1 / A2 / A3b utpekad med data.
- Fix-plan för utpekad rot designas i nästa plan.