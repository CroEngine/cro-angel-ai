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

export const EXTRACTOR_VERSION = "1.2.0" as const;

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
