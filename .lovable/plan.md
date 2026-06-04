## Mål
Höj output-kvaliteten på f3 genom att inkrementellt porta de fyra förbättringar som fanns i f2-grenen — utan att återinföra det som tvingade fram reverten. Verifiering körs på samma sida (HiBob) efter varje steg.

## Bakgrund
f3 (nuvarande) och f2 (övergiven) renderar identisk sida. Skillnaderna är ren kod:
- **Trust:** f3 = 15 (varav ~10 falska positiva), f2 = 3 (för strikt — tappar Elation Health & TourRadar). Mål: 3 äkta case.
- **CTA-räkning:** f3 har inkonsistenta fält (3+14≠18); f2 har `iconButtonCount` + `otherCtaCount` + reconcile.
- **Namngivning:** f2 har `primaryConversionCtaCount`; f3 har gamla tvetydiga `primaryCtaCount`.
- **Diagnostik:** f2 har `trustDebug`, `layout`, `viewportDelta`; f3 saknar.

Innan något portas: identifiera vad i f2 som kraschade. De fyra ändringarna nedan är lågrisk — orsaken låg sannolikt i `layout`/`viewportDelta`-features eller runtime-wiring. Step 0 säkerställer att vi inte drar tillbaka samma trasighet.

## Steg

### Steg 0 — Hitta orsaken till f2-reverten (innan något portas)
- Läs chat-historik / git-historik runt reverten för att hitta felmeddelandet eller symptomet.
- Hypotes: `layout`/`viewportDelta` (DOM-mätningar) eller en wiring-ändring, inte trust/CTA-koden.
- Dokumentera orsaken i `.lovable/plan.md` som "undvik X vid portning".
- **Inga kodändringar i detta steg.**

### Steg 1 — Porta `trustDebug` först (diagnostik före logikändring)
- Lägg till `trustDebug`-fält i `techStack` eller `trustSummary` (där f2 hade det).
- Innehåll: för varje element som utvärderades — varför det blev/inte blev testimonial (matched keywords, attribution found, source).
- Uppdatera `PageAuditData` i `src/lib/tests/schema.ts` (optional fält).
- Kör HiBob, ladda upp JSON. **Verifiera:** vi ser nu *varför* de 10 falska positiva klassas som testimonials.

### Steg 2 — Strama åt testimonial-klassificeraren
- Filen: `src/lib/tests/scripts/trustSignals.ts`.
- Ny regel för `testimonial`: kräv **attribution** — minst ett av:
  - företagsnamn i närheten (känd brand eller `<cite>`/`data-company`)
  - personnamn (För- + efternamn-mönster)
  - synlig logga inom samma kort/sektion
  - citattecken runt huvudtexten (`"..."`, `«...»`, `„..."`)
- Avvisa rena produktblurbar ("Bob hjälper till att…", "Ekonomi Planera…", sektionsrubriker utan citat/attribution).
- **Mål:** Uala + Elation Health + TourRadar = 3 träffar. De 10 produkt-blurbarna = 0.
- Använd `trustDebug` från Steg 1 för att verifiera klassificering element-för-element.
- Ta INTE bort `trustDebug` ännu — behåll tills detektionen är stabil över flera sidor.

### Steg 3 — Porta Fix 1 (CTA-räkning + namngivning)
- Byt fältnamn: `primaryCtaCount` → `primaryConversionCtaCount` i `PageSummary` (`schema.ts`) + alla call sites.
- Lägg till `iconButtonCount` och `otherCtaCount` i `PageSummary`.
- Lägg till reconcile-assertion: `primaryConversionCtaCount + secondaryCtaCount + iconButtonCount + otherCtaCount === ctaTotalCount` (warn till console om mismatch).
- Filer: `src/lib/tests/schema.ts`, `src/lib/tests/audit-helpers.ts` (`buildPageSummary`), eventuella konsumenter i `src/components/browser-shell/`.

### Steg 4 (villkorat) — `layout` / `viewportDelta`
- Endast om Steg 0 visar att dessa **inte** var orsaken till reverten, **och** vi faktiskt använder dem nedströms i flag-rules.
- Annars: hoppa över — `flag-rules.ts` är nästa steg och behöver inte detta.

## Verifieringsprotokoll (efter varje steg)
1. Kör page audit mot `https://www.hibob.com/se/`.
2. Ladda upp JSON.
3. Bekräfta:
   - Inga nya runtime-fel.
   - Steg 1: `trustDebug` finns och förklarar 15 nuvarande klassningar.
   - Steg 2: `testimonialCount === 3`, namn på företagen Uala/Elation/TourRadar dyker upp i `personName`/`company`.
   - Steg 3: CTA-fälten summerar korrekt; `primaryConversionCtaCount` finns; gamla namnet borta.

## Efter alla steg
- Ta bort `trustDebug` när detektionen är stabil över ≥2 sidor.
- Tech stack + trust = klar.
- Nästa: `flag-rules.ts`.
