# Fas 3 — generativ CRO (kedjan, status, ärliga luckor)

> Bygger på `croengine-vision.md` (styrdokumentet) och `fas2-segment-grouping.md`
> (segmenten). Detta dokument beskriver Fas 3-kedjan som den FAKTISKT ser ut i
> koden idag, vad som är bevisat på en riktig sida, och vad som ärligt återstår.
> Uppdateras när en skiva är i hamn — inte innan.

## Vad Fas 3 gör (en mening)

För ETT besökarsegment: ta sidans EGNA innehåll (kod + skärmdump + textblock),
lägg till segmentets insikt, och låt designmodellen föreslå en KORT lista
reversibla ops som bara **flyttar / koncentrerar / avslöjar befintligt** — aldrig
uppfinner — verifiera strukturellt OCH i pixlar innan något visas för en besökare.

## Kedjan (moduler, i ordning)

| Steg | Modul | Renhet | Test |
|---|---|---|---|
| 0. Ladda innehåll | `redesign/extract.ts` | ren | 9 enh.test |
| 1. Montera brief | `redesign/context.ts` | ren | 8 enh.test |
| 2. Generera + gate | `redesign/generate.ts` (+ `.server.ts`) | ren + injicerad modell | 9 enh.test |
| 3a. Strukturell FÖRE/EFTER | `redesign/preview.ts` | ren | 6 enh.test |
| 3b. Pixel-FÖRE/EFTER + skönhetsgrindar | `redesign/render-gates.ts` (ren) + `scripts/lab/redesign-render.ts` (webbläsare) | ren gate + lab-drivrutin | 10 enh.test |
| 4. Servera per segment | — | — | **ej byggt** (affärsbeslut) |

### 0. Ladda (`extract.ts`) — "uppfinn aldrig" vid källan
HTML → `RedesignContentModel`: sektioner i dokumentordning (h1/h2 i `<main>`),
CTA:er, trust-signaler, hero. Allt är en **bokstavlig delsträng** av markupen. En
sektion kan inte flyttas/omtextas/avslöjas om den inte redan finns — gränsen mot
"uppfinna" hålls redan här.

### 1. Montera (`context.ts`) — allt modellen behöver
Frusen sida (kod + skärmdump) + innehållsmodellen i placeringsordning + segmentets
insikt (livstid + senaste fönster, trend, datatillräcklighet, rage/form-abandon,
observationer) + mål + hårda guardrails → Markdown-brief. `renderRedesignPrompt`
betonar: omorganisera/omtexta/avslöja BEFINTLIGT, referera via id, uppfinn aldrig.

### 2. Generera + gate (`generate.ts`) — modellen litas ALDRIG på
Modellen föreslår ops; `validateOps` behåller en op bara om **(a)** verbet finns i
tillåten vokabulär (`move_up/set_text/condense/reveal`) OCH **(b)** `targetId` är en
sektion som FINNS. Uppfunna targets/verb avvisas med skäl. Cap `MAX_OPS = 5`.
`completeWithClaude` (`.server.ts`) gör det riktiga vision-anropet mot
`claude-sonnet-5` i prod; utan nyckel degraderar kedjan till tom plan.

### 3a. Strukturell FÖRE/EFTER (`preview.ts`) — "blir ordningen vettig?"
Applicerar planen på sektionsORDNINGEN (utan webbläsare). `move_up` byter plats med
föregående; `reveal/condense/set_text` omordnar inte. Strukturella grindar:
`section_lost`, `hero_demoted`, `footer_not_last`, `noop`.

### 3b. Pixel-FÖRE/EFTER + skönhetsgrindar (`render-gates.ts` + lab)
Renderar den riktiga sidan, applicerar planen på den LEVANDE DOM:en (omordnar de
faktiska sektionsblocken via säkert syskonbyte), och mäter det bara en webbläsare
ser: introducerade `render-gates.ts` återanvänder EXAKT `analyze.ts`-trösklarna —
ett flyttat block får inte hamna ovanför sidans huvudinnehåll, apply får inte
introducera >8px horisontell scroll, ingen konverterings-CTA får bli o-klickbar,
apply får inte introducera >100px **vertikal krock** mellan sektioner (ett upplyft
block som hamnar under hjältens flytande CTA-kort — upptäckt när kedjan kördes
visuellt), och allt måste gå att reversera. FÖRE/EFTER-skärmdumpar + verdikt.

## Bevisat på en riktig sida (plausible.io, segment `instagram·mobile·SE`)

Hela kedjan kördes end-to-end på plausible.io:s riktiga startsida (frusen som
fixtur, renderad **helt offline** och deterministiskt):

```
FÖRE:  hero → features → testimonials → comparison → pricing
EFTER: hero → testimonials → features → comparison → pricing
moved 1/1 · movedAboveMain 0 · hOverflow introducerad 0px · CTA 2/0 · reversibel
VERDICT: PASS
```

Planen lyfter sidans EGNA sociala bevis ("People ❤️ Plausible") ovanför den
generiska feature-sektionen för det varma-men-försiktiga mobilsegmentet — ett
reversibelt ett-stegs-byte, ingen fabrikation. En **negativ kontroll** (en sektion
tvingad ovanför heron) mäts korrekt som `movedAboveMain=1` → FAIL, så grinden
skiljer säkert från trasigt — den passerar inte bara tomt.

Reproducera:
- `bun run scripts/lab/redesign-real-site.ts` — strukturella kedjan + brief.
- `bun run scripts/lab/redesign-render.ts` — pixel-halvan + FÖRE/EFTER + verdikt.

## Generaliserar den? (stresstest på fler riktiga sajter)

Loadern + hela strukturella kedjan (loader → generate → båda grindarna →
strukturell preview) kördes mot fyra olika riktiga SSR-startsidor:

| Sajt | Utfall |
|---|---|
| **plausible.io** | ren extraktion + pixel-PASS (primärfallet) |
| **usefathom.com** | ren extraktion (hero, jämförelse/features/logos, "1,000,000+ websites", "Trusted by IBM, GitHub", "GDPR compliant"); logos-lyft passerar grindarna; fabricerad "#1 fastest, 5,000,000 sites" avvisas av semantikgrinden |
| **savvycal.com** | fungerar UTAN `<main>` (fallback till hela dokumentet); översegmenterar (varje feature-h2 blir en sektion) — känd begränsning |
| **basecamp.com** | avslöjade en **bug**: hero + primär-CTA låg i en `<header>` OVANFÖR `<main>` och tappades → **fixat** (hero hämtas nu från dokumentets h1 var den än sitter; CTA:er skannas i hela dokumentet; sektioner stannar `<main>`-skopade) |

## Ärliga luckor (så roadmapen inte lullar)

- **Servering per segment (steg 4) är inte byggt.** Att dirigera riktig trafik till
  en verifierad variant är ett affärsbeslut + återanvändning av hold-out-maskineriet
  — medvetet inte gjort osupervised.
- **Loadern är trogen för server-renderad markup.** En JS-skal-SPA vars innehåll
  monteras klient-sida ger tom modell — den måste först frysas (`freeze.server.ts`)
  och matas hit som post-render-HTML. (hibob/posthog var tomma skal vid hämtning;
  plausible/usefathom/basecamp/savvycal är SSR och funkade.)
- **Loadern översegmenterar feature-tunga sidor.** En sida med 16 feature-h2:er
  (savvycal) blir 16 sektioner. Ofarligt (grindarna fångar dålig omordning) men
  briefen blir brusig — en rollup av småsektioner vore snällare mot designmodellen.
- ~~**`set_text`-grinden är strukturell, inte semantisk.**~~ **KLART** (`claims.ts`):
  en deterministisk claims-diff grundar en `set_text`/`condense`-op:s nya copy mot
  sidans publicerade text och avvisar den om den inför en SIFFRA, SUPERLATIV eller
  ETT LÖFTE som inte redan finns på sidan. Verifierat på plausible: "19,000 paying
  customers" (äkta) passerar, "50,000", "#1" och "money-back guarantee" avvisas.
  Kvar: heuristiken fångar de tre högvärdeskategorierna, inte godtycklig
  parafras-drift (medvetet — parafrasbedömning är otillförlitlig).
- **Live-applicering av omordning** är samma nivå-3-risk vi gatade: syskonbyte är
  säkert när sektionerna är rena `<main>`-barn (som plausible); godtyckliga
  container-strukturer behöver mer arbete innan de rör en LIVE sida.
- **Modellsteget** kördes in-session i labbet (ingen API-nyckel); i prod gör
  `completeWithClaude` det riktiga anropet. Validering + preview + render-grind är
  däremot exakt prod-koden.
