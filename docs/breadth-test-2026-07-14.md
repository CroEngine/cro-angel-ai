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
