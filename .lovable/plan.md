## Mål

Härda freeze-substratet innan något lager byggs ovanpå. Tre grindar, men nu med epistemiken låst — inga vacuous-green-fällor, inga cirkulära definitioner, sekvens som inte förgiftar sig själv.

## Sekvensering (ändrad — Grind 0 tillkommer)

```text
Grind 0  (½ dag)  Thin breadth-enumeration. Mäter baseline, kartlägger drift-källor.
                  Outputs: drift-källkatalog + faktisk baseline-success-rate.
                  Inga pass/fail-kriterier. Ren upptäckt.

Grind 1  (1 dag)  Determinism-bevis på hubspot. Whitelist låst a priori,
                  informerad av Grind 0:s drift-källkatalog.

Grind 2  (2-3 d)  Skala-mätning över 50 sajter med positiv content-assertion
                  som success-kriterium. Mätning, inte pass/fail-grind.

Grind 3  (1 dag)  TTL-auktoritativ staleness, HEAD rådgivande.
```

Grind 0 → 1 ordning är icke-förhandlingsbar: utan den blir Grind 1:s whitelist hubspot-formad och Grind 2 punkterar den med tio nya legitima drift-källor.

## Grind 0 — Thin breadth-enumeration (NY)

**Vad:** Kör `freezeSite` mot 50-listan en gång, concurrent=4. Skriv INTE pass/fail. Analysera bara: vilka kategorier av icke-determinism syns i den frusna DOM:en?

**Outputs:**
- `fixtures/drift-survey/SUMMARY.md` — kuraterad lista av drift-källor med kategori (t.ex. "A/B-framework: Optimizely, VWO, Google Optimize residue", "ad-injection: GAM, Prebid", "personalization: Dynamic Yield, Algolia Recs", "session-IDs i query-params", "CSRF-tokens i form-fält", "timestamps i analytics-payloads").
- En faktisk baseline-success-rate (mot vilken success-definition som helst — vi väljer i Grind 2).

**Definition of done:** Survey-dokumentet finns och har täckt minst SaaS + e-commerce + media-kategorierna (där drift-källorna är diversast). Inga numeriska gates. "85%" släpps som påstående — vi vet inte förrän vi mätt.

## Grind 1 — Determinism-bevis (hubspot, härdad epistemik)

### Whitelist författas a priori, inte från kalibrering

Whitelist:en är hela grindens innehåll. Författas som tabell **innan första körning**, med kategori + orsak per fält:

| Fält | Orsak till legitim drift |
|---|---|
| MHTML `Date:` header | Capture-tid, satt av Chromium |
| MHTML `boundary=` Content-ID | Slumpat per snapshot, designspec |
| Inline-resurs `Content-Location` med `?v=<hash>` eller `?t=<ts>` | Cache-busting på CDN-sidan |
| `<meta name="csrf-token">` | Per-session, designspec |
| `data-*-nonce` attribut | CSP-nonces, per-request |
| Query-params i `<img>`/`<script>` matchande `/[?&](t|ts|cb|v|_)=\d+/` | Cache-busters |
| Drift-källor från Grind 0:s survey | Per identifierat A/B/ad/personalization-framework, dokumenterad orsak |

**Allt annat som driftar = failar.** Inklusive saker som "råkade dyka upp i kalibreringen men har ingen a-priori-motivering". Whitelist:en commitas före första determinism-körningen — review:as som kodändring.

### Körning

- N=3 (inte 2) consecutive freezes av hubspot, separata Browserbase-sessioner (= separat A/B-bucket-tilldelning).
- Jämför parvis (3 par): MHTML modulo whitelist, families-outcome-klassificering (se nedan), face-diagnostics familjelista.
- **families.json-kravet:** "samma family-outcome-classification per probe", INTE byte-identisk receipt. Receipt är genererad post-capture; byte-identitet kräver identisk MHTML, vilket är cirkulärt med MHTML-grinden. Outcome-klassificering = `{family, fallbackUsed, weight, style}` matchar per probe-ID.

### Definition of done

- Whitelist commitad som `fixtures/determinism/WHITELIST.md` före körning.
- 3 hubspot-freezes ger 0 unexpected-drift mot låst whitelist.
- Limitation dokumenterad i README: "Determinism bevisad på 1 representativt hårt fall (hubspot, consent-flow). Bredd-determinism är icke-bevisad."

## Grind 2 — Skala-mätning (positiv content-assertion)

### Success är inte "kastade inte"

Ny `freeze.server.ts`-funktion `assertCaptureValid(mhtml)` — körs före `ok: true`:

```ts
// Heuristiker (justeras efter Grind 0):
// - DOM text-content >= 500 tecken efter consent/challenge-markörer strippats
// - >= N (10?) interaktiva element (a[href], button) som inte är consent/footer-only
// - Hero-region: första viewport-höjden innehåller minst ett <h1>/<h2>/<h3>
//   med icke-tom text som inte matchar consent/challenge-vokabulär
// - Inga dominanta Cloudflare/PerimeterX/hCaptcha-markörer i body
```

Failar `assertCaptureValid` → `failureClass: "captured-wrong-page"` (ny). Detta fångar consent-missed, anti-bot-frusen-som-200, tomt SPA-skal — exakt det catch/finally inte kan.

### Failure-taxonomi (oförändrad struktur, ny klass tillagd)

```ts
failureClass: null
  | "timeout" | "consent-missed" | "anti-bot-blocked"
  | "captured-wrong-page"  // ← ny, fångas av assertCaptureValid
  | "dynamic-only" | "auth-gate" | "geo-gate"
  | "mhtml-too-large" | "font-embed-failed" | "unknown"
```

`"unknown"` förbjudet i grön rapport (oförändrat).

### Inga numeriska gates — detta är en mätning

Borttaget: "≥92% success".

Istället: Grind 2 är en **mätning** vars utfall avgör nästa steg. Rapporten `fixtures/breadth-50/SUMMARY.json` ger:
- `addressableSuccessRate` = `ok / (total - deferred-categories)` där `deferred = ["anti-bot"]` (beslutspunkt 3).
- `byFailureClass` distribution.
- Per kategori: success-rate.

**Beslutsregel (mätningens output, inte planens):**
- `addressableSuccessRate >= 95%` → freezern är redo, gå till nästa lager.
- `80-95%` → härda specifika failure-klasser, kör Grind 2 igen.
- `<80%` → freezerns arkitektur räcker inte för bredd, omdesign (beslutspunkt 2 från förra planen).

Detta är ärligare — "85% baseline" var en gissning, Grind 0 mäter den faktiska siffran, Grind 2 mäter post-härdning.

### Korpus-konstruktion

`corpus/breadth-targets.json` — 50 sajter:
- SaaS landing (10), e-commerce (10), media (5), SPA (5), i18n-routing (5), cookie-wall EU (5), anti-bot (5), iframe-heavy (5).
- `deferred: true` på anti-bot-kategorin → exkluderas från `addressableSuccessRate`, mäts ändå.

## Grind 3 — Operativ mognad (TTL auktoritativ)

- `meta.json` får `frozenAt`, `expiresAt`, `ttlDays`, `refreezeReason`. `ttlDays` per-snapshot (default 90, datadrivet — inte hardcoded), så per-kategori-TTL senare är data-ändring.
- `scripts/freeze-staleness-check.ts`:
  - **Auktoritativt:** `now > expiresAt` → stale.
  - **Rådgivande:** HEAD-diff (etag/last-modified/content-length ±10%) loggas som `hint: "live-url-may-have-changed"`, INTE som stale. SPA-skal-etag och CDN-per-request-etag är bruskällor — inte beslutsunderlag.
- Capture-drift (chromiumVersion-jämförelse) → warning, inte fail. A+C-beslutet står.
- CI weekly cron öppnar issue med stale-listan. Människa triggar re-freeze.

## Vad denna plan medvetet inte bevisar

- **Bredd-determinism.** De tre grindarna bevisar determinism-på-hubspot + capture-correctness-på-50. En e-handel som freezar valid men icke-deterministiskt (roterande produktrecs) fångas inte. Dokumenteras explicit i README.
- **Determinism-i-allmänhet.** Hubspot bevisar specifikt consent-flow-determinism, vilket är det icke-triviala. Andra non-deterministiska källor (auth-flows, geolocation-personalization) är ej i scope.
- **Cross-category-jämförbarhet.** Det är extractor-versionens jobb (A+C, redan löst).

## Filer

```text
NY:
  fixtures/drift-survey/SUMMARY.md           ← Grind 0
  fixtures/determinism/WHITELIST.md          ← Grind 1 (commitas före körning)
  fixtures/determinism/hubspot/diff.json     ← Grind 1 output
  fixtures/breadth-50/<name>/                ← Grind 2
  fixtures/breadth-50/SUMMARY.json
  corpus/breadth-targets.json
  corpus/STALENESS.json                      ← Grind 3
  scripts/drift-survey.ts                    ← Grind 0
  scripts/freeze-determinism-check.ts        ← Grind 1
  scripts/freeze-breadth.ts                  ← Grind 2
  scripts/freeze-staleness-check.ts          ← Grind 3
  .github/workflows/staleness-weekly.yml

ÄNDRAD:
  src/lib/tests/snapshot/freeze.server.ts    ← assertCaptureValid + failureClass
  src/lib/tests/schema.ts                    ← meta.ttlDays, expiresAt, refreezeReason
  corpus/README.md                           ← determinism-kontrakt + limitations
```

## Storlek

Grind 0: ½ dag. Grind 1: 1 dag. Grind 2: 2-3 dagar. Grind 3: 1 dag. Totalt ~5 arbetsdagar, fyra PR:s (en per grind), Grind 0 mergas före Grind 1 (epistemiskt beroende), Grind 2/3 kan parallelliseras efter Grind 0.

## Rörs inte

`extractorVersion`, `pageAudit.server.ts`, score-emission, replay-harness, Chromium-pinning. A+C står.
