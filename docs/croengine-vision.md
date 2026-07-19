# CROENGINE — vision & faserad plan (styrdokument)

> Detta dokument styr vart produkten är på väg. Det ersätter
> `v1-testdefinition.md` (som nu är en fas-referens). Uppdateras när en fas är
> i hamn — inte innan. Beslut: 2026-07-08.

## Visionen (en mening)

CROENGINE analyserar hur olika besökarsegment interagerar med en sajt,
identifierar förbättringsmöjligheter och genererar nya sid-versioner som testas
automatiskt — och lär sig kontinuerligt vilken design, struktur och vilket
innehåll som fungerar bäst för varje segment, **utan att kompromissa med
varumärkets visuella identitet**.

## Grundprincipen: osynlig relevans

Besökaren ska **inte märka** att sidan ändrats — den ska bara kännas lite mer
relevant. Manuell highlighting (en ram runt "Skapa konto", automatiska
hover-effekter, pulserande knappar) skapar visuellt brus och urholkar
förtroendet. De stora vinsterna finns i **rätt budskap, rätt struktur och rätt
innehåll för rätt besökare** — inte i visuella trick.

Detta är en medveten pivot från "adaptiv highlighting". Nästan allt som byggts
är fundamentet — observera-lagret (journey), hold-out/bevis, preflight +
skönhetsgrindar, sandbox, säker apply. Inget rivs. Apply-lagret gatas AV som
standard (observe-first) och blir substrat för den generativa fasen.

## Flödet (ägarens 7 steg → produktens faser)

1. **Samla data — ingen påverkan.** Snippeten gör inget visuellt. Den samlar
   den anonyma resan och bygger en UI-modell av sidan. → *Fas 1 (klart + denna).*
2. **Intent / segment.** Besökaren klassas till ett riktigt segment
   (`phone_linkedin_sweden`), inte bara "mobil". → *Fas 2.*
3. **Vänta på data.** Ingen ändring innan segmentet har nog data (riktvärde
   1000 besök / 100 konverteringar) — MEN ägaren kan trycka "analysera & förbättra
   ändå, jag accepterar osäkerheten". → *Fas 2.*
4. **AI analyserar** segmentets beteende + UI-modellen och föreslår förbättringar
   ("17 % mer sannolikt att hitta priset om Pricing flyttas ovanför Testimonials"),
   inte "gör knappen grön". → *Fas 3.*
5. **AI skapar en ny version** av sidan — bättre informationsarkitektur/budskap,
   ingen extra färg/blinkning/hover. → *Fas 3 (copy) → Fas 4 (struktur).*
6. **A/B-test 50/50** (eller ägar-styrt). → *Fas 3, återanvänder hold-outen.*
7. **Lär.** Vinnaren blir ny baseline, iterera (v1 → v2 → v3, som evolution).
   → *Fas 4.*

## Vad snippeten SAMLAR (allt consent-gatat)

Acquisition (referrer, utm, källa), session (anonymt id, device, land, språk,
tid, scroll — scrolldjup per sidväg sedan 2026-07-19), beteende (sidordning,
**klickordning**, CTA-klick, formulär-lifecycle, exit, **rage clicks** — se
nedan, **videotittartid** — summerad "tittade N s" per video och sidväg sedan
2026-07-19, aldrig innehåll eller position — samt **skickade sajtsökningar** —
se undantaget nedan), prestanda (CWV),
och sidans struktur (CTA/formulär/nav/pris/trust). Detaljerad datamodell +
integritetsgränser: `docs/journey-intelligence.md`.

**Sajtsök-undantaget (ägarbeslut 2026-07-19).** Skickade söktermer från
DEDIKERADE sökfält samlas — vad besökarna letar efter men inte hittar är en av
de starkaste CRO-signalerna. Vakterna: bara fält som kvalar som sökfält, bara
vid submit/Enter/blur (aldrig tangent för tangent), mejl-/nummerliknande termer
skickas aldrig, klient-cap per sidladdning, cleanText-skrubb på servern.
Undantaget är öppet dokumenterat på den publika integritetssidan.

## Vad snippeten ALDRIG SAMLAR

Namn · e-post · telefon · fritext från formulärfält (utom sajtsök-undantaget
ovan) · **musrörelser** · tangenttryck · full IP · full raw user-agent ·
**session recordings** · känsliga URL-parametrar. Musrörelser och recordings är
medvetet uteslutna: o-aktionerbara vid SMB-volym och den värsta integritetsytan
(se `docs/step2-behavioral-analysis.md`).

**Rage clicks JA — men bara som diagnostik.** En äkta frustrationssignal
("ser klickbart ut, händer inget") = ≥N snabba klick på samma element inom ett
kort fönster. Billig och integritetssäker (bara en räknare + elementets referens
vi redan fångar, PII-skrubbad). Driver ALDRIG en automatisk ändring — den pekar
ut ett problem för ägaren/AI:n att titta på.

## Vad AI:n FÅR ändra (senare faser)

Ordning på sektioner · hero-text · CTA-text · bilder · ikoner · social proof ·
testimonials · FAQ · trust badges · antal kolumner · kort vs lång copy · rubriker ·
CTA-placering · formulärlängd · default-val · navigering · prioritering av innehåll.

## Vad AI:n ALDRIG gör

Blinkande element · pulserande knappar · automatiska hover-effekter ·
färgexplosioner · stora overlays · popups utan tydlig anledning · element som
hoppar. Kortsiktiga trick som urholkar varumärkesförtroendet.

**Målknappen är orörbar (ägarregel 2026-07-20).** Angel flyttar aldrig sajtens
egen målknapp ("Skapa konto" o.dyl.), stylar aldrig om den och duplicerar den
aldrig som flytande genväg. Bakgrund: gamla adaptationsmotorn injicerade en
sticky "Skapa konto"-pill på pilotsajten (skärmdumpsfynd). Mönstren
`emphasize_goal` och `sticky_goal_cta` (och opsen `emphasize`/`inject_sticky`)
är borttagna ur repertoaren, och decide-grinden `goal_element_untouchable`
vägrar varje kvarvarande muterande op (text/flytt/kollaps/reveal) som resolvar
till det deklarerade målet. Varianter får ändra budskap och struktur RUNT
knappen — aldrig knappen själv.

## Två risk-hanteringsmekanismer (ägarbeslut 2026-07-08)

- **Volym-override:** SMB-sajter når sällan 1000 besök/segment. Ägaren får trycka
  "kör ändå" — osäkerheten visas ärligt (Bayesianskt, brett intervall), och det
  är ägarens informerade beslut att det kan bli fel pga tunn data.
- **Trogen spegel + en ändring i taget:** varje strukturell variant rekonstrueras
  pixeltroget (sandbox/preflight-spegeln vi har), verifieras i skönhetsgrindarna,
  och visas FÖRE/EFTER innan något går live. Aldrig "generera om från scratch" på
  den live sidan blint.

## Faser

- **Fas 1 — Observe-first (denna):** Angel osynligt som standard (`adaptations_enabled`
  default false; ringen släckt). Journey tier 1-2 + struktur + perf samlas.
  Rage clicks läggs till. Detta ENACTAR pivoten.
- **Fas 2 — Segment insights:** rulla upp sessioner till namngivna segment med
  utfall + datatillräcklighet + ägar-override.
- **Fas 3 — Generativ variant (copy-först):** LLM föreslår budskaps-/copy-variant
  per segment, testas via hold-outen, förhandsvisas i spegeln.
- **Fas 4 — Struktur + lärande-loop:** sektionsordning på troget speglad sida,
  vinnare blir baseline, iterera.

### Kända svåra problem (ärligt, för senare faser)

Volym per finkornigt segment (även med override är 20 besök ingen bevisbar test);
live-applicering av strukturändring (spegeln verifierar, men live-DOM-omordning är
kvar nivå-3-risken); den generativa loopen är ett stort nytt system. Dessa löses
i sina egna faser, inte här.
