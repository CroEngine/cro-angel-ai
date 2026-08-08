# CRO-rekommendationslagret — steg-för-steg-plan

Målet: göra CRO-rekommendationerna **riktigt bra**, ett steg i taget, med bevarade
garantier. Planen är framtagen ur en flerperspektiv-analys (tre oberoende
planerare + syntes + adversariell kritiker) och härdad mot kritikerns fynd.

## Låsta ägarbeslut (får aldrig brytas)

- **D1 — INGEN OMSKRIVNING.** Enda tillåtna operationerna: flytta/omordna en
  befintlig sektion (`move_up`), och lyfta EN rad sidan redan publicerar ordagrant
  under heron (`insert_snippet`). Att skriva om copy är förbjudet ("annars
  riskerar vi att förstöra"). Detta är en **säkerhetsgaranti att bevara**, inte en
  svaghet att fixa.
- **D2 — HITTA ALDRIG PÅ.** Varje serverat element är en ordagrann delsträng av
  sidan.
- **D3 — RANKA PÅ RIKTIG BESÖKSDATA.** Rekommendationen ska grundas i vad de
  tusentals tidigare besökarna på *just den sidan* faktiskt gör ("är det pris eller
  testimonials?"), inte i hårdkodade sektionstyp-vikter (`PROOF_TYPE_WEIGHT`).
- **D4 — MÄT MOT FACIT.** Rekommendationskvalitet ska utvärderas mot ett facit
  offline innan något skarpt. Idag mäts bara extraktion, aldrig om en
  rekommendation är en *bra* ändring.
- **D5 — STEG FÖR STEG.** En sak i taget, var för sig levererbar och verifierbar.

## Facit utan riktig vinnardata: syntetisk simulator (beslut 2026-08-03)

Vi har ingen riktig A/B-vinnardata än. Lösning som **testar hela maskineriet**
utan att bli cirkulär (kritikerns viktigaste fynd): en syntetisk simulator med
**dold sanning + brus**, samma familj som `winner-calibration`/`guardrail-sim`
redan använder och litar på:

- **Dold sanning (facit):** varje sektion får ett hemligt "riktigt värde" per sida.
- **Observerade sessions (motorns input):** tusentals simulerade besök som
  *samplar* från den dolda sanningen **plus brus** (scroll/klick/dwell).

Motorn ser bara de brusiga sessionerna; facit är den dolda sanningen. Eval:en
mäter då **om beteende-rankningen återfinner sanningen ur brusigt data** — inte
tautologiskt. När riktig vinnardata ackumuleras (efter steg 9–11) byts den dolda
sanningen mot verkliga A/B-utfall; riggen står kvar.

## Spåret

Grinden i varje steg: `bun run typecheck` + `typecheck:scripts` gröna,
snapshot-goldens om-blessade under den chromium playwright pinnar (rev 1223).

### Block A — Korrekthetsgrund (låg risk, mestadels oberoende)

1. **Trogen offline-modell** — ✅ **KLAR.** Bröt ut `collect.summary`-summeraren
   (filter + gruppering + summering, `engine.server.ts` → `collect-summary.ts`) och
   kallar den från både live-motorn och offline-replayvägen (`harness.server.ts`).
   `competingAboveFold` / `primaryConversionCtaCount` / `aboveFold` var tyst null i
   `angel`-rapporten OCH i alla goldens; nu identiska med live. Golden-diffen rent
   additiv, provenance orörd (mhtml oförändrad). Enhetstest låser aritmetiken.
2. **Fixa hero-garbeln** — ✅ **KLAR.** Roterande-ord-heron (`pageAudit.ts`/
   `sections.ts` `cleanHeadingText`) tar den fastfrusna frame:n i stället för att
   klistra ihop alla ord. Kurerad rotator-tokenlista (inte bred substräng —
   `heading-rotator.test.ts` låser att Tailwind/Animate.css-utils inte
   överkollapsar). Fortfarande ordagrann sidtext. [D2]
3. **Engelsk motivering** — ✅ **KLAR.** Svenska strängarna i `candidates.ts`
   (`candidateToOp`/`floorWhy`/`basis`), `candidate-plan.ts`, `auto-generate.ts`
   och `cohort-scopes.ts` bytta mot engelska; "varför"-texten gjord pick-neutral
   (påstår inte att socialt bevis är svaret innan beteendet vägts). [D2, engelsk kvalitet]
4. **Koppla in spakarna** — `rageRefs` + `formAbandonRate` matas in i alla
   produktionsanrop (defaultar tomma idag). Snabbaste riktiga beteendedatan in i
   det som *faktiskt serveras* (fri-designern renderar dem redan). Först: verifiera
   att validatorn (`nightly.ts`) avvisar icke-ordagranna ops innan designern får
   rikare input. [D3, D1-vakt]
   **⏸ SKJUTEN:** rollup-RPC:n (`angel_page_segment_rollup`) returnerar i dag ingen
   form-abandon/rage *per segment*, så "mata in spakarna" vore en no-op utan en
   DB-migration. Ägaren valde facit-först (steg 6) i stället; tas när steg 8–9 ändå
   rör datavägen.

### Block B — Linjalen (FÖRE motorn)

5. **Bevisa sektions-joinen offline** — ✅ **KLAR.** `scripts/section-join-eval/`:
   den RIKTIGA skörde-censusen (`SECTIONS_SCRIPT` via `runPageAudit`, samma sträng
   `adaptive-harvest.js` serverar besökare — ingen TS-omport) via `page.evaluate`
   mot 28 frusna sidor, joinad mot produktionens sida A (**freeze-policyn: rå
   `outerHTML` med dolda delträd kvar** — granskningsrundan fällde en första
   version som mätte på synlig-DOM och därmed en renare modell än produktionens)
   med serving-lokatorns tvåpass-regel (`applier.ts`: exakt rubrik, sedan
   24-teckens prefix), atlas-graderingen UNIK/FLERTYDIG/OUPPLÖST och ett
   injektivitetspass (en census-rubrik kan aldrig krediteras två id:n).
   **Uppmätt 2026-08-05: KANDIDAT-flyttmålEN (sätets nycklar) joinar 81,0 %
   unikt (17/21)** — rollupens grund håller; de fyra missarna är sektioner vars
   rubriker censusen aldrig ser (exakt missklassen steg 8:s per-sida-null-grind
   finns för). Alla A-sektioner 61,2 % (218/356), draget av ärliga fyndklasser
   (inte join-regeln): extraktionen ÖVERSEGMENTERAR listsidor/ecommerce
   (warby-parker 29 A-sektioner) och rå sida A bär fantomsektioner censusen
   aldrig kan se (sector-alarms display:none-video); censusen UNDERSEGMENTERAR
   vissa sidor (cancerfonden 2 av 13). 64,7 % av census-rubrikerna är
   krediterbara under SAMMA tvåpass-regel — resten är förlorad signal, aldrig
   felkreditering. CI-grind: rena join-regel-tester (inkl. injektivitet) +
   chromium-replay över corpus/ med populationsgrindar (tyst korpuskrympning
   fäller) och golv med uttalad diskret marginal (kandidat ≥ 0,70 tål en
   flippad; total ≥ 0,62 ≈ 9 sektioners marginal). Kända gränser dokumenterade:
   redesign-frysen renderar 390×844 mobilt (omvalidera på riktig freeze-utdata
   i steg 8) och LLM-om-typaren kan byta id-SUFFIX (rubriken, join-nyckeln,
   rörs aldrig — id:n slås upp via aktuell modell). `bun run join-eval`. [D3]
6. **Bygg facit-riggen + baslinje** — ✅ **KLAR.** `src/lib/tests/reco-eval/` med
   dold-sanning+brus-simulatorn (ovan). Icke-cirkulär: sanningen dras oberoende av
   sektionstyp. Baslinjen (dagens `PROOF_TYPE_WEIGHT`, = golvets högsta `move_up` på
   varje värld) återfinner facit på **slumpnivå (~29 %, = mean(1/k))**; orakel-på-
   observerat på **~76 %** ⇒ **~47 % mätt, icke-cirkulärt headroom** för steg 7.
   Noll fabricering över 2 000+ slumpade världar (invarianten skopad rätt: ordagrann
   bara för `insert_snippet.detail`, riktigt `targetId` för `move_up`) — plus D2
   genom den riktiga `extractContentModel` på en HTML-fixtur. Committat grindtest +
   `bun run reco-eval`. [D4, D1/D2]

### Block C — Beteende-motorn (varje steg grindat av facit)

7. **Neutralt `behaviorWeight`-säte** — ✅ **KLAR.** `generateCandidates(content,
   behavior?)` med `BehaviorInput { sectionWeight, gain? }`: per-sektion-engagemang
   [0,1] ADDERAS på priorn (beteendet leder, priorn bryter lika). Byte-identisk
   default (låst av test), omranka-ENDAST (katalog-driften grindad till 0 — beteende
   kan aldrig skapa/ta bort ett drag, D1-vakt), och ÄVEN `insert_snippet`-raderna
   förankrade till sin källsektions vikt — granskningens fynd: `extract.ts`
   hårdkodade hemvisten `"body"` så den förankringen var död kod i produktion;
   nu binder extraktionen raden till sektionen som ordagrant bär den (annars
   ärlig `"body"` = neutral), och facit:et grindar förankringen per kandidat
   (`anchorViolationCount === 0`). `BEHAVIOR_GAIN = 40` **facit-valt via
   gain-svep** (0→29,6 %, 5→69,3 %, 20→75,4 %, 40→76,3 %, 100→76,4 % — stiger
   till mättnad; platån ovanför är frö-brus, 40 ligger på platån). **Ärlig
   läsning av facit-utfallet:** sätet matat med perfekt signal når referens-
   taket (76,3 % ≈ 75,8 %) — det är ett **RÖR-TEST by construction** som bevisar
   att kedjan bär signalen förlustfritt och att styrkan räcker för att beteendet
   ska leda; att RIKTIG rollup-data förutsäger konvertering bevisas i steg 8–10
   på samma rigg, när ofullkomlig input (aggregering, join-täckning, tunn data)
   ersätter den perfekta. Rollupen (steg 8) äger datakvaliteten: tunn data ⇒
   null ⇒ katalogen anropas utan säte, precis som idag. [D3]
8. **Ren engagemangs-rollup** — ✅ **KLAR.** `engagement-rollup.ts`:
   rubrik-keyade runtime-observationer → sätets `sectionWeight` (sec-N-typ-id:n)
   via den DELADE join-regeln (`section-join.ts`, utflyttad ur steg 5-eval:en så
   produktion och mätning dömer identiskt: tvåpass + injektivitet). Ärligheten
   är returvärdet: **tunn data (< 1 000 besök) ⇒ null; besöksviktad
   okrediterbar massa > 50 % ⇒ null** — null ⇒ sätet matas inte ⇒ byte-identisk
   katalog. Samma-nyckel-observationer aggregeras före joinen (dagsbuckets ≠
   dubblettsektioner). **Facit-mätt på reco-eval-riggen med OFULLKOMLIG input**
   (2 000 världar): ren rubrik-keyad input förlustfri 2000/2000 (rollup-medierad
   pick == direkta sätets), garblad census räddad av prefix-passet 2000/2000,
   tunn ⇒ null 2000/2000, hög miss-massa ⇒ null 2000/2000 med exakt
   baslinje-fallback. Kvar till steg 10: kalibrera trösklarna mot riktiga sidor
   när steg 9 levererar massa. [D3, D2]
9. **Sänd per-sektion-event från runtime** — ✅ **KLAR.** Observera-bara,
   samtyckesgrindat (samma `send()`-grind som allt annat: GPC/DNT + consent),
   reversibelt (opt-in per install via `data-observe-sections`; av = exakt
   dagens snippet). Snippeten bygger applierns v3-census (main-h2:or utan
   header/nav/footer/aside — spegelkommentar, håll i synk), observerar
   RUBRIKEN per sektion (kort element ⇒ IntersectionObserver-tröskeln
   fungerar även för höga sektioner; samma proxy för alla = rättvis
   rankning), pausar vid flikväxling, och skickar EN `section_engagement`
   per sidladdning vid pagehide: `{sections: [{h, n, d}]}` — rubrik,
   instansantal (rollupens dubblettdom matas ärligt), sedd-tid. Server:
   typen vitlistad + hård sanering i `buildEventRows` (cap 24; h≤120
   cleanText-skrubbad; n 1–9; d ≤ 10 min). Bevisat i riktig chromium på
   RIKTIGA snippeten: census-urval, dwell-mönster (sedd > 0, osedd = 0),
   dubblett-n, och att av-läget är byte-exakt dagens beteende. [D3]
10. **Koppla ihop** — ✅ **KLAR.** Hela röret events → observationer
    (`section-events.ts`, ren aggregering: visits = laddningar som bar
    sektionen, engagement = andel med sedd-tid ≥ 1 s, instances = max n) →
    rollup → `BehaviorInput` in i katalog-anroparen (`buildCandidatePlan`
    `behavior?`-param; `fetchSectionBehavior` är db-hämtningen med null hela
    vägen när datan inte bär). Väljar-menyn visar den UPPMÄTTA andelen per
    flytt-kandidat ("seen ≥1s by 63% of visitors") — aldrig en siffra för
    sektioner utan mätning. CI-grind på hela deterministiska kedjan
    (`behavior-chain.test.ts`): besökssignalen vänder typ-priorns
    rangordning, null-vägen är byte-identisk, menyraden utan data är exakt
    dagens. ÄRLIG NOT: preview/fleet är prospekt-flöden (oinstallerade
    sajter ⇒ ingen data ⇒ null-vägen) — röret är inkopplat och bevisat,
    men riktig trafik flödar genom det först när steg 11 konvergerar
    installerade sajters serverade väg till katalogen. [D3, D4]

### Block D — Skarpt (högst blast radius, sist)

11. **Konvergera den serverade generatorn** (`nightly.ts`, som idag kringgår
    katalogen) till den beteende-rankade katalogen; fri-designern kvar som
    fallback. Grinda på **live icke-underlägsenhet**, inte bara offline-tal. [D3]

## Där perspektiven skilde sig

- **Facit-tajmning:** beteende-först ville ha facit sist; mät-först och minsta-steg
  ville ha det före motorn. → **Facit före** (D4 kräver mät-innan-skarpt, annars
  saknar steg 7–11 ärlig verifiering).
- **Första steget:** collect.summary-fixen vs section-joinen vs facit. →
  **collect.summary först** (både facit och beteende mäts på offline-modellen; den
  måste vara trogen först, och den är lägst risk).
- **Spakarna:** tidigt i den serverade fri-designer-vägen (snabb vinst) vs sent i
  katalogen. → **Tidigt** (tills nightly konvergerar är fri-designern det som
  serveras).

## Öppna beslut

1. **Engagemangsvikt:** dwell/scroll vs klick-rate vs blend → *rek: blend, låt
   facit välja balansen.*
2. **Tunn-data-tröskel** innan beteende slår priorn → *rek: konservativ (~tusen
   besök), volym-viktad.*
3. **Serverad väg:** katalog-primär med designer-fallback vs full cutover → *rek:
   katalog-primär, designer som fallback.*
