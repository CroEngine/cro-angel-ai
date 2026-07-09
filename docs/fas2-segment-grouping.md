# Fas 2 — segmentgruppering (designnotis, för imorgon)

> Svar på ägarens fråga: "Google_phone_se är inte samma som Google_phone_usa,
> men jag är fine om vi kör en Google_phone (generell) om det ens hjälper."
> Kort svar: **ja — börja generellt (Google_phone), och splitta till _se/_usa
> BARA när datan bevisar att splitten är värd sin kostnad.** Nedan varför + hur.

## Kärnspänningen: finkornighet vs. statistisk styrka

Varje extra dimension i ett segment MULTIPLICERAR antalet hinkar och DIVIDERAR
trafiken mellan dem. Det är gratis att definiera fler segment — men inte gratis
att BEVISA något i dem.

Räkneexempel (typisk SMB-pilot, ~5 000 besök/mån):

| Segmentnyckel | Antal hinkar | Besök/hink/mån |
|---|---|---|
| kanal (5) | 5 | ~1000 |
| kanal × device (5×3) | 15 | ~330 |
| kanal × device × land (5×3×10) | 150 | ~33 |
| + ny/återkommande (×2) | 300 | ~17 |

Riktvärdet för en meningsfull avläsning är ~1000 besök / 100 konverteringar per
segment (croengine-vision.md). Vid ~33 besök/hink är `Google_phone_se` bara
brus — vi skulle "personalisera" på slumpen. `Google_phone` (~330) är
gränsfall-testbart över ett kvartal. Land är den DYRASTE dimensionen (högst
kardinalitet) och ska därför splittas SIST och grindas HÅRDAST.

## Rekommendation: grov-till-fin hierarki med tillräcklighetsgrind

Inte "välj en fast finkornighet". I stället en ORDNAD dimensionshierarki, och
ett segment = ett PREFIX av den:

```
[ kanal , device , land , ny/återkommande ]
   ↑ grovast                    ↑ finast
```

- **Grovast (default):** `google` → `google_phone` (kanal × device). Detta är
  gruppen nästan alla SMB-sajter lever i, för alltid — och det är RÄTT, inte en
  kompromiss.
- **Finare split (`google_phone_se`) aktiveras bara när den finare hinken själv**
  (a) korsar volymtröskeln OCH (b) skiljer sig MATERIELLT från sin förälder
  (effektstorlek / likelihood-ratio, inte bara "ser lite olika ut").
- **"Låna styrka":** en tunn finkornig hink ÄRVER förälderns insikt/variant tills
  den förtjänat sin egen. `google_phone_se` med 20 besök behandlas som
  `google_phone` tills den har nog data — aldrig som en egen slumpmässig gissning.

Motorn väljer alltså det MEST specifika segment som både har nog data och skiljer
sig från sin förälder — annars faller den tillbaka ett steg. Det svarar exakt på
"fine med generell om det hjälper": systemet betalar finkornighetens pris FÖRST
när datan visar att det hjälper.

## Land specifikt (ägarens exempel)

Land bär äkta signal (språk, valuta, frakt, trust-cues) — men är den
högst-kardinella dimensionen och därmed största volymskatten. Beslut:
- Default-gruppen IGNORERAR land: `google_phone`.
- Splitta till `_se` / `_usa` bara för sajter med nog per-land-volym (i praktiken
  bara högre-trafik-piloter, sällan de minsta).
- När ett enskilt land dominerar trafiken (t.ex. 90 % SE) är `google_phone` de
  facto redan `google_phone_se` — ingen split behövs.

## Ägar-override (redan beslutat)

SMB-sajter når sällan tröskeln. Ägaren får trycka "analysera & förbättra ändå —
jag accepterar osäkerheten". Osäkerheten visas ÄRLIGT (Bayesianskt, brett
intervall). Det är ägarens informerade beslut, inte ett systemlöfte.

## Vad som redan finns (ingen ny insamling behövs)

Observe-lagret fångar redan alla dimensionerna: `trafficSource`, `device`,
`country`, `browser`, `language`, `campaign`, ny/återkommande + besöksräkning
(`aggregate.ts` segments; `VisitorContext`). Fas 2 är en ROLLUP över de
befintliga `sessionSummaries`, nycklad på dimensionsprefixet, med per-segment
utfall (konvertering/drop-off) + en tillräcklighetsflagga. Inget snippet-arbete,
ingen migration för själva grupperingen.

## Föreslagen Fas 2-leverans (bygger imorgon, tillsammans)

1. `segmentSummaries(sessions)` i aggregate.ts: rulla upp sessioner till
   segment-prefix (grovast→finast), räkna besök/konv/drop-off + `adequate`-flagga
   per nivå.
2. En "välj mest specifika adekvata segment"-funktion (fallback uppåt i
   hierarkin) — ren, testbar, delad med decide senare.
3. Dashboard: ett segment-kort (grova grupper först; finare expanderbara med
   tydlig "för tunt för att lita på"-märkning).
4. INGEN adaptation ännu — Fas 2 producerar bara insikten (substrat för Fas 3).

### Öppna frågor för imorgon
- Exakt dimensionsordning: är device viktigare än ny/återkommande? (Jag lutar åt
  kanal → device → land → återkommande, men det är en hypotes.)
- Tröskeln: 1000/100 som hård gräns, eller glidande konfidens?
- Ska `campaign` (utm) vara en egen hierari-nivå eller en sido-vy?
