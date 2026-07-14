# Bredd-test av redesign-kedjan på riktiga sajter (2026-07-14)

**Fråga:** håller frysning → extraktion → pixelgrindar på riktiga, olika sajter —
inte bara labbets plausible.io?

**Metod:** 13 riktiga sidor (9 korpus-MHTML via browser-frysning: bokadirekt ×2,
cancerfonden, cdon, elskling, hibob, hubspot, nextory, sector-alarm; 4 färska
curl-frysningar via `freeze-page.ts`: basecamp, ghost, wordpress-news, linear).
Mekanisk plan per sida (lyft mest bevis-artade under-folden-sektion ×2) —
testar maskineriet, inte designsmak. Harness: `scripts/redesign/breadth-test.ts`.

## Resultat

| Utfall | Sajter | Betydelse |
|---|---|---|
| **PASS** (4) | hibob, nextory, ghost, wordpress-news | Hela kedjan fungerar: flytt applicerad, alla grindar gröna, byte-exakt reversibel |
| **WARN** (8) | bokadirekt-service, cancerfonden, cdon, elskling, hubspot, basecamp, sector-alarm, linear | Flytten VÄGRADES säkert: sektionscontainern är inte ett rent syskon under `main` (djupare wrapper-nästling). Inget gick sönder — systemet tvingar aldrig — men flytt-designs kan inte appliceras på dessa strukturer ännu |
| **FAIL** (1) | bokadirekt | Grinden GJORDE SITT JOBB: flytten hamnade ovanför sidans huvudinnehåll (`movedAboveMain=1`) → designen hålls tillbaka. Så ska ett fail se ut |

**Noll krascher.** Alla 13 laddade, extraherades och mättes. Frysningen höll för
båda vägarna (46 stilmallar på basecamp, 71 bilder på ghost, 3,4 MB linear).

## Fynd, i prioritetsordning

1. **Nästlade sektions-wrappers är den verkliga kapacitetsluckan.** 8/13 sajter
   bygger sina sektioner i wrapper-divar där rubriken-till-container-vandringen
   inte landar på ett flyttbart syskon. Felläget är SÄKERT (vägran, inte
   trasighet) men betyder att flytt-designs idag bara når ~40 % av strukturerna.
   Nästa motorarbete: container-upplösning som hittar närmaste flyttbara
   förfader vars syskon också är sektionscontainrar. Text-designs (set_text)
   påverkas INTE — rubriklokatorer fungerar oavsett nästling.
2. **CTA-intent hittar 0 konverterings-CTA:er på 6/13 sajter** (bokadirekt ×2,
   cdon, elskling, nextory, sector-alarm — alla svenska). CTA-hit-testet blir
   då tomt (0 kontrollerade). Sannolikt vokabulär/struktur-lucka i intent-
   klassificeringen för svenska e-handels/tjänstesidor — värt en egen genomgång.
3. **Extraktionen översegmenterar list-sidor:** bokadirekt gav 60 "sektioner"
   (varje h2 på en listsida). Känd svaghet (feature-tunga sidor); drabbar
   valet av flyttmål men inte säkerheten.
4. **Glutenforum (piloten!) är en React-SPA** — 0 rubriker i server-HTML:en.
   `freeze-page.ts` (curl-vägen) kan inte frysa den; browser-frysningsvägen
   (`freeze.server.ts`, samma som korpusen) krävs. Den fungerar i miljöer med
   utgående browser-nätverk (CI/prod) men inte från denna sandlåda.
   **Konsekvens för piloten:** frys glutenforum via CI-jobbet/browser-vägen,
   inte curl-hjälparen.

## Vad detta INTE säger

Testet mätte den mekaniska kedjan — inte designkvalitet (inga LLM-designer
kördes) och inte serving (ingen av sajterna har snippet + data). PASS betyder
"kedjan kan leverera en verifierad design här"; WARN betyder "text-designs ja,
flytt-designs kräver motorarbetet i fynd 1".

## Uppföljning samma dag: wrapper-upplösning v3 (efter adversariell granskning)

Fynd 1 byggdes (v2) och granskades adversariellt (20 agenter, 17 fynd varav 14
bekräftade — flera reproducerade i riktig Chromium). Granskningen fällde v2:s
naiva klättring ("hela sidan flyttas ovanför headern" på strukturer utan
sektionsnivå; delrenderade SPA-vyer; divergens mellan harnessets och snippetens
semantik). **v3** är svaret:

- **Sektionen** = närmaste förfader (aldrig rubriken själv) som innehåller
  EXAKT EN census-rubrik och har ett census-bärande syskon. Census = h2 i main,
  aldrig header/nav/footer/aside. Ingen sådan nivå ⇒ **vägran**, aldrig gissning.
- **Tvåfas-kontraktet**: alla ops mål upplöses mot ORÖRD, main-scopad DOM
  innan någon mutation; sedan appliceras i planordning. Identiskt i snippet
  och harness — och harnesset är nu EN delad modul (`scripts/redesign/
  measure.ts`), skärmdumpen tas med samma applicering som grindades.
- **Mätningen skärptes**: överlapp per angränsande PAR över föräldergränser,
  "ovanför hjälten" i dokumentordning (ser in i wrappers), reversibilitet på
  element-identitet (inte dubblerbara etiketter), retry-lyft räknas lika i
  mätning och serve_ops.

**Slutresultat (v3, ärliga siffror):** 7 PASS · 3 WARN (mekaniska ×2-planen gav
ingen synlig ordningsändring över spacer-element — plandjup, inte säkerhet) ·
2 NOT_APPLICABLE (v3 vägrade — ingen ren sektionsnivå) · 1 FAIL
(wordpress-news: grinden fångade flytt ovanför sidtiteln — som v2:s mätning
var blind för). v2:s "10 pass" var delvis generositet genom mätblindhet; v3:s
7 är pass att lita på, och de 4 ursprungliga passen består.

**Kvarstående känd gräns (dokumenterad, medveten):** harnesset modellerar inte
serve-tidens vakter (LCP-vakten, no-touch-zoner, hydrerings-residue) — en
verifierad design kan alltså vägras av snippeten hos enskilda besökare
(intent-to-treat-utspädning; besökaren ser baslinjen, aldrig något trasigt).

## Uppföljning: fynd 2 stängt via ÅTERANVÄNDNING (2026-07-14, samma dag)

Ägarens fråga "har inte vi en lösning för CTA med andra språk redan?" — svar: ja,
tre stycken, men redesign-extraktionen använde ingen av dem (egen engelsk regex).
Fixen byggde inga nya listor:

- **`extract.ts` använder nu den delade intent-klassificeraren** (`shared/
  intent.ts` — korpus-minerad EN+SV + strukturregler, samma semantik som
  harvest-skripten). Två medvetna deltan i den delade listan: `\btry\b` in
  (engelska tvillingen till "prova"; mining missade den för att harvest fångar
  "Try X free" via positions-fallbacken) och `book` → `\bbook\b` ("Employee
  handbook"/"Share on Facebook" är inte bokningar — buggen fanns även i
  harvest-skiktet och är lagad på KÄLLAN).
- **Ägarens mål är hit-testets skyddsobjekt**: auto-generate läser
  `conversion_text/kind/selector` ur angel_sites (`--site-config`), måltexten
  unionas in i CTA-listan och `conversion_selector` hit-testas direkt —
  exakt samma sträng/selektor som snippeten räknar konverteringar på i drift.
- **Vakuum-grinden**: `ctaChecked === 0` ⇒ WARN i render-gates (blockerar
  auto-verified) + `ctaChecked` skrivs i evidensbloben. Ett tomt hit-test kan
  aldrig mer se ut som "0 trasiga, allt väl".

**Breddtest v4 (ärliga siffror):** 4 PASS · 6 WARN · 2 NOT_APPLICABLE · 1 FAIL.
Färre "pass" än v3 — för att de tre vakuösa passen (bokadirekt, cdon,
sector-alarm) nu SÄGER att hit-testet inte skyddade något. Svenska vinster:
elskling 4 CTA:er ("Jämför el…", 4/4 klickbara, PASS), nextory 11 ("Prova
gratis nu"…, PASS), bokadirekt 7 hittade (men CMP-overlay i frysningen täcker
dem → ärlig varning). Kvar öppet: cdon (produktlänkar >32 tecken),
sector-alarm (offert-vokabulär saknas i korpusen) — båda syns nu som varningar
i stället för att passera tyst. Ingen tidigare grön sajt tappades.

**Bifynd med egen tyngd:** regenerering av `adaptive-harvest.js` avslöjade att
struktur-skannern (Fas 1, PR #86) lagts direkt i den GENERERADE filen utan att
generatorn (`scripts/build-harvest.ts`) uppdaterades — en regenerering hade
raderat levande funktionalitet. Skannern bor nu i generatorns källa och
artefakten round-trippar byte-exakt (enda diffen mot förr är vokabulär-deltan).
Dessutom porterades `scripts/lab/redesign-render.ts` från sin egen v2-mätning
(tre algoritmer, retry-buggen granskningen fällde) till den delade
`measure.ts` — verifierad mot plausible-fixturen (kollision → retry → PASS,
4/0 CTA:er, byte-exakt reversibel).
