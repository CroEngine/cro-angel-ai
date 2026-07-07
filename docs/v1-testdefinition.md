# v1 — testdefinition (styrdokument)

> Detta dokument definierar VAD produkten ska bevisa härnäst. Kod som inte
> tjänar det här beviset byggs inte (fas 0-beslutet, 2026-07-07). Uppdateras
> när ett bevis är i hamn — inte innan.

## Produkten (en mening)

En relevansmotor som gör rätt nästa steg uppenbart för rätt besökare — enbart
med mekanismer ur den starka evidenszonen (kontrast/salience, guidning,
social proof-placering), med inbyggd kontrollgrupp, skönhetsgrindar och noll
mörka mönster.

**Fem saker — och vägrar allt annat:**
1. Ägaren pekar ut målet (dashboardens Measurement-kort)
2. Motorn väljer per besökare: förstärk målet, visa rätt stödbevis intill det,
   kom-ihåg-läge för återkommande, sticky på mobil
3. Allt är paint-only eller additivt — nivå 3 (layout) kräver opt-in per sajt
   efter pre-flight + ägargodkännande (`angel_sites.layout_patterns_enabled`)
4. Pre-flighten (`scripts/preflight.ts`) visar FÖRE/EFTER innan något går live
5. Hold-outen bevisar skillnaden

## Hypotes

**Intent-baserad relevansförstärkning ökar andelen besökare som klickar på
rätt nästa steg — utan att skada något.**

Behandlingen som testas är URVALET (vilken förstärkning för vilken besökare),
inte dekorationen. Kontrollgruppen bevisar relevansmotorn, inte en skugga.
Evidensbas: salience/kontrast (Von Restorff), message match/relevans som
mediator, defaults/guidning nära befintligt mål — se forskningsgenomgången
(chatt 2026-07-07): man kanaliserar latent intent, man skapar den inte.

## Målgrupp

Små/medelstora sajter med tydliga CTA:er och ett identifierbart konverterings-
mål. Piloter: glutenforum.se + 1–2 sajter till med högre trafik.

## Första testerna (alla redan byggda mönster, nivå 1–2)

| Segment | Behandling (mönster) |
|---|---|
| Förstagångsbesökare | emphasize_goal + relevant badge (payment_security/no_credit_card/rating per målslag) |
| Återkommande | continue_where_left_off |
| Mobil | sticky_goal_cta |
| B2B-källa (LinkedIn/partner) | emphasize_goal + relevant badge. (show_case_study/show_enterprise_testimonial är reveal-mönster och kräver att kunden slot-instrumenterar dolt innehåll — `[data-angel-slot]` + `data-angel-hidden`; på enbart skördade sajter avböjer ärlighetsgrinden dem korrekt. B2B-reveal blir alltså ett instrumenterings-erbjudande till piloten, inte ett default-test.) |

## Mått

**Success metric:** relevant CTA-klickfrekvens (klick på målet eller den
förstärkta vägen / besökare) — adapterad arm vs hold-out. Riktvärde ur
rådgivningen: +10–20 % relativt.

**Nedströmsmått (obligatoriskt per test):** målkonvertering per arm, och
återbesöksandel inom 7 dagar som retention-proxy. Klick utan nedströms-
förbättring är ett falskt grönt.

**Risk metrics:** scroll-djup och tid-på-sida per arm får inte försämras;
`adaptation_shown` utan interaktion följs; pre-flightens grindar (inga täckta
klickytor, ingen introducerad overflow, reversibelt) gäller före allt.

## Ärlighet om statistisk styrka (MDE)

Vid SMB-trafik kan klassiska 50/50-test sällan detektera under ~20–30 %
relativ lift. Därför:
- **Avläsning är Bayesiansk**: rapportera P(adapterad > kontroll) och
  effektintervall — aldrig binära "signifikant/inte".
- På lågtrafiksajter är utfallet ofta "svag positiv signal" — det räcker för
  att gå vidare till fas 2, inte för ett kundlöfte om procenttal.
- Hold-out-nivå: 20 % (glutenforums nuvarande) är rimlig pilotnivå.

## Beslutsregler

- **Signal (P > 0,8 för positiv effekt på success metric, inga risk-flaggor)**
  → fas 2: ägargodkända message match-varianter (H1/CTA-vinklar per
  trafikkälla — störst förväntad effekt i evidensgenomgången).
- **Ingen signal efter rimlig exponeringsvolym** → nästa nivå av behandling
  (guidningschips), inte mer motor.
- **Negativ risk-metric** → mönstret av för sajten, incident-analys (samma
  metod som glutenforum-fallet).

## Vad vi uttryckligen INTE bygger (evidens- eller riskskäl)

Knappfärgs-hue-tester (myt), scarcity/urgency (risk + saknar äkta knapphet),
hover-beroende effekter, dekorativ animation, overt identitets-personalisering
("vi såg att du…"), formulär-/checkout-ingrepp (fel yta för förtroendenivån).
Nivå 3 (layout) finns kvar bakom per-sajt-opt-in — inte borttagen förmåga,
men inte produkten.
