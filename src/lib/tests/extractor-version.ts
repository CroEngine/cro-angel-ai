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
//   1.9.0 — customer_logos also detects inline-SVG logo walls (recall). Modern
//           SaaS render their "trusted by" logos as inline <svg> (no src/alt),
//           invisible to the <img>-based pass — vercel, intercom, linear, stripe
//           all hide customer logos this way. A cluster of >=4 logo-sized inline
//           svgs sharing a container is accepted as a wall ONLY on a strong logo
//           signal so icon/feature grids never false-fire: a logo/customer
//           CONTEXT word on the container or an ancestor, OR a wordmark SHAPE
//           (widths vary >=2x AND each is wider-than-tall) — the signature of
//           brand wordmarks that uniform-square icon grids lack. One signal per
//           page (largest wall), like the <img> pass. Measured: vercel 0->1,
//           intercom +logos, stripe's multi-strip 6->1(svg); precision-clean on
//           hubspot/supabase/notion/glossier/airbnb/verge/figma (no spurious
//           wall from icon grids). Re-bless linear golden (gains its svg
//           customer-logo strip — trustSummary total 2->3, +customer_logos);
//           hubspot byte-identical (its logos are <img>, already counted).
//   1.10.0 — customer_logos unified into one wall-based detector over img + svg,
//           replacing the old GLOBAL img count (>=4 logo-sized imgs anywhere on
//           the page). That global count had no precision floor, so media /
//           e-commerce pages read their scattered article/product thumbnails as
//           a "trusted by" wall (The Verge: 33; rei: 10; patagonia: 6; allbirds).
//           Now a wall must be a container of >=4 logo-sized media that is a
//           strip / compact grid (height <= 600 — alone this drops a whole-page
//           image scatter, e.g. Verge's 13,971px "wall") AND carries a logo
//           signal: a logo/customer CONTEXT word on the container/an ancestor,
//           most media with "logo" in src/alt, or a wordmark SHAPE (widths vary
//           >=2x AND wider-than-tall). One signal per page (largest wall), also
//           folding in the v1.9.0 svg pass (stripe's img+svg now counts once).
//           Measured: real walls kept (hubspot, supabase, notion, linear,
//           vercel, intercom, stripe, figma); false positives dropped (verge,
//           rei, patagonia, allbirds -> no customer_logos). Re-bless hubspot
//           golden: trustSummary.aboveFold 1->0 — the old path anchored on the
//           first logo-sized <img> (a header/nav logo, above fold); the real
//           customer-logo wall is below the fold. customer_logos count and
//           linear golden byte-identical.
//   1.11.0 — coverage fixes surfaced by an 18-site hand-labeled ground-truth
//           benchmark (precision/recall measured against labels derived from the
//           rendered pages, independent of the detector). Four principled fixes,
//           validated to generalize on 6 fresh hold-out sites:
//           (a) guarantee — also matches plural/idiomatic returns: "Returns
//               Policy", "free/easy returns", "X-day returns", "returns &
//               exchanges". Only singular "return policy" matched before
//               (missed gymshark/warby-parker/everlane).
//           (b) social_proof_count — accepts non-customer units (companies/
//               businesses/teams/people/developers/…) and abbreviated magnitudes
//               (150K, 119m, 1.9T). Missed "400,000 companies" (loom),
//               "150K+ users" (stripe), "119m users" (klarna). Small headcounts
//               stay excluded (the number still needs comma-grouping / 4+ digits
//               / a K-M-B-T suffix, so "5 people" never matches).
//           (c) certification — bare "certified" no longer matches a PARTNER
//               certification ("Stripe-certified experts/partners/developers");
//               real compliance certs (ISO/SOC2/GDPR/HIPAA/"… certified") still
//               match. Fixes a stripe false positive.
//           (d) review_badges — app-store / download badges (Google Play, App
//               Store) under /badges/ paths are excluded; they are not
//               third-party REVIEW badges. Fixes a rei false positive.
//           No corpus golden change (hubspot/linear have none of these tokens;
//           hubspot review_badges are real, not app-store). Detector-only;
//           bumped because src/lib/tests/scripts/* changed.
//   1.12.0 — customer_logos precision: the pure-visual WORDMARK path (no logo/
//           customer context word, no "logo" in markup) now requires >=6 members.
//           It fired on booking.com's 16px strip of 5 unlabeled sister-brand
//           wordmarks; a small unlabeled wordmark strip is more likely sister-
//           brands / partners / decoration than a customer-logo wall. Context- or
//           "logo"-backed walls still qualify at >=4, so real walls are
//           unaffected (vercel 7, intercom 24 keep qualifying on shape; supabase/
//           notion/linear/stripe/hubspot/figma via context or "logo" path).
//           Benchmark: customer_logos precision 83->100% (booking FP removed),
//           recall held at 100%; overall precision 92.9->96.3% (26 TP / 1 FP)
//           with no recall loss. No corpus golden change.
//   1.13.0 — review-score WIDGET detection (recall). The /5 text scan missed
//           rating widgets where the score and review count live in separate
//           child nodes — booking.com "8.5 Very Good · 3,339 reviews",
//           "4.6 (1,200 reviews)" — common on travel / hotel / marketplace /
//           e-commerce. New pass: a compact (<=120 char) container with a DECIMAL
//           score (X.Y or 10) co-located with a review COUNT ("N reviews")
//           emits review_rating (ratingScale=10 when the score is >5, i.e. a
//           /10 widget). Tightly gated — both signals required together — so a
//           bare count ("3,339 reviews") or a stray decimal ("Version 8.5")
//           never fires; nested duplicates collapse via the hierarchy dedup.
//           Detector-only; no corpus golden change (hubspot/linear show no
//           review-score widgets).
//   1.14.0 — precision/recall fixes surfaced by EXPANDING the hand-labeled
//           ground-truth benchmark from 18 to 32 sites (added news/media,
//           marketplace, SE e-commerce, SPA, consent-wall captures — the
//           adversarial cases the SaaS-heavy set never exercised). The bigger
//           corpus exposed five real defects; all fixed and locked with unit
//           tests. Benchmark moved 90.0/80.4/84.9 -> 98.0/84.2/90.6
//           (precision/recall/F1; TP 45->48, FP 5->1, FN 11->9).
//           (a) PRECISION — testimonial attribution gate. A carousel slide
//               qualified as a testimonial on a bare quote MARK (or any hyphen
//               + capital). News sites quote in »…« headlines and music/product
//               carousels use "- Title", so Der Spiegel coined 30 phantom
//               testimonials and Spotify 6. A quote mark now only counts WITH a
//               real attribution — an explicit testimonial/quote/review class,
//               a <cite>/<figcaption>, a customer logo, or a name parsed from a
//               "— Name, Company" author line. Blockquotes still pass on the tag.
//               No real testimonial lost (hubspot/linear/intercom/figma/notion/
//               trello/loom/stripe all keep theirs via tag/class/cite/name).
//           (b) PRECISION — stars-anchor commerce guard. A product card carrying
//               an aggregate star rating in a carousel was derived as a customer
//               quote (IKEA: 13 product cards "★4.4 GREJSIMOJS … 99:-"). Cards
//               that read as commerce — a price token (incl. SEK "99:-"), a
//               sale/price label, or an add-to-cart affordance — are no longer
//               derived as testimonials; real review cards (stars + quote + name,
//               no price) still are.
//           (c) PRECISION — a payment-method strip is secure_payment, not a
//               customer-logo wall. IKEA's footer visa/mastercard/amex/swish row
//               is served under /assets/logos/, so it qualified via "logo" in the
//               path AND double-counted as customer_logos (already correctly
//               emitted as secure_payment). A wall whose members are mostly
//               payment marks is now skipped by the logo-wall pass.
//           (d) RECALL — guarantee also matches "Returns/Exchanges" (slash
//               separator, not only "&"/"and") and "Refund policy" (not only
//               "Return policy"). Missed allbirds' footer.
//           (e) RECALL — social_proof_count tolerates up to two adjectives
//               between the number and the unit ("3,958,285 amazing developers"
//               — dev-to; "33,000 product teams" — linear). The window is
//               bounded to letter-only words so it never spans to an unrelated
//               noun ("50,000 sq ft warehouse" stays out).
//           Benchmark label correction (documented, independently verified, NOT
//           detector-driven): linear social_proof_count 0->1. The original
//           above-fold labeling pass missed a first-party adoption claim
//           "Linear powers over 33,000 product teams" — the count sits in a
//           <strong> at y~9208, deep below the fold. Re-confirmed from the
//           rendered DOM; it is the same claim class already labeled 1 on
//           hubspot/loom/hibob/dev-to. Re-bless linear golden (trustSummary
//           total 3->4, +social_proof_count); hubspot byte-identical.
//           One benchmark FP remains, honestly kept: vercel "Mintlify powers
//           documentation for 20,000+ companies on Vercel" — a THIRD-PARTY
//           customer's stat in a case-study card, which the detector cannot
//           distinguish from a first-party claim without overfitting.

export const EXTRACTOR_VERSION = "1.14.0" as const;

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
