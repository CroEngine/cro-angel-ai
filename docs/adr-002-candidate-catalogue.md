# ADR 002 — Kandidatkatalogen: kod genererar dragen, LLM väljer, grindarna mäter i förväg

**Status:** Accepted · 2026-07-28 · Bygger på ADR-001 (server-decides).
Ägarens mål: "det ska fungera på 99 % av alla hemsidor vi kör det på."

## Kontext

Preview-/nattkedjans gamla form var **fri generering**: designern (LLM) fick
sidans innehållsmodell och föreslog ops fritt; valideringen och pixelgrindarna
sa ja eller nej i efterhand. Flottmätningen (254 sajter, 2026-07-27) visade
konsekvensen: **52 % verifierade totalt** (61 % på day0-105:an). Bortfallet var
inte dåliga idéer utan *oservbara* förslag — lokatorer som inte gick att lösa
upp, flyttar som kolliderade, inserts som sköt LCP-elementet — dvs. förslag
som redan var dödsdömda när de föddes, upptäckt först i slutet av kedjan.

Två felklasser dominerade:

1. **Lotteriet**: LLM:en kunde föreslå drag som grindarna aldrig skulle släppa
   igenom — och varje "nej" kostade en hel verify-körning.
2. **Blindheten**: när huvudförslaget föll fanns ingen rankad reserv; kedjan
   föll till "inget exempel" trots att sidan hade andra fullt servbara drag.

## Beslut

**Vänd på maskinen — schackmotor-mönstret.** Koden genererar de lagliga
dragen, grindarna mäter dem i förväg, LLM:en väljer ur en stängd meny:

1. **Katalogen** (`src/adaptive/redesign/candidates.ts`): deterministisk
   uppräkning av sidans möjliga drag ur innehållsmodellen — bevis-lyft
   (move_up på proof-sektioner), samma-sida-citat som insert_snippet
   (VERBATIM-regeln: texten måste ordagrant finnas i sidans korpus), rankade
   med bevistyps-/signaltypsvikter.
2. **Grind-i-proben** (`scripts/redesign/probe-candidates.ts`): varje kandidat
   körs genom **verifys egen grindmaskin** (`runGatedAttempts` →
   `evaluateRenderGates`) i en enda browser-session — applicera → mät →
   byte-exakt återställning. Inserts probas per placering (default,
   `after_h1`). Principen: **en kandidat som redan är känd som underkänd ska
   aldrig kunna väljas.**
3. **Menyvalet** (`select.ts` + `scripts/loop/selector.ts`): LLM:en får menyn
   med grindmätvärdena bifogade (`[gates: LCP shift 0px · overlap 0px · CTA
   intact]`) och väljer + rankar reserver. Svar valideras hårt: id utanför
   menyn är omöjligt. Utan nyckel/svar/parse tar det **deterministiska
   golvet** över (score → lägst LCP-skift → id) — kedjan levererar alltid.
4. **Verify som bekräftelse**: slutkörningen producerar bevisen
   (skärmdumpar, evidence, serve_ops) och bekräftar i full kontext; reserverna
   (`altOps`) och bevis-lyftets placeringsstege är fallbacken när huvudvalet
   ändå faller.

### Superset-regeln (mätfynd, inte teori)

Första gate-in-probe-versionen släppte BARA grind-rena kandidater till menyn.
Re-mätning på day0-105:an: **55 % mot v1:s 61 %** — hårdare prob tömde menyn på
svåra sidor och skickade dem till fria designern *utan reserver*. Regeln blev
ett superset: `gateClean` (förstahandsmenyn) ⊃ `applicable` (upplösbar+
applicerbar, reservmenyn). Väljaren föredrar grind-rena; reserverna finns kvar.
Lärdomen: **en hårdare grind utan reservväg sänker totalen** — mät alltid
helheten efter en skärpning.

### Grindmarginaler är säkerhetsmått, inte säljvärde

Frestelsen att ranka kandidater deterministiskt på grindmarginalerna (lägst
LCP-skift vinner, LLM:en stryks) avvisades: marginalerna mäter **oskadlighet**,
inte övertygelsekraft — att optimera på dem väljer systematiskt sidans mest
*inerta* förändring. Golvet använder marginaler som **tiebreak**; själva
rankningen på förväntat säljvärde är LLM-omdöme tills riktiga A/B-utfall finns
att ranka på. Det som så småningom ersätter LLM-omdömet är **mätdata från
riktiga besökare**, aldrig en proxy.

### Spegelkontraktet

Grindmaskinen (`measure.ts`) SPEGLAR klient-appliceraren
(`src/adaptive/runtime/applier.ts` → codegen till `public/adaptive.js`) regel
för regel — no-touch-zoner, hjälteklamp, per-steg-självkoll, insert-CWV-vakt
(`insertRefusedByLcpGuard`). Varje regel bär en "SPEGELVÄND — håll i synk"-
kommentar i båda ändar. `gen:applier:check` pinnar codegen i CI; en
måtts-mot-klient-ekvivalensmatris i CI är känd kvarvarande skuld.

## Egen-origin-servering av rapporter (samma beslut, andra änden)

Supabase Storage **neutraliserar HTML på den publika ytan** — serverad
`text/plain` + `nosniff` oavsett lagrad mimetype (nätfiskeskydd på
supabase.co; bevisat i diag-matrisen 2026-07-27, workflow `storage-diag`:
PNG/JSON serveras rätt, HTML skrivs om). Därför serveras rapporten och
före/efter-sidorna via **vår egen origin**: `/api/preview/report` och
`/api/preview/page` (CSP-inramade), medan bytesen bor kvar i bucketen under
ogissbara uuid-nycklar. `/try`-sidans Original ⇄ Variant-växlare läser
sidorna därifrån; växlaren visas bara när grindarna släppt igenom förslaget
(HEAD-probe, hållna jobb får 404).

## Konsekvenser

- Designen väljer ur drag som **bevisat** går att applicera — "oservbart
  förslag" som felklass flyttas från kedjans slut till dess början, där den
  är gratis.
- Fri generering finns kvar som fallback (tom meny/probe-krasch) och som
  nattloppens generativa våning för kohortceller — katalogen är preview-
  kedjans förstahandsväg, inte ett tak för designern.
- Readern (`findings.diagnostics` per preview-jobb + `verify-report.json`)
  gör varje "nej" diagnosticerbart i efterhand — fördelningen, inte anekdoten,
  styr nästa förbättring.
- Ärlig måttstock: verifierad-variant-andelen är ett **golv som mäts**, inte
  ett löfte. Vägen mot ägarens 99 % är värdeleverans (rapport + diagnos även
  utan variant) plus stegvis högre verifierat tak — aldrig sänkta grindar.
