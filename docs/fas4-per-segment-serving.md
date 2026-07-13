# Fas 4 — servera en verifierad variant per segment (design)

> DESIGN, inte byggd. Steg 7 i ägarens flöde: när en genererad + verifierad
> variant finns för ett segment, servera den till just det segmentet, A/B mot
> kontroll, och låt vinnaren bli ny baseline. Detta dokument visar hur det faller
> ut PÅ BEFINTLIG maskinery — nästan allt finns redan; steg 4 är mest ihopkoppling,
> inte ny motor. Att faktiskt dirigera riktig trafik är ett **ägarbeslut** och
> byggs inte osupervisat.

## Nyckelinsikt: en variant ÄR redan en apply-lista

En redesign-plan (Fas 3) är en kort lista **reversibla ops** —
`move_up / set_text / condense / reveal` — exakt samma vokabulär som snippeten
(`public/adaptive.js`) redan applicerar och `decide()` redan returnerar. Att
servera en variant = att `decide()` returnerar variantens ops i stället för (eller
utöver) mönstermotorns, för besökare i rätt segment. Inget nytt apply-lager.

## Vad som REDAN finns (och återanvänds rakt av)

| Behov | Finns i | Not |
|---|---|---|
| Besökarens segment | `context.ts` → `trafficSource`, `device`, `country`, `isReturning` | **exakt** de fyra dimensionerna i segmentnyckeln `kanal·enhet·land·ny` |
| Segment-medveten decide | `decide.ts` + `loadPatternBoosts(site, trafficSource)` | motorn grenar redan på trafik/enhet/retur |
| Hold-out-bucketing | `decide.ts` (FNV-hash på `visitorHash` % 100 < `holdoutPct`) | deterministiskt per besökare — samma besökare, samma arm |
| Exponeringslogg + withheld | `logDecision(...)` (`withheld`, `changes[]`) | mätunderlaget för lift finns redan |
| Per-segment lift-verdikt | mätlagret (D4, `loadPatternBoosts` per segment) | "vann varianten i DETTA segment, adekvat pow?" |
| Osynlig-som-standard grind | `angel_sites.adaptations_enabled` | inget serveras förrän ägaren aktivt slår på |
| Volymgrind per segment | `aggregate.ts` `adequate` (1000 besök/100 konv) | servera bara segment som bär ett test |
| Verifierad variant | Fas 3: strukturgrind + pixelgrind (PASS) + claims-grind | en variant når hit bara om den är trogen + snygg + icke-uppfinnande |

## Vad som behöver byggas (litet, avgränsat)

### 1. Variant-lager (lagring)
En verifierad variant = `{ site, path, segmentKey, ops[], status, verifiedAt, evidence }`.
- `segmentKey`: samma grov→fin-nyckel som dashboarden (`google·phone·se`), så
  serverings-matchning och segment-analys talar samma språk.
- `status`: `candidate → verified → serving → winner | retired`. Bara `serving`
  (och `winner`) returneras till besökare.
- `evidence`: FÖRE/EFTER-skärmdump + grind-verdikt + claims-diff (från Fas 3) —
  spårbart varför varianten släpptes.
- Lagras i egen tabell (`angel_variants`), RLS/`service_role` som segment-rollupen.

### 2. Matcha besökare → mest specifik verifierad variant — **BYGGD** (`serve.ts`, gated off)
Den enda **beslutsoberoende** biten är byggd som en ren funktion och testad, men
INTE inkopplad i den levande `decide`-vägen (inget dirigeras):
- `visitorSegmentKey(segment)` bygger besökarens fulla `kanal·enhet·land·retur`-
  nyckel med EXAKT samma tokenisering som dashboard-rollupen (`aggregate.ts`), så
  servering och analys delar en nyckel.
- `matchVariant(variants, visitor)` väljer den `serving`/`winner`-variant vars
  `segmentKey` är det **längsta prefixet** (dimensions-vis) av besökarens nyckel —
  finaste vinner; en grövre `google`-variant "lånar styrka" tills `google·mobile·se`
  finns; ingen match → `null`. Bara `serving`/`winner` serveras (candidate/verified/
  retired aldrig) → osynlig-som-standard hålls i koden.
- ÅTERSTÅR (väntar på ägarbeslut + variant-lagret): koppla in i `decide.ts` när
  `adaptationsEnabled` + servering på, och returnera variantens `ops` som
  `decision.adaptations` märkta `source:"variant"`.

### 3. A/B via BEFINTLIG hold-out
Ingen ny bucketing. `holdoutPct` (t.ex. 50) → halva segmentet får varianten,
halva är kontroll (snippeten undanhåller ops:en, `withheld:true`). `logDecision`
loggar redan bådadera → per-segment lift beräknas som idag (D4-vägen), nu med
`source:"variant"` + `variantId` i `changes[]`.

### 4. Lärande-loop (steg 7)
När ett segments variant-arm slår kontroll **adekvat powered**:
`status: serving → winner`. En vinnare kan (a) förbli den serverade varianten,
och (b) bli **ny baseline** som nästa generation itererar från — Fas 3 kör igen
med vinnaren som utgångsläge. Förlorare → `retired`, kontroll återtar 100 %.

## Livscykel (en variant)

```
genererad (Fas 3 ops)
  → strukturgrind + pixelgrind (PASS) + claims-grind   [verified]
  → ägaren slår på servering för segmentet              [serving]  ── A/B mot kontroll (holdout)
  → adekvat lift > 0 ?  ja → winner (ev. ny baseline)   |  nej → retired (kontroll 100 %)
```

## Grindar (så vi aldrig försämrar sidan för riktig trafik)

1. **Osynlig som standard:** inget serveras med `adaptations_enabled=false`.
   Servering kräver dessutom en egen, uttrycklig per-segment på-slagning (ägaren),
   inte en global switch.
2. **Bara verifierade varianter:** `status=serving` nås bara efter PASS på alla tre
   Fas 3-grindarna. En variant som failar pixel/claims kan aldrig serveras.
3. **Bara adekvata segment:** servera inte ett segment som inte bär ett test
   (`adequate=false`) utom med samma ärliga ägar-override som Fas 2, med osäkerhet
   visad.
4. **Reversibelt:** ops:en är reversibla per konstruktion; en `serving`-variant kan
   nollas till kontroll direkt (sätt `holdoutPct=100` eller `status=retired`) — ingen
   deploy, bara config.
5. **En liten ändring i taget:** `MAX_OPS` (5) gäller varianten; vi servererar inte
   en total-omskrivning, bara den verifierade lilla omflyttningen/omtextningen.

## Beslutat av ägaren (2026-07-12) — reglerna för en försiktig v1

Standardläge för allt nedan: **helt av**. Inget rör riktig trafik förrän en
människa aktivt slår på det per segment/experiment.

1. **Aktivering: manuell dashboard-toggle.** Varje kund/experiment måste slås på
   manuellt i dashboarden (inte DB-only — svårare att förstå operativt).
2. **Trafikfördelning: ramp.** Börja inte på 50/50. Konfigurerbar ramp, start på
   **5 %** → 10 % → 25 % → 50 %, så skadan begränsas om en variant är tekniskt OK
   men dålig för konvertering/UX.
3. **Vinstkriterium: rekommendation först efter data- OCH konfidensgrindar** — en
   variant blir aldrig vinnare på ett par besök:
   - minst **1 000** kvalificerade besök per arm,
   - minst **50** konverteringar per arm,
   - minst **95 %** konfidens (frekventist) eller motsvarande Bayesiansk säkerhet,
   - minst **~5 %** praktiskt relevant relativ förbättring (MDE),
   - **ingen** tydlig försämring av sekundära skyddsmått.
   Exakta gränser får variera per kunds trafik/konverteringsnivå. Systemet
   **rekommenderar** bara — det byter inget självt.
4. **Baseline-byte: manuellt godkännande.** Systemet får rekommendera en vinnare
   automatiskt, men ersätter inte baseline utan mänskligt OK (v1).

### Implementations-not
- Grind 3 ska **återanvända** den befintliga signifikans/lift-verdikten i
  `performance.server.ts` (`MIN_ARM_EXPOSURES`/`MIN_ARM_OUTCOMES` + significant/lift,
  D4) och lägga ägarens extra trösklar ovanpå — inte uppfinna en ny statistik.
- Config-fält (default av): `serving_enabled` (per site, som `adaptations_enabled`),
  `ramp_pct` (start 5), plus variant-`status`. `holdoutPct` styr redan A/B-splitten.

## Vad som byggts hittills (gated off)
- **Matchningskärnan** (`serve.ts`, PR #96): `visitorSegmentKey` + `matchVariant`
  (finaste prefix vinner, låna styrka, bara `serving`/`winner`). Ren + testad, INTE
  inkopplad i den levande `decide`-vägen.
- **Vinnar-utvärderaren** (`winner.ts`, PR #96): `evaluateWinner(variant, control,
  sekundärmått)` → `insufficient_data | no_winner | recommend_winner |
  recommend_stop` enligt grind 3, ovanpå SAMMA signifikansmatematik som
  mönster-attributionen (`twoProportionZ`, |z| ≥ 1.96, success–failure-regeln — en
  definition, ingen drift). `recommend_stop` nås medvetet UNDER vinnarvolymen:
  en variant som är signifikant sämre ska dras tidigt, inte bränna trafik till
  1000 besök. Rekommendation only — baseline-byte kräver alltid manuellt OK.

- **Variant-lagret + master-toggeln** (PR:t efter #96): `angel_variants`-tabellen
  (livscykel-status, ops, evidence; RLS service-role-only; partiellt unikt index =
  högst EN serving/winner per (site, path, segment) — verifierat mot prod) +
  `angel_sites.serving_enabled` (default **false**, 0/9 sajter på). Dashboarden
  fick ett "Varianter per segment"-kort (livscykelvy + master-toggeln) och
  `loadServableVariants(site, path)` finns i persistence — men **decide-vägen
  läser ingetdera ännu**: kontrollen landar före förmågan. Den första äkta
  varianten (instagram·mobile·se försök 2, verified, med grind-bevis i evidence)
  ligger i lagret för synthetic-lab.

## Nästa steg, i säker ordning
1. ~~Vinnar-utvärderaren~~ **KLAR** (ovan).
2. ~~Variant-lagret + dashboard-toggle~~ **KLAR** (ovan).
3. ~~**`decide.ts`-inkoppling** bakom `serving_enabled` + ramp~~ **KLAR**
   (ägarens "kör" 2026-07-13). Hela armvalet är en ren, testad funktion
   (`serveDecision` i `serve.ts`): master-switch av → null; ingen visitorHash →
   null (ingen stabil arm = ingen mätbarhet); finaste matchande serving/winner-
   variant; variant utan giltiga `serve_ops` → null (fail closed); deterministisk
   ramp-bucket (FNV över besökare·variant, saltad så den är dekorrelerad från
   mät-holdouten). Variant-armen får variantens ops, kontrollarmen ser sidan
   SOM DEN ÄR; båda loggas med `variant:<id>` i patterns
   (adaptation_shown/withheld) så `angel_variant_arms`-RPC:n kan räkna armarna
   och `evaluateWinner` ge rekommendationen i dashboarden.
   - **`serve_ops`**: planens ops (sektions-id + prosa) är inte applicerbara i
     en webbläsare; vid verifieringen löses de till DOM-lokatorer
     (rubriktext + tagg) + exakta textvärden och sparas i
     `angel_variants.serve_ops`. En variant utan giltiga serve_ops kan aldrig
     serveras.
   - **Snippetens variant-applikator** speglar render-harnessets semantik
     (ett stegs lyft per move_up — INTE mönster-move_upens "till toppen"),
     allt-eller-inget (halvt applicerad design rullas tillbaka helt),
     reversibel byte-exakt (innerHTML-ångra för retexter), idempotent vid
     hydrerings-omkörning, CWV-vakterna (LCP/no-touch) gäller.
     Chromium-verifierad: full applicering + exakt reset + allt-eller-inget.
   - **Ramp-kontroll i dashboarden**: 5/10/25/50 % (`setServingRamp`), synlig
     bara när serveringen är på. Servering kräver BÅDE `adaptations_enabled`
     och `serving_enabled` (grind 1).

## Auto-genereringsloopen (ägarens "kör, och noggrant" 2026-07-13)

Skalningsvägen mot "100 designs" — en design per segment, framvuxen i takt med
att data bär den, aldrig allt på en gång:

- **Detektorn** (`redesign/earned.ts`, ren + testad): vilka segmentnycklar har
  FÖRTJÄNAT en egen design? Kandidat = varje grov→fin-prefix av rollup-löven
  (aldrig genom 'okänd'); nyckeln får inte ha en egen icke-pensionerad variant;
  TOTALEN under nyckeln måste bära analysen (volymgrinden 1000/100); och det
  INKREMENTELLA måste vara > 0 — löv som idag inte täcks av någon variant alls.
  Loopen TÄCKER otäckta besökare; den förfinar inte redan serverade segment
  (·ny-splittar av befintliga varianter är vinnar-iterationens jobb, annars blir
  100 förslag utan 100 insikter). Girigt urval med omräkning: en täckning, ett
  förslag — finaste adekvata nyckeln vinner, så variantens serveringsomfång
  ligger tätt mot datan som rättfärdigade den. "Låna styrka"-stegen uppstår av
  sig själv: tunna google·mobile·SE (900 besök) täcks av grova `google`.
- **Pipelinen** (`scripts/redesign/auto-generate.ts`): `detect` bygger den
  riktiga designbriefen per förtjänt segment (buildRedesignContext, med ärliga
  räknade observationer — inkrementets löv, konvertering mot sajtsnitt);
  `verify` kör designerns plan genom HELA kedjan: validateOps (vokabulär +
  mål-finns + claims-vakt) → pixelgrindarna i riktig Chromium (overflow,
  kollision, hjälten först, CTA-hit-test, reversibilitet — nu även med
  set_text applicerad före mätningen, så text som ändrar layouten syns) med
  kollisions-retryn → serve_ops-upplösning → FÖRE/EFTER-bevis → `verified`.
- **Ägarens knappar** (dashboarden): `aktivera A/B` (verified → serving),
  `gör till vinnare` (bara när utvärderaren rekommenderar det), `stoppa`
  (serving/winner → retired; kontrollen återtar 100 % direkt). Olagliga
  övergångar avvisas server-side; det partiella unika indexet gör
  dubbel-aktivering till ett städat fel. Loopen skriver som mest `verified` —
  ingenting serveras utan knappen.

Kvar tills vidare (medvetet): baseline-byte är alltid manuellt (grind 4);
förfining av redan täckta segment (t.ex. splitta ett serverat segment på
ny/återkommande) väntar på vinnar-iterationen; riktiga kundsidor kopplas in i
pipelinen via freeze-steget (samma kedja, annan HTML-källa).
