# Återanvändnings-genomgång (2026-07-14)

**Ägarens fråga:** "kolla igenom koden så vi inte har byggt liknande saker
flera gånger, och att vi återanvänder isåfall."

**Metod:** 6 parallella skanningar per tema (intent/CTA, text/DOM-utils,
mät-harness, innehållsmodeller, config/segment, scripts-vs-src) → varje
konsolideringskandidat adversariellt verifierad mot faktisk kod (26 agenter).
Utfall: **10 avsiktliga** dubbletter (by design, med pinnar), **9 konsoliderade
nu** (denna PR), **resten medvetet senare** (nedan, med skäl).

## Konsoliderat i denna PR (beteende-identiskt om inget annat sägs)

| Vad | Kanonisk plats | Tidigare kopior |
|---|---|---|
| FNV-1a-hashen (all bucketing/decision-ids) | `src/adaptive/hash.ts` (ny löv-modul) | decide.ts, serve.ts rampBucket, routes/decide.ts holdout — bit-identiskt (samma konstanter, `·`-saltet bevarat) |
| Grind-loopen: mät → grinda → kollisions-retry (ETT extra lyft per unikt mål) | `measure.ts` `runGatedAttempts` + `toRenderMeasurements` | auto-generate, breadth-test, lab/redesign-render bar varsin kopia av 13-fälts-mappningen + retryn |
| Same-page-anchor-beräkningen (canonical/og:url-bas, MHTML-replay-fallback) | `shared/intent.ts` `samePageAnchorShared` | ctas.ts + collect.ts hade identiska block; paritetstestet pinnar nu även denna |
| Kodgen-pinne för harvest-bundlen | CI-steget "Harvest bundle codegen pin" (`bun run build:harvest && git diff --exit-code`) | — (luckan som lät Fas 1 handredigera den genererade filen) |
| Etikettnormalisering (trim+lowercase+collapse) | `crawler-inventory.ts` `normalizeLabel` | claims.ts, inventory-drift.ts itemKey (driftens SKIFTLÄGESKÄNSLIGA norm behålls medvetet för ändringsdetektering) |
| Success–failure-regeln för A/B-signifikans | `aggregate.ts` `armStatValid` (exporterad) | winner.ts hade en privat kopia |
| Overflow/krock-trösklarna (8 px / 100 px) | `render-gates.ts` `H_OVERFLOW_FAIL_PX`/`V_OVERLAP_FAIL_PX` | analyze.ts + dashboardens grind-etiketter hade magiska tal |
| mulberry32 (labbets deterministiska RNG) | `scripts/lab/rng.mjs` | run-lab.mjs + simulate-serving.ts — bit-identiskt bevisat (4 seeds × 1000 dragningar) |
| Död intent-taxonomi i etiketteraren | — (borttagen; GOAL_KINDS i goal-judge är konverterings-slagens ägare) | labeler.server.ts INTENTS + write-only `llmIntent` (noll läsare); LABEL_VERSION v1→v2 så cache åldras ut |

Plus CTA-fixens egna konsolideringar (se PR-beskrivningen): extract.ts →
delade intent-klassificeraren; struktur-skannern in i build-harvest-källan;
redesign-render porterad till delade mätaren.

## Avsiktliga dubbletter (by design — rör dem inte utan att flytta pinnen)

- **Snippetens applyVariant** (public/adaptive.js) vs `measure.ts`: fristående
  browser-JS; pinnas av serving-smokens 42 checkar i CI.
- **Harvest-bundlens inlinade klassificerare**: kodgen (`build-harvest.ts`) +
  `toString()`-inlining; pinnas nu av kodgen-steget i CI + paritetstesterna.
- **Klient- + server-PII-skrubbning** (safeUrl/safePath vs sanitize.ts):
  lagrad försvar, olika algoritmer med avsikt, dokumenterat i båda ändar.
- **Två frysvägar** (curl `freeze-page.ts` vs browser `freeze.server.ts`):
  olika kapabiliteter (SSR vs SPA), medvetet.
- **measure.ts `norm()` inne i page.evaluate**: kan inte importera moduler
  in i browser-kontexten; dokumenterad spegel av snippetens semantik.

## Medvetet senare (störst värde först — egna PR:ar med egen verifiering)

1. **Labb-sandboxen applicerar med v1-semantik** (build-lab-sandbox.ts):
   ägarens demosida kan applicera flyttar produktionen skulle VÄGRA. Fix:
   driv snippetens egna applyVariant via `__ANGEL_HARNESS__`-sömmen (samma
   mönster som CI-smoken). → uppgift.
2. **Segmentnyckel-modulen**: tre byggare + två prefix-matchare + en parser
   av `kanal·enhet·land·ny/återkommande` → en löv-modul `src/lib/segment-key.ts`.
   Rör serve-vägens matchning — kräver egen noggrann PR. → uppgift.
3. **Sektions- + trust-vokabulär delas** (extract.ts classify() är engelsk-bara
   — samma klass av lucka som CTA-fyndet; trust-mönstren i två varianter).
   Delad vokabulärkärna, varje sida behåller sin harness. → uppgift.
4. **site-config-normalisering** (`rowToSiteConfig`): persistence + dashboard
   mappar angel_sites-raden var för sig; dashboarden saknar holdout-clampen.
5. **resolveRole-precedensen** inline i dashboarden (LLM-demotion ignoreras
   i badge-visningen — visningsdrift, inte servingfel).
6. Mindre: HTML-escape-hjälpare i labbets galleri-skript; fold-heuristiken
   (`innerHeight || 720`) ×5; exposure-event-schemat som delad konstant;
   `sections.ts` normHeading via inlining-mönstret.

**Kvarstående stora tvillingen (känd, arkitektonisk):** redesignens
innehållsmodell (`extract.ts`) vs harvest/crawlerns ContentInventory — två
förståelser av "vad finns på sidan". Konsolidering är ett eget projekt;
vokabulärdelningen (punkt 3) är första steget.
