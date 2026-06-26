# structure-eval — page-structure ground-truth benchmark

Measures **how accurate the section + CTA detectors actually are** — the sibling
of [`trust-eval`](../trust-eval/README.md), for page structure instead of trust
signals. Same method: hand-label ground truth from the *rendered* page, replay
each frozen capture through the real detectors, score against the labels
(including the cells where the detector is wrong).

## What it measures

Two metrics, both from `runPageAudit` (the same detectors the audit + the Angel
snippet use):

1. **Section-type presence** — precision / recall / F1 over `(site × type)` for
   the semantic section types the classifier can emit:
   `hero, features, benefits, pricing, faq, testimonials, form`. Label `1` = a
   section of that type is present on the rendered page; the detector "got" it if
   `audit.sections[].type` contains it.
2. **Primary CTA** — does the derived hero CTA (`audit.hero.primaryCtaText`) match
   the real primary action? `pick accuracy` over sites that *have* a single
   primary CTA, plus a `no-false-primary` rate over sites that genuinely don't
   (does the detector avoid inventing one?).

## Labels are independent of the detector

`labels.json` is hand-marked from rendered evidence — the heading outline +
above-fold buttons from `scripts/structure-evidence.ts` (a raw DOM walk that does
**not** run the classifiers) plus the committed `screenshot.jpg`. Each site has a
`_note` recording the evidence. Definitions used:

- **hero** — a prominent above-the-fold intro/banner/masthead with a headline.
  News/feed/app-shell pages that open straight into an article or listing grid
  (verge, lemonde, spiegel, aftonbladet, dev-to, github-blog, spotify, airbnb)
  are labeled hero=0 on purpose — they have no marketing hero.
- **features / benefits** — a section enumerating product capabilities (features)
  or outcomes/why (benefits). **pricing / faq** — an on-page pricing-plan or FAQ
  section (a "Pricing" nav *link* does not count). **testimonials** — customer
  quotes/reviews. **form** — a section whose primary content is a form
  (newsletter/contact), not an inline search box.
- **primaryCta** — the single dominant conversion action, or `null` when the page
  has none (news, search-driven, marketplace, or co-equal "Shop X" e-commerce).

## Result (v1.18.0 detectors)

35-site local run (`bun run structure-eval`); CI scores the 32 committed captures
(everlane / figma / stackoverflow are gitignored angel-sample, local-only).

### Section-type presence — **P 60.0% · R 60.0% · F1 60.0%** (35 sites)

| type | tp | fp | fn | P | R |
|---|---|---|---|---|---|
| testimonials | 8 | 0 | 3 | **100%** | 73% |
| hero | 19 | 8 | 5 | 70% | **79%** |
| pricing | 1 | 1 | 0 | 50% | 100% |
| features | 1 | 1 | 12 | 50% | 8% |
| benefits | 0 | 1 | 0 | — | — |
| faq | 0 | 1 | 0 | — | — |
| form | 1 | 8 | 0 | 11% | 100% |

> **Corpus expansion (32 → 35).** Added 3 editorial controls — stackoverflow
> (Q&A feed) + dn/svd (2 SE news papers) — which dropped precision from a rosier
> **66.7% → 60.0%** while recall held at 60%: a less optimistic, more trustworthy
> number. The new FPs are all the expected kind — `dn/hero` + `svd/hero` (deriveHero
> anchoring on a news h1, the bounded gray area), `stackoverflow/faq` ("Newest
> Questions"), and a couple article-keyword survivors. No detector change; the
> harder corpus simply measures it more honestly.

Three structure-eval-driven passes took this from the first-run **P 46.7% / R 42.0%**
(see history below). What remains weak, and why:

- **`features` (R 8%) is the last weak type** — it still needs a magic heading
  word ("Powerful features"); a section like "Bring all your work together" misses.
  Unlike testimonials/hero it has no clean structural signal, so it's the hardest
  to lift without adding FPs.
- **`form` (P 13%) counts inline search sections** the labels don't, and the
  `hero` FPs are all news/feed/app pages (verge, lemonde, spotify) whose article
  h1 `deriveHero` anchors on — a definitional gray area, bounded (precision held
  at 76% even as recall rose).

> **v1.18.0 — hero aligned with deriveHero.** classifyType's geometry guard
> rejects a tall hero wrapper (vercel/gymshark/trello's top section is 5–7× the
> viewport, over the 2.5× cap), so the real hero came back `content`. `deriveHero`
> already anchors on the page h1 and finds it; the section it points at is now
> promoted to `hero`. hero went **R 54→79%** (precision held at 76%); overall
> **R 48→60%, F1 55→63%**. Re-blessed hubspot (hero 2→3).

> **v1.17.0 — testimonials by structure.** Each testimonial trust signal is
> attributed to the *smallest* section containing it, and that section becomes
> `testimonials` — replacing the heading keyword that tagged "…Customer Platform"
> / The Verge's "Reviews" as testimonials (FP) and missed quote-only sections (FN).
> testimonials went **P 67→100% · R 36→73%** (verge/ikea FPs gone; loom/notion
> recovered); overall **P 57→65% · R 40→48%**. Re-blessed hubspot (3→1) + linear
> goldens against rendered evidence.

> **v1.16.0 precision gate.** The first run scored **P 46.7%** — news/blog/feed
> pages turned every card into a section: dev-to's "Why Your Search Bar
> Understands You" → benefits, "…System Design Questions" → faq; Der Spiegel's
> "…plant Fronta…" → pricing. `pricing/faq/features/benefits` now only fire when
> the heading reads like a short section *label* (1–4 words, no trailing ?/!),
> not when a keyword sits inside an article title. Killed 9 editorial FPs
> (precision +10 pts) at a cost of one recall point — loom's 6-word "Powerful
> features for easy, custom recordings" is now missed (recoverable via structural
> cues). Corpus byte-identical (hubspot/linear carry none of these four types).

### Primary CTA — **pick accuracy 85.7% (12/14)**, no-false-primary 14.3% (3/21)

`deriveHero` is far stronger than the section typer: on the 14 sites with a real
primary CTA it now picks the right one 12 times. The 2 misses are vercel
("Get a Demo" vs the labeled "Deploy Now" — both real hero CTAs, a labeling
judgment) and gymshark (now correctly "(none)" rather than a wrong pick — the real
"Shop Now" never scores `cta_primary`).

> **v1.15.0 fix (this benchmark's first catch).** The first run scored 78.6% —
> `deriveHero` asserted a weak link / chrome / nav tab as the hero CTA: hubspot's
> lone `cta_primary` was "Learn more about Revenue Hub" (the real "Get a demo…" sat
> in `cta_secondary`, which `deriveHero` never considered); gymshark took "search".
> The fix makes a hero CTA require a real *action* (no learn-more/cookie/search/nav)
> and lets the conversion-worded preference scan `cta_secondary` too — while still
> allowing a conversion CTA that lives in the nav (linear's primary IS the nav
> "Sign up"). hubspot's golden was corrected (it had enshrined the bug).

The `no-false-primary` rate (does the detector avoid inventing a CTA on the 18
pages that have none?) is still poor and **not gated** — but the egregious picks
(gymshark "search", verge's "LATEST" nav tab) are gone; what remains are genuinely
conversion-worded buttons the page does have (Subscribe, Sign up, Register) that
simply aren't a single dominant CTA. Category tabs scored conversion in the hero
region (patagonia "Women's") are the residual hard case.

## Running

```
bun run structure-eval                 # score all captures on disk (32 local)
bun run structure-eval hubspot stripe  # subset
bun run structure-evidence hubspot     # dump the raw labeling evidence
```

The CI gate (`__tests__/structure-eval.test.ts`) floors section P≥0.55 / R≥0.50
and CTA accuracy ≥0.70 — a few points under measured, so a broad regression reds
the build while the known weakness (features) doesn't. **Re-tighten as the
classifier improves.** The honest takeaway: trust detection is production-grade;
section typing went from 47%→60% F1 over three passes (then a corpus expansion that traded optimism for robustness) and `features` is the last
weak type — this benchmark is the yardstick for it.
