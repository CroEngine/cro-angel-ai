# Audit accuracy — Fas 1 (deterministisk) + Fas 2-skiss (LLM-hybrid)

Fas 1 implementeras nu. Fas 2 dokumenteras som separat, ej beslutad task.

---

## Fas 1 — deterministiska fixar (kör nu)

Skopet är medvetet smalt: bara de två buggar som är verifierade i HiBob-JSON. #2 (NBSP) skippas (premissen finns inte i datan). #4 (modal form) skjuts upp tills demo-CTA-flödet inspekteras manuellt.

### 1A. `navigation.pricingPresent` missar "Prissättning"

**Fil:** `src/lib/tests/scripts/navigation.ts`

Pricing-regexen täcker `pricing|prices|priser|kostnad|plans` men inte svenska "Prissättning". Utöka alternationen till att även matcha `priss[äa]ttning|abonnemang`. Inga andra nav-fält rörs.

### 1B. Trust signals överklassar produkt/AI/avdelningskort som testimonials

**Fil:** `src/lib/tests/scripts/trustSignals.ts` (carousel-slide-passet ~rad 245–266, och `[class*="testimonial" i]`/`blockquote`-selektorn som matar det).

Verifierat: ~10 av 13 emitterade testimonials är AI-feature-kort ("Produktivitetshöjaren", "Dataanalyseraren", "Utvecklingscoachen", "Produktnavigatorn") och persona/avdelningskort ("HR", "Ekonomi", "Lönesystem", "Företagsledare", "Personalansvariga", "IT"). Nuvarande guard accepterar en slide om den har quote-glyf **eller** ett author-ish-element **eller** en `testimonial|quote|review`-class — för tillåtande.

Skärpning:
- Kräv **både** ett author-ish-element **och** en quote-glyf; ELLER en explicit `testimonial|quote|review`-class på själva slidens container.
- Diskvalificera om subträdet innehåller en produkt-/feature-signal: `<button>`/`<a>` med CTA-copy (`läs mer`, `read more`, `boka demo`, `try`, `prova`, `learn more`), `h2|h3|h4` vars text matchar `produkt|feature|funktion|avdelning|department|\bAI\b|assistent|coach|analyserare|navigator|h[öo]jare`, eller en `a[href]` som wrappar hela sliden (kort-länk-wrapper).
- Samma skärpta kontroll på non-slide-passet när elementet är stort (flera rubriker, eller `innerText > ~300` tecken).

Downstream räknas om automatiskt:
- `pageSummary.testimonialCount` faller från 13 → ~3.
- `trustSummary.byType.testimonial` och `aboveFold` reflekterar den renare setten.
- Flag-motorn (när den wiras) får korrekt input — testimonials-in-carousel triggar inte på feature-karuseller.

### Skippas: `reviewCount` / svenska blanksteg

Verifierat mot HiBob-JSON: "1 811 recensioner" / "1 230 200" / ordet "recension" finns **inte**. De spacade tal som finns ("1 600", "1 000") använder ASCII U+0020, redan matchat av `[ ,.]`. Verkliga orsaken till `reviewCount = 0` är att ingen "X recensioner"-sträng existerar i DOM-snapshoten — troligen JS-laddad G2/Capterra-badge utanför snapshoten. NBSP-fix skulle inte ändra output.

### Skjuts upp: modal demo-form / `formCount: 0`

`forms: []` bekräftat, men premissen att det är en dold Marketo-modal är overifierad — `techStack` visar onetrust/tealium/vwo/wordpress, **ingen Marketo**. De 9 "BOKA EN DEMO"-CTA:erna kan lika gärna länka till `/demo`.

Manuell verifiering krävs innan kod: inspektera primära "BOKA EN DEMO" — `href` eller modal? Om navigation → `formCount: 0` korrekt, ingen fix. Om in-page modal med form → revisitera med original-planen (ta bort rect-filter, detektera hidden ancestors, lägg till `hidden` + `section: "modal"`, utöka `SectionKind`).

### Verifiering efter Fas 1

Kör om HiBob-auditen, bekräfta:
- `navigation.pricingPresent === true`.
- `pageSummary.testimonialCount` ≈ 3 (TourRadar, Elation Health, Ualá); AI/avdelningskort finns inte längre som `testimonial` i `trustSignals`.
- Kör mot en engelsk SaaS-landing-page med tidigare legitima testimonials → räkningarna oförändrade (ingen regression på skärpta guarden).

---

## Fas 2 — LLM-hybrid (separat task, ej beslutad)

Dokumenteras här så besluten från den här diskussionen inte tappas. Inget byggs i Fas 2 förrän Fas 1 är verifierad och vi explicit greenlight:ar Fas 2.

### Scope

Två klassificerare, inget annat:
- `classifyNavIntent(labels, lang)` — ersätter regex-grenarna i `navigation.ts` för `pricingPresent`, `loginPresent`, `signupPresent`, `contactPresent`, `blogPresent`, `docsPresent`, `cartPresent`, `languageSwitcherPresent`.
- `classifyTrustCard(cardContext)` — ersätter den skärpta guarden från Fas 1B när strukturella signaler är tysta/tvetydiga.

Hero-intent och andra semantiska klassificeringar är **ute** ur scope (potentiell Fas 3).

### Arkitektur

**Strukturellt först, LLM sist.** Strukturella signaler kör först och kortsluter klassificeraren. LLM kallas bara när strukturen är tyst eller tvetydig.

Säkra short-circuits (klassificerar utan LLM):
- `input[type="password"]` i header/login-region → `login: true`.
- `href*="login|signin|signup|register"` på nav-länk → resp. boolean.
- Pricing-**tabellstruktur** (multipla price-cards med valuta + period i samma section) → `pricing: true`.
- `head.lang` + `hreflang` → språkkontext till klassificeraren.

**Inte** short-circuit (bara hint till LLM):
- Ensam valutasymbol — HiBob visar "405 %+ ROI", "1 600+" i social proof. Valuta finns i många kontexter. Matas som signal, kortsluter inte.

### Cache — separerad per klassificerare

Detta är hela kostnadsargumentet och får inte slås ihop:

- **Nav:** cache-nyckel `{host, lang, sha(sorted-unique-nav-labels)}`. Nav är near-konstant inom en sajt → ~1 call per sajt, inte per sida. För en 1045-URL-crawl: ~1 call istället för 1045.
- **Trust:** cache-nyckel `{host, sha(card-html-normalized)}`. Per-sida, varierar mer, lägre hit-rate men fortfarande nyttig.

**Batcha inte nav + trust i samma call** — det dödar nav-cachen. Olika cache-profiler, olika anrop.

### Determinism och drift-skydd

- `temperature: 0`, tool calling (strukturerad output), inte fri JSON.
- **Golden-set-snapshottest:** fast uppsättning nav-fixtures (sv/en/es/ja) och trust-card-fixtures med förväntad klassificeringsoutput. Failar vid modelldrift. Det är den determinism-risk som biter över tid — per-run-stabilitet löser temp 0 + cache, men inte modellversionsbyten i AI Gateway.
- Parallellkör LLM-klassificering bredvid Fas 1-regex/guard en period; logga divergenser; riv det deterministiska skiktet först när divergens-rate är acceptabel.

### Fallback och latens-budget

- Hård timeout per call (~3s).
- Vid timeout/error → fallback till Fas 1-deterministisk kod. Audit får aldrig blockeras av AI Gateway.
- Förväntad latens per sida efter nav-cache-hit: bara trust-call (~0.3–1s med Haiku-klass).

### Modellval

Default till `google/gemini-3-flash-preview` via Lovable AI Gateway (motsvarande Haiku-klass, billig + snabb, klarar multilingual klassificering).

### Öppna frågor inför Fas 2

1. Var bor cachen? In-memory per crawl-run räcker för nav-cachen att vara värd den, men sajt-bred cross-run kräver en tabell i Lovable Cloud.
2. Golden-set: hur många fixtures, vilka språk? Förslag: sv/en/es/ja/de × {nav, trust}, ~5 fixtures per kombination.
3. Divergens-logging: var skrivs det? Edge logs räcker initialt, eller egen tabell för analys.

Inget av detta beslutas nu — listas så det inte glöms när Fas 2 startas.
