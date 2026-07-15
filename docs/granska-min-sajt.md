# "Granska min sajt" — säljartefakten (2026-07-15)

Motorn som säljmaskin: en URL in, en skickbar svensk engångsrapport ut.
Detta är **limkod på befintlig pipeline** (freeze-page → extraktion →
grindat lyft → före/efter) — ingen ny motor, ingen produktyta.

## Körning

```bash
bun run scripts/audit/granska-site.ts \
  --url=https://exempel.se --namn="Exempel AB" \
  --out=audits/exempel --pris="5 000 kr" --kontakt="hello@croengine.se"
```

Ut: `rapport.html` (självbärande — skärmdumpar inbäddade, bifoga direkt eller
skriv ut till PDF), `fynd.json`, `before.jpg`/`after.jpg`, `frozen.html`
(cachad — omkörningar rör inte nätet).

## Ärlighetskontraktet gäller även säljmaterialet

- Varje fynd är en **mätning** på den frysta kopian (CTA ovanför folden,
  horisontell mobil-scroll, klickbarhet, förtroendesignaler i kopian,
  bevis-sektionens position) — aldrig tyckande.
- Före/efter visas **bara** om flytten fick rent `pass` i pixelgrindarna.
  Höll grindarna tillbaka den säger rapporten det ("så ska det fungera").
  Vägrade motorn (ingen ren sektionsnivå) säger rapporten det också.
- Kända gränser: curl-frysningen tar bara server-renderade sidor (SPA:er
  behöver browser-frysningen); CMP-overlays i frysögonblicket kan skymma
  skärmdumpar; sektions-typklassificeringen är EN-bara tills uppgift #90 —
  skriptet har en tillfällig svensk rubrik-fallback.

## Regler för användning (viktigt)

**Ägaren väljer måltavlorna.** Skriptet körs mot företag som ägaren namngett —
aldrig mot en automatiskt vald lista. Rapporterna är underlag för ägarens
outreach, granskas manuellt före utskick (footern säger det, så gör det).

## Outreach-mall (mejl)

> **Ämne:** Tre saker vi mätte upp på [företag].se
>
> Hej [namn],
>
> jag driver CROENGINE — vi hjälper [bransch]-företag att få fler
> [bokningar/köp] från besökarna de redan har.
>
> Jag lät vårt system gå igenom er hemsida (på en kopia — er sajt har inte
> rörts). Rapporten bifogas: tre uppmätta fynd, och i förekommande fall en
> före/efter-bild där ert eget innehåll flyttats om och verifierats i våra
> kontroller.
>
> Det vi gör annorlunda: vi hittar aldrig på innehåll, allt verifieras i
> pixlar innan en enda besökare ser det, och vi mäter ärligt — hälften av
> besökarna ser originalet, och vi säger "ingen skillnad" när det är sant.
>
> **Pilot: [pris]** — ett verifierat test på er sida under 6 veckor, ni
> godkänner allt, rapport med riktiga siffror på slutet.
>
> 20 minuter nästa vecka?
>
> [namn] · CROENGINE

## Valideringsstatus vid införandet

Körd offline mot cachade frysningar: Nordic Wellness (riktig svensk sajt,
2 fynd, korrekt "n/a" på flytt — inga bevis-sektioner under folden),
wordpress.org/news (3 fynd, flytt **hölls tillbaka** av grindarna och
rapporten säger det — ärlighetsfallet), ghost.org (1 fynd). Bifynd som
fixades på källan: extraktionen avkodade inte numeriska HTML-entiteter
(`&#xE5;` = å) — riktiga svenska sajter blev förvanskade; lagat i extract.ts
med test, gäller hela pipelinen.
