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

## Öppna frågor för ägaren (innan bygge)

- **Aktivering:** per-segment-knapp i dashboarden, eller DB-only först (som
  `adaptations_enabled` idag)?
- **Split:** fast 50/50, eller rampa (10 % → 50 % när tidiga siffror håller)?
- **Vinstkriterium:** vilken lift-tröskel + power innan `winner`/baseline-byte?
- **Baseline-byte:** ska en vinnare AUTOMATISKT bli ny baseline, eller kräva ett
  ägar-OK (given att baseline-byte förändrar vad alla ser)?

## Varför detta inte byggs nu

Att servera = att förändra vad riktiga besökare ser. Alla grindar finns, men
på-slagningen och vinstkriterierna är affärsbeslut (ägaren). Fas 3-kedjan (generera
→ verifiera) producerar redan trygga varianter; steg 4 väntar bara på ägarens
"kör skarpt"-beslut per segment.
