// SCORE COMPARABILITY CONTRACT (A+C)
// =====================================================================
// Detta är den enda axel där "samma score betyder samma sak" upprätthålls.
// Bumpa EXTRACTOR_VERSION vid varje ändring i:
//   - src/lib/tests/scripts/*           (browser-side DOM-extraktion)
//   - src/lib/tests/runners/pageAudit.server.ts (aggregering, derivering)
//   - src/lib/tests/engine.server.ts    (om scoring-aggregering hamnar där)
//
// Bumpa INTE för:
//   - UI-ändringar, kommentarer, refactor utan beteendeändring
//   - Provenance/diagnostik (env-stämplar, performanceProxy, pagespeed)
//
// Stämpeln måste bäras på varje audit-resultat OCH varje emitterad score
// (när score-aggregator byggs). En score utan extractorVersion är per
// definition ojämförbar med någon annan score.
//
// Changelog:
//   1.0.0 — initial. Lock-in efter att hero-headline / skip-link /
//           word-rotator-fixarna landat.
//   1.1.0 — completeness ("catch everything"). collect.ts behåller nu
//           interaktions-gömda element (mega-menyer, kollapsad mobilnav,
//           tab-paneler, accordions) med visible:false istället för att släppa
//           dem — innehållet finns redan i den frysta MHTML:en, droppet var
//           extractor-sidigt. Synligt-bara element är oförändrade. normalize
//           bär visible per element + visibleCount/hiddenCount i collect-rollup.
//           Goldens omblessas (count stiger, ny visible-axel).
//   1.2.0 — scoring-lager. croScore.ts: deterministisk CRO-rubrik (cta-focus,
//           visual-hierarchy, value-prop, trust, friction, quality) som ren
//           funktion av den normaliserade goldenen. Goldenen bär nu ett
//           croScore-block ("the golden has finished scoring") — regressionstestat
//           av samma snapshot-diff. Stämpeln bärs på scoren.
//   1.2.1 — score-kalibrering efter ground-truth mot screenshots. cta-focus
//           dedupar nu samma CTA upprepad i sticky-nav + hero (slutar straffa
//           standard primary+secondary-mönstret som "choice overload"); 2 unika
//           = bra. value-prop väljer starkaste rubriken av hero.headline/h1
//           (pageAudit-heuristiken plockar ibland en nav-label, t.ex. hubspots
//           "Marketing", medan värdeerbjudandet ligger i h1).
//   1.3.0 — page-type-medveten rubrik (adaptiv enkel rubrik). classifyPageType
//           klassar deterministiskt saas-landing/ecommerce/content-media/generic
//           från räknebara golden-signaler (priser, commerce/saas-CTAs, info-
//           länkar). Samma sex dimensioner men cta-focus + value-prop + vikterna
//           anpassas per typ — slutar mis-scora ecommerce (många shop-CTAs är
//           normalt) och media (ingen hård CTA). Goldenen bär pageType + signals.

//   1.4.0 — page-type classification hardened toward language-independent
//           STRUCTURE (deterministic, no LLM): content-media on article-link
//           density; ecommerce on shop-CTA walls with currency-symbol prices as
//           a non-classifying corroborator (so "$5M funding" on a news site
//           can't trip it). Emits pageTypeConfidence (margin of victory) so a
//           low-confidence call on an ambiguous homepage is legible. i18n
//           symbol-less stores (ikea-se "kr") remain a documented limit.

export const EXTRACTOR_VERSION = "1.4.0" as const;

export type ExtractorStamp = {
  extractorVersion: string;
  capturedAt: string; // ISO; tidpunkt extractor körde (inte capture-time)
};

export function stampExtractor(): ExtractorStamp {
  return {
    extractorVersion: EXTRACTOR_VERSION,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Wrap any score-payload med extractor-stämpel. Future score-aggregator
 * MÅSTE använda den här istället för att hardkoda strängar.
 */
export function stampScore<T extends Record<string, unknown>>(
  payload: T,
): T & ExtractorStamp {
  return { ...payload, ...stampExtractor() };
}
