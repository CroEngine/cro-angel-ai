# Steg 2 — beteendedata: vad är värt att samla in? (evidensgraderad analys)

> Frågan detta dokument svarar på: för Angel (adaptiv CRO), är det värt att gå
> djupare på beteendedatainsamling i steg 2 — och i så fall vilka signaler,
> rangordnade? Grundat i `public/adaptive.js`, `src/adaptive/context.ts`,
> `src/adaptive/decide.ts`, `src/lib/dashboard/aggregate.ts` och
> `docs/v1-testdefinition.md`. Datum: 2026-07-08.

## English TL;DR (5 lines)

1. **Mostly no.** Scroll is already collected at exactly the resolution the product can act on (the `≥75%` bucket already feeds the engine's micro-nudge); finer scroll/click/form signals unlock no level-1–2 treatment and need volume an SMB site never has.
2. The only insertions that clearly earn their keep are **per-visitor guardrails that need zero statistical power**: `prefers-reduced-motion` and `prefers-color-scheme`, read and applied **client-side in the snippet** (nothing new sent, nothing stored).
3. **Keep the in-flight real-visitor CWV (`page_perf`)** as a never-degrade risk metric per arm — but trim it to the 3 CWV and **strip device-fingerprinting fields**.
4. **One predictor to revisit later, not now:** a single active-engagement-time number (a sharper proxy than scroll) — DEFER until v1's CTA-click proof lands.
5. **Skip outright:** all form telemetry, hover-intent, click heatmaps/coordinates, rage/dead-click, `deviceMemory`, `hardwareConcurrency`, `connection.*` (utom ev. saveData), timezone — antingen off-product, dark-pattern-nära, o-aktionerbart vid SMB-skala, eller ren fingerprint-entropi.

---

## 1. Ramverket: en signal måste passera tre grindar

En djupare signal är bara värd sin plats om den passerar **alla tre**:

**A. Har den en verkningsväg?** I den här produkten finns exakt två sätt en
signal kan skapa värde:

- **Guardrail (per besökare, kräver ingen statistisk styrka).** Signalen låter
  oss ta ett *deterministiskt* beslut för den enskilda besökaren — nästan alltid
  "rör inte / dämpa ingreppet så vi aldrig försämrar sidan". Detta är guldkategorin
  vid SMB-trafik: den fungerar redan vid n=1, ingen hold-out, ingen signifikans.
- **Prediktor (matar motorns micro-nudge).** `decide.ts` kör på regler över
  `VisitorContext`; `performance.server.ts` justerar mönsterprioriteter via en
  **composite-score** som i dag väger `deepScroll (0.25) + multiPage (0.35) +
  returned (0.4)` bland icke-konverterare (`microScore`). En ny prediktor har
  bara värde om den ackumuleras snabbare än konvertering **och** skärper den här
  riktningsavläsningen mätbart.
- Allt annat är **deskriptivt** — trevligt i en rapport, men det ändrar inget
  beslut. Deskriptivt = skip (per fas-0-regeln: "kod som inte tjänar beviset
  byggs inte").

**B. Är den aktionerbar vid SMB-trafik?** Mätgrinden är hård och redan kodad:
`MIN_ARM_EXPOSURES = 30` besökare per arm och `MIN_ARM_OUTCOMES = 5` utfall
innan någon lift får kallas signifikant (`aggregate.ts`). Segmentrader i
`attribute()` skapas bara där en arm når 30 exponeringar. **Slutsats:** varje
signal vars enda värdeväg är "mät lift på ett *finkornigt segment*" är
o-aktionerbar per konstruktion på en lågtrafiksajt — du når aldrig 30/arm på
"3G-anslutning" eller "8 GB RAM". Guardrails undviker den här grinden helt;
prediktorer som matar den *aggregerade* composite-scoren (inte ett nytt segment)
klarar sig.

**C. Vad kostar den i privacy och payload?** Styrdokumentet är explicit:
GDPR/consent-first, "krypa inte in på integritetsytan", håll det enkelt. Många
kandidater (deviceMemory, hardwareConcurrency, connection, timezone) är
**fingerprint-entropi** — de tillför nästan ingen verkningskraft men höjer
den identifierande ytan. Det är en självständig skip-grund.

En hjälpsam observation som återkommer nedan: de starkaste kandidaterna
(`prefers-reduced-motion`, `prefers-color-scheme`) behöver **aldrig skickas till
servern**. De läses och tillämpas i snippetens egna OPS. Det är den renaste
möjliga formen — noll ny telemetri, noll lagring, noll ny attackyta.

---

## 2. SCROLL

Utgångsläge: `wireEngagement` skickar redan `scroll_depth` i hinkarna 25/50/75/100,
och `attribute()` konsumerar `≥75%` som `deepScroll` i composite-scoren.
**Scroll gör alltså redan exakt det jobb scroll kan göra i den här produkten.**

| Signal | (1) Mäter | (2) Väg | (3) SMB-aktionerbar? | (4) Privacy | (5) Payload | Verdikt |
|---|---|---|---|---|---|---|
| **Scroll-hastighet** | px/s under scroll | Deskriptiv. Kartlägger inte mot något nivå-1–2-ingrepp. | Nej — kräver volym för att bli mönster. | Låg | Scroll-listener + tidsderivata | **SKIP** — deskriptiv, ingen spak. |
| **Tid till första scroll** | ms från load → första scroll | Svag prediktor (engagemang), men dominerad av aktiv-engagemangstid nedan. | Marginellt (aggregerat) | Låg | Liten | **SKIP** — sämre proxy än den vi ändå överväger. |
| **Dwell per sektion** | tid synlig per sektion | Deskriptiv/heatmap-nära. Ingen spak; kräver sektionsinstrumentering vi inte har. | Nej | Medel (IO per sektion) | Hög | **SKIP**. |
| **Scroll-back / tvekan** | uppåtscroll efter nedåt | Deskriptiv UX-forskning. | Nej — volymberoende | Låg | Medel | **SKIP**. |
| **Exit-scrollposition** | djupaste hink vid exit | Redan fångat (`maxScroll` i `VisitorSummary`) via 25/50/75/100. | Redan täckt | — | — | **SKIP (redan täckt)**. |
| **Rage-scroll** | snabb fram/tillbaka-scroll | Frustrationsdiagnostik. Ingen nivå-1–2-respons; session-replay-nära. | Nej | Medel | Medel | **SKIP**. |

**Scroll-slutsats:** gå **inte** djupare. Nuvarande upplösning är den enda
motorn kan agera på. Den ärliga rubriken är "scroll är klart".

---

## 3. DEVICE

Utgångsläge: `context.ts` klassar redan device/browser/os via User-Agent +
`screenWidth`. Runtime har redan en `IntersectionObserver` som vet om målet är i
vyn (stickyn behöver alltså inte att servern känner viewporthöjd).

| Signal | (1) Mäter | (2) Väg | (3) SMB-aktionerbar? | (4) Privacy | (5) Payload | Verdikt |
|---|---|---|---|---|---|---|
| **`prefers-reduced-motion`** | användarens rörelsepreferens | **Guardrail** → släck `.angel-emphasized`-transitionen (och all puls) så emfas aldrig animerar för den som bett om lugn. | **Ja, vid n=1** — deterministiskt per besökare. | Mycket låg (2 lägen, accessibility-signal, ej entropiflaggad) | Noll — en media query, tillämpas i snippeten, skickas aldrig | **COLLECT NOW**. |
| **`prefers-color-scheme`** | ljust/mörkt tema | **Guardrail** → temaanpassa injicerad krom (den lila `.angel-badge`, den mörka `.angel-sticky-cta`) så Angel aldrig renderar trasig krom på en mörk sajt. Skönhet-först. | **Ja, vid n=1** | Mycket låg (2 lägen) | Noll — media query i snippeten | **COLLECT NOW**. |
| **`navigator.connection` (effectiveType/downlink/rtt)** | nätverkskvalitet | Guardrail-*ambition* ("dämpa krom på segt nät") men marginell; entropi. | Nej som mätsegment | Medel-hög (fingerprint-entropi), + saknar stöd i Safari/Firefox | Liten | **SKIP** (utom saveData nedan). |
| **`connection.saveData`** | användarens datasparläge | Svag guardrail → ev. hoppa över icke-nödvändig injicerad krom / skördaren. Äkta *preferens* (som reduced-motion), inte ren entropi. | Ja vid n=1, men marginell nytta | Låg (boolean, preferens) | Liten | **DEFER** — endast om ett konkret behov uppstår. |
| **`deviceMemory`** | RAM-bucket | Ingen throttling-behandling finns; ren entropi. | Nej | Hög (klassisk fingerprint-vektor) | Liten | **SKIP** — integritetskryp, o-aktionerbart. |
| **`hardwareConcurrency`** | CPU-kärnor | Som ovan. | Nej | Hög | Liten | **SKIP**. |
| **Viewport-mått (höjd)** | innerHeight | Redundant: runtime-IO vet redan om målet syns. Bredd skickas redan. | Redan täckt av IO | Låg | Noll | **SKIP (redundant)**. |
| **`prefers-reduced-transparency` / touch (pointer: coarse)** | touch-förmåga | Redundant med device-klassningen (mobile/tablet/desktop). | Redan täckt | Låg-medel | Liten | **SKIP (redundant)**. |
| **Timezone** | IANA-tidszon | Redundant med `hourOfDay` (lokal timme finns) + `country` (edge-geo); annars entropi. | Redan täckt | Medel (entropi) | Noll | **SKIP (redundant + entropi)**. |

**Device-slutsats:** de två media-query-preferenserna är produktens bästa
tillskott — inte för att de förutsäger konvertering, utan för att de **skyddar
löftet "försämra aldrig sidan"** till noll kostnad. Allt övriga device-djup är
antingen redan täckt eller fingerprint-entropi.

---

## 4. CLICKS

Utgångsläge: `cta_click` (goal/assist) fångas redan i konverterings-lyssnaren.

| Signal | (1) Mäter | (2) Väg | (3) SMB-aktionerbar? | (4) Privacy | (5) Payload | Verdikt |
|---|---|---|---|---|---|---|
| **Koordinater / heatmap** | var på sidan man klickar | Deskriptiv. Angel är ingen heatmap/session-replay-produkt. | Nej — kräver stor volym | **Hög** (replay-nära) | Hög (global click-logg) | **SKIP**. |
| **Dead clicks** (klick på icke-klickbart) | felställd förväntan nära målet | Diagnostik för ägaren ("folk tror detta är klickbart") — men ingen *nuvarande* nivå-1–2-spak. | Svagt, aggregerat | Medel | Medel (global capture-lyssnare) | **DEFER** — enda click-signalen med framtida värde, som ägardiagnostik, inte per-besökare-behandling. |
| **Rage clicks** | upprepade klick på samma punkt | Frustrationsdiagnostik; ingen nivå-1–2-respons. | Nej | Medel | Medel | **SKIP**. |
| **Hover-intent / hover-före-klick** | muspekarväg före klick | Skulle låsa upp en **uttryckligen förbjuden** behandling — styrdokumentet listar "hover-beroende effekter" i vad-vi-INTE-bygger. | — | Medel | Medel (mousemove) | **SKIP** — off-product per design. |

**Click-slutsats:** inget nu. Dead-click är det enda som kan bli en framtida
ägardiagnostik; hover är förbjuden yta.

---

## 5. FORMS

**Hela kategorin är off-product per design.** `v1-testdefinition.md` listar
"formulär-/checkout-ingrepp (fel yta för förtroendenivån)" i vad-vi-INTE-bygger,
och `decide.ts` **hårdgrindar konverteringssidor till noll adaptationer**
(`pageType === "conversion"` → `declined: conversion_page`). Det finns alltså
ingen behandling någon form-signal kan låsa upp — och formbeteende är
PII-nära (inmatningstakt, fältval).

| Signal | Väg | Verdikt |
|---|---|---|
| Fält-focus/blur | Ingen spak (checkout-ytan är fredad) | **SKIP** |
| Fält-övergivande | Ingen spak | **SKIP** |
| Tid-i-fält | Ingen spak; PII-nära | **SKIP** |
| Fel-möten (validering) | Ingen spak | **SKIP** |

**Form-slutsats:** samla ingenting. Detta är den starkaste skip-kategorin —
den är filosofiskt utanför produkten *och* den värsta integritetsytan.

---

## 6. TIMING / ENGAGEMENT

| Signal | (1) Mäter | (2) Väg | (3) SMB-aktionerbar? | (4) Privacy | (5) Payload | Verdikt |
|---|---|---|---|---|---|---|
| **Aktiv-engagemangstid** (synlig + interagerande vs idle) | verklig engagerad tid, inte flik-i-bakgrund | **Prediktor** — en skarpare, mindre förväxlingsbar engagemangsproxy än scroll, som matar `microScore`. Ackumuleras för *varje* besökare. | Ja (aggregerad, inte segmenterad) | Låg (en varaktighet, ingen entropi) | Medel (visibility API + interaktionstimer) | **DEFER** — den enda nya prediktorn värd att återkomma till, men *inte före* v1:s CTA-klick-bevis landat. Utöka aldrig proxy-uppsättningen innan primärmåttet talat. |
| **Real-visitor CWV** (`page_perf`, byggs nu) | LCP/INP/CLS i fält, per arm | **Guardrail/risk-metric** — stänger cirkeln på "försämra aldrig sidan": runtime har redan LCP-vakter, fältet bevisar att de höll. | Ja som riskflagga (även få regresserade sessioner är en varning) | Låg *om* trimmad | Låg-medel | **COLLECT NOW (redan i rörelse)** — men trimma till de 3 CWV (+ ev. TTFB), **och strippa device-djup-fälten** (deviceMemory/hardwareConcurrency) — de är fingerprint-entropi, inte risk-metric. |
| **Tid-till-konvertering** | ms exponering → konvertering | Deskriptiv diagnostik; ändrar inget beslut. | Nej | Låg | Noll (härleds ur befintliga events) | **DEFER** — kan härledas i efterhand vid behov, ingen ny insamling. |

---

## 7. Rangordnad shortlist — vad som faktiskt är värt steg 2 (restriktivt)

Kort med flit. Endast det som tydligt förtjänar sin plats:

1. **`prefers-reduced-motion`** → guardrail: släck emfas-transitionen/pulsen.
   *Låser upp:* respekt för rörelsekänslighet utan att emfasen tappar sin
   funktion. Noll volym, noll ny telemetri (tillämpas i snippeten), noll lagring.
2. **`prefers-color-scheme`** → guardrail: temaanpassa den injicerade badgen/stickyn.
   *Låser upp:* skönhet-först på mörka sajter — Angel renderar aldrig trasig
   krom. Noll volym, noll ny telemetri. *(1 och 2 är i praktiken ett enda litet
   arbete: två media queries lästa och tillämpade klientsidan.)*
3. **Real-visitor CWV (`page_perf`) — behåll, men trimma.** *Låser upp:*
   per-arm-bevis att ingreppen inte försämrade LCP/INP/CLS ("försämra aldrig
   sidan" blir mätt, inte bara antaget). Villkor: bara de 3 CWV, strippa
   device-fingerprint-fälten.
4. **Aktiv-engagemangstid — EN siffra — DEFER.** *Låser upp:* en skarpare
   riktningsproxy i `microScore` för lågvolymsajter. Men först efter att v1:s
   CTA-klick-bevis (P > 0,8) landat. Samla då *en* engagerad-sekunder-siffra,
   inte en svit.

Det är hela listan. Notera att #1–#2 inte ens vidgar payload eller
integritetsyta — de är den mest restriktiva formen av "gå djupare" som finns.

---

## 8. Samla uttryckligen INTE (med skäl)

| Signal(er) | Skäl |
|---|---|
| **All form-telemetri** (focus/blur, fält-övergivande, tid-i-fält, fel-möten) | Off-product: v1 utesluter form-/checkout-ingrepp och `decide.ts` hårdgrindar konverteringssidor → ingen behandling att låsa upp. Dessutom värsta PII-ytan. |
| **Hover-intent / hover-före-klick** | Låser upp en **uttryckligen förbjuden** behandling ("hover-beroende effekter" i vad-vi-INTE-bygger). |
| **Klick-heatmap / koordinater** | Angel är ingen heatmap/session-replay-produkt; o-aktionerbart vid SMB-volym, tung payload, replay-nära integritet. |
| **Rage-click / rage-scroll / scroll-back / tvekan / scroll-hastighet / dwell-per-sektion** | Kvalitativa UX-forskningssignaler; kräver volym Angel inte har, kartlägger mot inget nivå-1–2-ingrepp. |
| **`deviceMemory`, `hardwareConcurrency`** | Ren fingerprint-entropi; ingen throttling-behandling finns. Strippa även ur `page_perf`. |
| **`navigator.connection.downlink/rtt/effectiveType`** | Fingerprint-entropi, partiellt browserstöd, marginell behandling. (saveData är den enda försvarbara biten → DEFER.) |
| **Timezone, touch-förmåga, viewporthöjd** | Redundanta: `hourOfDay`+`country`, device-klassningen respektive runtime-`IntersectionObserver` täcker dem redan; timezone är dessutom entropi. |
| **Tid-till-första-scroll, tid-till-konvertering** | Deskriptiva; kan härledas i efterhand, ingen ny insamling motiverad. |

---

## 9. Den ärliga sammanfattningen

Att "gå djupare på beteendedata" är för den här produkten mestadels **fel
rörelse**. Scroll samlas redan på den enda upplösning motorn kan agera på, och
de flesta finkorniga signaler faller på antingen SMB-volymgrinden (30/arm) eller
integritetsprincipen. Den enda insamlingen som *entydigt* förtjänar sin plats i
steg 2 är två media-query-**guardrails** som skyddar löftet "försämra aldrig
sidan" till noll telemetrikostnad, plus att behålla (och trimma) den
CWV-mätning som redan byggs. Allt annat väntar — eller byggs aldrig. Det ligger
i linje med både evidensen (relevans/message-match är spaken, inte mer
telemetri) och ägarens uttryckliga vilja att hålla det enkelt.
