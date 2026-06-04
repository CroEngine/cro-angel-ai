# Reviderad rollout: Fix 0 → 4 → 2 → 3

Fix 1 är landad och intern­konsistent. Rerun-analysen visade att sidan vandrar mellan körningar (ctaTotalCount 15→18, pageAudit-rects drev 130–220px) medan collect är byte-identisk — alltså snapshottar de två extraktorerna olika DOM-ögonblick. Innan vi rör Fix 2/3/4 måste vi etablera ett stabilt mättillfälle, annars testar vi mot ett rörligt mål.

## Fix 0a — Global settle före extraktion

**Mål:** Båda extraktorerna (`collect` och `pageAudit`) ska snapshotta samma stabiliserade DOM.

**Var:** Ny helper `waitForSettled(page, opts)` i `src/lib/tests/runners/settle.server.ts`. Anropas i `engine.server.ts` precis efter `scrollWarmup` i `collect`-grenen, och i början av `runPageAudit` (samt i `runMobilePass` efter reload).

**Vad helpern gör — viktigt: inte naivt networkidle:**

Befintlig kod i `pageAudit.server.ts:509-511` undviker uttryckligen `networkidle` eftersom autoplay-video + 3p-script håller nätet evigt vaket på t.ex. HiBob. Helpern måste därför vara budgeterad och tolerera "alltid-busy"-sidor:

1. `waitForLoadState('domcontentloaded')` (cheap, ofta redan klart).
2. Försök `waitForLoadState('networkidle', { timeout: 3000 })` — om det timeoutar, fortsätt utan att kasta. Logga `settle: networkidle skipped (busy)`.
3. Pollar `document.readyState === 'complete'` upp till 2s.
4. DOM-stabilitetscheck: mät `document.body.children.length` + `document.querySelectorAll('*').length` två gånger med 500ms mellanrum; om värdena är identiska, klar. Annars vänta ytterligare 500ms (max 2 iterationer).
5. Hård takbudget: 6s total. Returnera `{ settled: boolean, reason: string, durationMs: number }` så vi kan logga.

**Borttag ur FORMS_SCRIPT:** Den planerade `waitForLoadState`-delen av Fix 4 flyttas hit — Fix 4 fokuserar då rent på iframe/embed-logik och slipper dubbel-vänta.

## Fix 0b — Brusgolv: mät vad som fortfarande vandrar

**Inget kodändring i extraktorerna.** Lägg till ett dev-script `src/lib/tests/scripts/noise-floor.server.ts` (manuellt kört, inte i CI) som kör samma URL N gånger via befintlig `runSteps` och diffar JSON-output fält för fält. Output: en lista över fält som varierar ≥1 gång över 5 körningar.

**Kör mot hibob.com/se/ × 5 efter Fix 0a.** Förväntat resultat: rects stabiliseras inom ±5px, ctaTotalCount blir konstant. Allt som fortfarande driftar (A/B-test, cookie-gate, geo-rotation) dokumenteras i `.lovable/plan.md` som "ej regressions­signal" — och Fix 2:s selector-rebaseline måste explicit ignorera de fälten.

**Acceptkriterium för att gå vidare:** ctaTotalCount, count, totalCount, intentBreakdown identiska över 5 körningar. Rects får drifta ≤5px. Om något viktigt fortfarande vandrar — stopp, diagnostisera innan Fix 2.

## Sedan: Fix 4 → Fix 2 → Fix 3 (oförändrad logik)

- **Fix 4 (forms i iframes):** Nu utan settle-koden — bara iframe-provider­detektering (HubSpot/Marketo/Calendly), same-origin introspection, unwrapped input-cluster, `kind: 'native'|'embedded'|'unwrapped'`. Kräver fixture­sida med känd embed innan verifiering.
- **Fix 2 (selectors):** Goal B (walk `buildSelector` upp till ~4 ancestors för adresserbarhet). Goal A (sänk `groupRepeatedControls` tröskel från ≥3 till ≥2) — explicit beslut före implementation. Re-baseline snapshots i lugn och ro.
- **Fix 3 (intent):** Gated på `rg -n "intentBreakdown" src/`. Skippa om ingen consumer läser det.

## Out of scope (oförändrat)

Reconciling `collect` vs `pageAudit` (arkitektur­skulden), interaction-baserad form-detektering via Stagehand `act`, LLM-baserad intent-klassificering.

## Verifiering

Efter Fix 0a: kör Fix 0b mot hibob.com/se/ × 5. Visa diff-rapporten innan vi går vidare till Fix 4.
