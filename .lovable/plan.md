## Fas 1B v2 — strukturell grind, inte additiv OR

Förra planens fel: `hasAuthor` som självständig OR-gren tar tillbaka de 6 avdelningskorten (HR, Ekonomi, Lönesystem, Företagsledare, Personalansvariga, IT), eftersom deras h3/h4 matchar `[class*="title" i]`-selektorn i `extractTestimonialMeta` och fyrar `hasAuthor=true`. Att lappa det med språkspecifik vokabulär i `featureHeadingRx` är fel — det är per-språk-fällan vi enats om att undvika.

Strukturell fix: gör den starka kund-/citat-signalen till **grindvakt**, inte additiv. `hasAuthor` degraderas till förstärkning.

## Ny grindlogik i `src/lib/tests/scripts/trustSignals.ts` (rad ~245–281)

Ordning: **positiv grind → diskvalificerare → emit**.

### Steg 1: Positiv grind (måste passera minst en)
För slides OCH stora non-slide-containers (`isSlide || isLargeContainer`), kräv minst en av:

- `hasExplicitTestimonialClass` — `testimonial|quote|review` i container-klass.
- `hasNamedCustomer` — strukturellt mönster, se nedan.
- `hasQuoteGlyph && text.length >= 60` — citat-glyf + substans.

Passerar ingen → return. `hasAuthor` är **inte** en grind-signal längre.

### Steg 2: Diskvalificerare (efter grind)
Behåll subjekt-baserade diskvalificerare som strukturell säkring — utan att lägga till språkvokabulär:

- `hasCtaButton` (oförändrad regex).
- `headingTextHits` med befintlig `featureHeadingRx` (utöka **inte** med HR/Ekonomi/etc.).
- **Ta bort** `isWrappedLink` — klickbara case-study-kort är legitima.

Träffar någon → return. I praktiken behövs dessa sällan när grinden är strikt, men de fungerar som backstop för kanter där `hasNamedCustomer` ger false positive.

### Steg 3: `hasAuthor` som förstärkning
Använd `hasAuthor` enbart för att berika `extras` (byline, kundnamn) i `push(...)`. Aldrig som gate.

## `hasNamedCustomer` — strukturellt, inte namnlista

**Inte** hårdkoda kundnamn i `RECOGNIZED_BRANDS`. Detekteringen är språkbegränsad (sv/en) — det är okej för en deterministisk baseline, Fas 2 ersätter det.

Mönster (alla strukturella, inga kundnamn):

1. **Story-rubrik:** närmaste `h2|h3|h4` matchar `/^(så här gjorde|hur\s+\S+\s+(växte|byggde|skalade|valde|gick))/i` eller `/^how\s+\S+\s+(grew|built|scaled|chose|went)/i` — ankrar på verbet, inte kundnamnet.
2. **Kundlogga i kortet:** `img[alt]` där alt-text är kort (≤ 40 tecken, ≤ 3 ord) OCH inte matchar generiska ord (`icon|logo|illustration|photo|bild|ikon`). En logotyp har typiskt företagsnamnet som alt.
3. **Byline-mönster:** `cite|figcaption|[class*="author"]` vars text matchar `/,\s*(VD|CEO|CTO|CFO|COO|VP|Head of|Chef|Director|Manager|Founder|Grundare)/i` — titel efter komma signalerar riktig person, inte produktnamn.

Träffar minst ett → `hasNamedCustomer = true`.

## Förväntad effekt på HiBob /sv

- TourRadar/Elation/Ualá: passerar via story-rubrik ("Så här gjorde…") eller kundlogga.
- 4 AI-kort (Höjare/Analyserare/Coach/Navigator): stoppas redan av grinden (ingen explicit klass, ingen named customer, ingen quote-glyph), backstop via `featureHeadingRx`.
- 6 avdelningskort (HR/Ekonomi/Lönesystem/Företagsledare/Personalansvariga/IT): **stoppas av grinden** — ingen av de tre positiva signalerna träffar. Detta är hela poängen med omstruktureringen.
- Mål: `testimonialCount` = 3, både desktop och mobil.

## Verifiering — engelska regressionen viktas tyngst

1. **HiBob /sv:** `testimonialCount ≈ 3`, evidens innehåller TourRadar/Elation/Ualá. Nödvändigt men inte tillräckligt.
2. **Engelsk SaaS-baseline** (samma site som tidigare körning): mätaren. Om guarden är HiBob-formad faller den här. Jämför mot körningen *före* förra strikta guarden — vi vill ha tillbaka recall utan att 13-talet returnerar.
3. Om engelska sajten visar 0 eller >> tidigare baseline: justera story-rubrik-regex eller byline-titellistan (strukturellt, inte per-kund).

## Ej i scope

- Fas 2 (LLM-hybrid) — separat task.
- `reviewCount` (#2), `formCount`/modal (#4) — oförändrade beslut.
- Bredare språktäckning för story-rubriker/byline-titlar — Fas 2-territorium.
