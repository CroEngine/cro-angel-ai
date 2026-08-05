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
   mot 20 frusna sidor, joinad mot produktionens sida A (`serializeVisibleHtml` →
   `extractContentModel`) med serving-lokatorns exakta tvåpass-regel (`applier.ts`:
   exakt rubrik, sedan 24-teckens prefix) och atlas-graderingen UNIK/FLERTYDIG/
   OUPPLÖST. **Uppmätt 2026-08-05: KANDIDAT-flyttmålen (sätets nycklar) joinar
   88,2 % unikt (15/17)** — rollupens grund håller. Alla A-sektioner 71,7 %
   (170/237), draget av två ärliga fyndklasser (inte join-regeln): extraktionen
   ÖVERSEGMENTERAR listsidor (bokadirekt-service: varje tjänst en h2) och censusen
   UNDERSEGMENTERAR vissa sidor (cancerfonden 2 av 13, patagonia 1, supabase-
   flikar dolda per tab). Omvänt kan 73 % av census-rubrikerna krediteras någon
   A-sektion — resten är förlorad signal (aldrig felkreditering). Rotator-garble
   räddas i praktiken av prefix-passet (hubspot 7/7). CI-grind: rena
   join-regel-tester + chromium-replay över corpus/ med golv strax under uppmätt
   (kandidat ≥ 0,80; total ≥ 0,62). `bun run join-eval`. [D3]
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
8. **Ren engagemangs-rollup** — datamotsvarigheten till `PROOF_TYPE_WEIGHT`. Tunn
   data → null (ingen fantomvikt). Hög join-miss → också null (ingen skev
   delbild). [D3, D2]
9. **Sänd per-sektion-event från runtime** — observera-bara, samtyckesgrindat,
   reversibelt. Börjar samla "tusentals besök"-datan. [D3]
10. **Koppla ihop** rollup → sätet hos katalog-anroparna + visa engagemang i
    selector-menyn. CI-grindar på den deterministiska vägen (inte LLM). [D3, D4]

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
