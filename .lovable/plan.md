# Sekvensplan v2: stäng promotion-loopen för hubspot

Reviderad efter strukturell kritik. Tre fel i v1: (1) animation deferrerades trots att den bidrar till RED nu, (2) D:s policy placerades före score-impact-data medan C:s väntade på den — asymmetriskt, (3) A→B var en falsk seriell kedja (samma bytes in ger samma bytes ut oavsett maskkorrekthet). Plus en underskattad risk: B är delvis render-bunden och kräver en spike före byggfasen.

## Ny beroendegraf

```text
   Parallell start (sandbox- eller CI-körbart från dag 1):
   ┌──────────────────────────────────────────────────────┐
   │  [A]  QP-encoding-fix i attribut-masker              │
   │  [D1] Animation-mekanism: inventering + dokumentation│
   │  [B0] Golden-fält-klassning: ren-DOM vs render-härlett│
   └──────────────────────────────────────────────────────┘
                          │
                          ▼
   [B]  MHTML→golden-extractor-pass (scope satt av B0)
                          │
                          ▼
   [C]  Residual capture-drivers (tarpit + animation = D2)
        score-impact-mätning → C1/C2-beslut per driver →
        wire in → N=3 re-run → två gröna olika dagar → lyft pending
```

Kritisk väg: B0 → B → C. A och D1 är sidogrenar som är klara innan B landar.

---

## Block A — QP-encoding-fix i attribut-masker (parallell rot)

Samma som v1. Ersättnings-regexen `&lt;WHITELISTED&gt;` no-op:ar för QP-encodad MHTML (`=3D` istället för `=`), så `confirmed-by-design`-rader för `laboratory-identifier-*`, `csrf-token`, `nonce` är just nu falskt gröna.

**Åtgärd:**
1. Audita alla maskpatterns i `scripts/freeze-determinism-check.ts` och `scripts/mechanism-inventory.ts`.
2. Antingen QP-dekoda raden före diff, eller matcha både `="..."` och `=3D"..."` (=3D22).
3. Enhetstest med syntetisk QP-encodad MHTML-rad mot regression.
4. Re-run N=3, jämför mot `diff.round1-3.json`. Förväntat: reducerad noise, samma RED-verdict.

**Exit:** Test passerar, ny diff visar reducerad noise, `REPORT-A-<ts>.md` skriven.

---

## Block D1 — Animation-mekanism: inventering + dokumentation (parallell rot)

Bara dokumentation. Inget policybeslut här — det flyttas till C tillsammans med tarpit-beslutet, av samma anledning som C väntar på B i v1: vi behöver score-impact-data för att veta om narrowing är `confirmed-by-design`-värdig.

**Åtgärd:**
1. Lägg mekanismraden `animation:mid-frame-transform` i `MECHANISM-INVENTORY.md`: trigger, observerad signatur (`translateY(-Npx)` på hero animated-list), current-status `pending-determinism`.
2. Notera i WHITELIST.md att mekanismen är känd men policy avvaktar B/C.
3. INGEN whitelist-rad utan inkopplad mask. Vi upprepar inte A-felet.

**Exit:** Inventering uppdaterad, ingen no-op-mask införd.

---

## Block B0 — Fält-klassning av golden.json (parallell rot, spike)

Innan B byggs: klassa varje fält i `corpus/hubspot/golden.json` som **ren-DOM** (härledd ur statisk DOM-struktur, fungerar i jsdom byte-troget) eller **render-härlett** (kräver layoutmotor: computed styles, resolved colors, bounding boxes — `bgContrast` är kanonexemplet).

Detta avgör om B är ett block eller två: ren-DOM kan köras deterministiskt i Node/jsdom; render-härlett kräver headless Chromium och därmed CI/Browserbase, inte sandbox.

**Åtgärd:**
1. Läs `src/lib/tests/scripts/collect.ts`, `pageAudit.ts` och kringliggande extraktorer; mappa varje output-fält i `golden.json` mot sin källfunktion.
2. För varje fält: ren-DOM eller render-härlett? Dokumentera i `fixtures/determinism/GOLDEN-FIELD-CLASSIFICATION.md`.
3. Räkna fördelning. Två möjliga utfall:
   - **Mestadels ren-DOM:** B blir ett block, jsdom-baserad extraktor.
   - **Signifikant render-härlett:** B delas i B-DOM (Node) och B-render (Browserbase/headless).
4. Justera B:s scope i denna plan baserat på utfallet — explicit som leverabel ur B0.

**Exit:** Driver-klassificering av `replayCorpus` committad (vad kräver
layout/paint vs ren DOM-parse) **och** B-kontraktet skrivet mot SSOT
(`normalize.ts:72`/`103` + `snapshot.test.ts:91-99`). Den binära
driver-frågan — headless Chromium eller jsdom — är besvarad skriftligt, inte
fält-uppdelningen.

> **Levererat 2026-06-18 (pre-B):** projektionssteget lokaliserat — ingen
> separat `extract-golden`-fil finns; projektionen ÄR `normalizeCollect` +
> `normalizePageAudit` anropade från `snapshot.test.ts`. Driver-klassificering
> i `fixtures/determinism/GOLDEN-FIELD-CLASSIFICATION.md` ger binärt svar:
> hela `replayCorpus` är Chromium-bunden → **B är en headless-driver**, inget
> jsdom-mellanläge matchar committad golden. Risk-flagga för C noterad: om
> freeze-pipelinen delar Chromium-driver med B krävs en oberoende
> DOM-only-referens.

---

## Block B — MHTML→golden-extractor-pass (kritisk väg, scope från B0)

Bygg extraktorn enligt B0:s scope.

**Åtgärd:**
1. Implementera `scripts/extract-golden.ts` enligt B0:s val (Node/jsdom, headless, eller delat).
2. Determinism-validering: 3 körningar mot samma MHTML, byte-identisk output.
3. Korpus-validering: kör mot `corpus/hubspot/`s MHTML, jämför mot committad `golden.json`. Avvikelser är information, inte fail.
4. Runbook in i `corpus/README.md`: när körs extraktorn, vad är promotion-kriterium #4.

**Beroende:** B0 (scope). INTE A — samma MHTML in ger samma bytes ut oavsett om maskerna är korrekt implementerade. A behövs först när B används i C-fasen för att mäta mot korrekt maskerad indata.

**Exit:** Extraktor körs deterministiskt N=3 på samma MHTML, golden-diff dokumenterad i `REPORT-B-<ts>.md`.

---

## Block C — Residual capture-drivers: tarpit + animation (slutfas)

Slår ihop tidigare C och uppskjutet D2. Båda drivers genomgår samma beslutsprocess, med B:s extraktor som mätinstrument.

**Åtgärd, per driver (tarpit, animation):**
1. **Mät score-impact via Block B:** påverkar drivern `golden.json`?
   - Nej → **C1 (narrow):** lägg in som `confirmed-by-design` envelope-mask. Säker eftersom extractor-output är opåverkad.
   - Ja → **C2 (eliminate):** modifiera freeze-pipelinen så drivern tas bort eller deterministiseras före MHTML-serialisering.
2. Implementera vald väg. Verifiera att masken faktiskt maskerar (inte upprepa A-felet).
3. Re-run N=3 capture-determinism.
4. Förväntat utfall: GREEN. Om RED med tredje, nu okänd mekanism → den går in i inventeringen och en ny C-iteration startar.
5. Två gröna körningar på olika dagar krävs innan `pending-determinism` lyfts — skyddar mot tidskorrelerad determinism.

**Exit:** Hubspot promoveras (två oberoende gröna), eller ny mekanism dokumenterad.

---

## Vad planen INTE gör

- Lyfter inte `pending-determinism` automatiskt — kräver två oberoende gröna i Block C.
- Rör inte andra korpus-sajter — hubspot är testfall för metodiken.
- Bygger ingen CI-integration för freeze-checks.
- Ändrar inte promotion-kriterierna i `corpus/README.md` — bara verkställer dem.
- Tar inget policybeslut för animation eller tarpit utan score-impact-data från B.

## Första leverans

Tre parallella rötter i samma omgång: **A + D1 + B0**. A och D1 är sandbox-säkra; B0 är ren läs- och dokumentationsbörda. När alla tre landat har vi: korrekta masker, känd animationsmekanism, och fastställt scope för B — och kan ta B som nästa enda fokuserade arbete.

## Förbehåll

Hela animation-greppet vilar på N=3-observationen att `translateY` varierade mellan freezes. Om den driften av någon anledning absorberas någon annanstans (t.ex. en redan-aktiv mask vi missat) faller D1/C-animation. Verifiera under A:s audit-pass att ingen befintlig mask redan täcker animation-transforms innan D1 dokumenteras som öppen.

---

## Leveransstatus

### Första leverans (A + D1 + B0) — landad 2026-06-17

- **Block A:** `src/lib/tests/snapshot/mhtml-normalize.ts` extraherar
  whitelist-patterns + `normalizeMhtml`; ny `qpDecodeLine`-pass kör innan
  attribut-masker så `content=3D"..."` (wire-shape) matchar de regex som
  skrivits mot `content="..."` (decoded). Enhetstester:
  `src/lib/tests/snapshot/__tests__/mhtml-normalize.test.ts` — 12/12 passerar.
  Audit-pass under arbetet: ingen befintlig mask täcker transform-attribut
  (bekräftar D1:s premiss).
- **Block D1:** `animation:mid-frame-transform` tillagd i
  `scripts/mechanism-inventory.ts` MECHANISMS-array; auto-regenererad
  `fixtures/drift-survey/MECHANISM-INVENTORY.md` (33/33 sites — presence
  ≠ drift). Hint-rad tillagd i `scripts/freeze-determinism-check.ts`
  MECHANISM_HINTS. Ingen WHITELIST-rad införd — i stället en
  "known-open mechanisms NOT whitelisted"-sektion i
  `fixtures/determinism/WHITELIST.md` som dokumenterar både tarpit och
  animation med policy-väntan på Block B.
- **Block B0:** `fixtures/determinism/GOLDEN-FIELD-CLASSIFICATION.md`
  klassar alla golden.json-fält. Slutsats: ~40% render-härlett, inkluderar
  scoring-relevanta `score`, `bgContrast`, `area`, `section`, `aboveFold`.
  **B måste delas:** B-DOM (Node/jsdom) + B-render (headless Chromium med
  pinnad viewport/font). Bonus-upptäckt: committad `golden.json` har en
  slim shape som **inte** matchar live-extraktorn — det finns ett okänt
  projektionssteg som måste lokaliseras innan B-implementation börjar.

**Justering till plan v2:** Block B är nu **B = B-DOM + B-render**.
B-DOM kan köras i sandbox; B-render kräver Browserbase. Block C kräver
B-render output (tarpit och animation slår på render-fält som `section`,
`score`, `aboveFold`), inte enbart B-DOM.

### Nästa leverans

Block B0:s första uppdrag innan B-implementation: **hitta golden-projektionssteget.**
Sök i `src/lib/corpus*.ts`, `scripts/` och `corpus/README.md` efter det som
tar live `PageAuditData` → committad slim `golden.json`. Utan det är B
oavsett implementation strukturellt fel.
