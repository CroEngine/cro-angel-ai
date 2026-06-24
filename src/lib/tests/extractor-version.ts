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
//   1.4.0 — hero detection on pages with no usable <h1>. Two deriveHero/sections
//           changes (goldens byte-identical for hubspot/linear — h1 heroes win the
//           anchor finder first; only hero.headline can move, and only for sites
//           that hit these paths):
//           (a) sections.ts derives a `displayHeading` (largest-font text run) for
//               a section with NO semantic heading; deriveHero uses it as the
//               headline fallback. Fixes empty heroes on styled-<div> headlines.
//               Not fed to classifyType, not in the normalized golden.
//           (b) deriveHero excludes off-canvas/chrome sections (aside/nav/footer)
//               from the CTA/heading finders. Fixes the no-h1 case where a cart/
//               search drawer's label was taken as the hero (glossier picked its
//               cart "Edit item" over the real hero "You smell like vacation").
//           (c) deriveHero synthesizes a hero from the page h1 when NO section
//               anchors to it — a landmark-less SPA whose content the walker
//               collapsed into one nav section (warby-parker: valid capture +
//               h1, but hero was undefined). Only fires when no hero section is
//               found at all, so the corpus is untouched.
//           (d) sections.ts walker passes THROUGH display:contents wrappers. They
//               render no box (width/height 0) so the size guards dropped them and
//               their whole subtree — warby-parker (<main> → display:contents div →
//               25 sections) collapsed to one bogus nav section (1 → 19 sections,
//               real hero recovered). A common React/Next pattern, so this is a
//               broad section-coverage fix, not a one-site patch. (c) is now the
//               rare fallback rather than warby-parker's only hero. Corpus goldens
//               byte-identical (hubspot/linear have no display:contents in their
//               section path). Also: displayHeading (a) computed only for
//               above-fold sections — pure perf, below-fold values were never read
//               and on sections-heavy SPAs the per-node scan risked replay timeouts.
//   1.5.0 — ctas.ts excludes image-only / customer-logo links from CTA candidates.
//           A button-ish <a> with NO visible text of its own but an <img>/<svg>
//           child (its label comes from alt/aria) is social proof, not a CTA.
//           Surfaced by a 50-site measurement sweep: notion's hero "trusted by"
//           strip (OpenAI/Figma/Ramp/Cursor/Vercel) each scored cta_primary/
//           conversion, so deriveHero took the hero CTA as "OpenAI" instead of
//           "Get Notion free"; the same logos inflated CTA counts (linear 30 → 12
//           total). Re-bless linear golden (ctaSummary.total 30→12, aboveFold 3→2);
//           hubspot unchanged (no image-only links scored as CTAs there).
//   1.6.0 — ctas.ts primary-CTA scoring catches small + outline buttons (real hero
//           CTAs were scoring secondary). Two changes: (1) hasSurface also counts a
//           visible border, so outline/ghost buttons (transparent fill) are surfaced
//           CTAs instead of dropped links; (2) the button-size floor drops 90×28 →
//           64×28, which missed normal small buttons — linear's above-fold "Sign up"
//           (≈78×30) scored 3 → secondary, leaving its hero CTA empty. Surgical, not
//           over-classifying: linear hero CTA "" → "Sign up", primary 0 → 1; both
//           hubspot/linear +2 total (outline buttons now counted); hubspot primary
//           unchanged. Re-bless both goldens.
//   1.7.0 — deriveHero hero-CTA selection prefers a conversion ACTION over a weak/
//           content link that also scored cta_primary in the hero. A second
//           50-site sweep caught it: hashicorp took "Learn more" and replit
//           "Quarterly review preview" as their hero CTA over the real "Get
//           started" / "Start building". Prefer-only (HERO_CTA_CONVERSION regex);
//           the original any-primary pick stays the fallback, so a non-matching
//           CTA like "Contact sales" still wins when it's the only primary →
//           strictly additive, never a regression. Corpus byte-identical (hubspot/
//           linear hero CTAs are already conversion-worded — linear's "Sign up").
//   1.8.0 — trustSignals.ts accuracy pass (replayed against real captures:
//           supabase, rei, airbnb, patagonia, vercel, gymshark, notion, hubspot).
//           Six changes; only hubspot's golden moves (gains the real "299,000+
//           customers" social proof the old anchor dropped — total 3→4); linear
//           byte-identical.
//           (a) RECALL — short-block sentence-anchor exemption. The text-pattern
//               scan required the matched keyword to BOTH start and end a sentence,
//               so any phrase with a trailing word was rejected: "GDPR Compliant",
//               "30-day money-back guarantee", "As seen in TechCrunch", "Trusted by
//               4,000+ companies", "Rated 4.8 out of 5 by 2,341 customers" — ~2/3 of
//               real trust copy silently dropped. Now a SHORT block (<=120 chars:
//               badge/caption/label/heading) is accepted on keyword presence; the
//               strict anchor still guards LONG prose (incidental keyword in a
//               paragraph stays rejected). Recovered supabase 0→8 (trusted_by + 5
//               certs), airbnb 0→11 (listing ratings), notion →5, hubspot +1.
//           (b) PRECISION — star clusters drop CSS-utility false friends. The
//               [class*="star"] selector also matched "items-start" / "col-start-2"
//               / "row-start-1" / "self-start" (all contain the substring "star"),
//               so every Tailwind/grid site coined phantom rating clusters (vercel
//               "avg 1.33", patagonia "avg 0"). Candidates now need a real token —
//               "star" not inside "start", or "rating" not inside "operating" —
//               while genuine widgets (rei "avg 4.52") survive.
//           (c) PRECISION — a payment-method strip needs >=2 DISTINCT brands. A lone
//               Stripe/Klarna/PayPal/Apple-Pay image is a marquee CUSTOMER logo, not
//               a checkout badge; one such image used to emit "1 payment provider
//               logos". Textual "secure checkout / SSL / 256-bit" still covers
//               single-provider claims.
//           (d) PRECISION — trusted_by no longer carries the press cues "as seen in"
//               / "featured in"; those move wholly to press_mention, so an "As seen
//               in …" line is one signal, not double-typed as trusted_by + press.
//           (e) PRECISION — within one block, a "N reviews" volume that co-occurs
//               with an X/5 rating is the review COUNT (already on
//               review_rating.reviewCount), not an independent social_proof_count —
//               a product card "1,306 reviews · 4.6/5" counts once (rei 28→22).
//           (f) RECALL — guarantee also matches bare "guarantee(d)" / "warranty" /
//               "garanti", catching badges like patagonia's "Ironclad Guarantee"
//               that the day/money-back/return-policy framing missed.

export const EXTRACTOR_VERSION = "1.8.0" as const;

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
