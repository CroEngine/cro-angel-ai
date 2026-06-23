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
//   1.1.0 — heading/hero text via cleanHeadingText: innerText (visible-only,
//           drops display:none responsive/a11y headline copies) + collapse of
//           exact >=3-word whole-phrase repetition. Fixes duplicated/concatenated
//           hero headlines (e.g. linear's h1 read 3x via textContent). Word-
//           rotator case (hubspot) verified unchanged. Re-bless goldens.
//   1.2.0 — deriveHero anchors on the page h1 + rejects UI-label headings.
//           Fixes hero mis-selection where off-canvas overlay panels (cart/nav/
//           modal) typed "hero" had their label taken as the headline
//           (hubspot "Marketing", spotify "Home", glossier "Shopping Bag") while
//           the real hero sat in a "content" section. Re-bless goldens.
//   1.3.0 — ctas.ts excludes accessibility skip-links ("Skip to content"/"Jump
//           to main") from CTA candidates. They are button-ish anchors that
//           scored cta_primary (hubspot, everlane) and crowded out / replaced
//           the real hero CTA. Re-bless goldens.

export const EXTRACTOR_VERSION = "1.3.0" as const;

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
