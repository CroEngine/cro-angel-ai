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

## Result (v1.14.0 detectors)

32-site local run (`bun run structure-eval`); CI scores the 30 committed captures.

### Section-type presence — **P 57.1% · R 40.0% · F1 47.1%** (v1.16.0)

| type | tp | fp | fn | P | R |
|---|---|---|---|---|---|
| hero | 13 | 4 | 11 | 76% | 54% |
| features | 1 | 1 | 12 | 50% | 8% |
| testimonials | 4 | 2 | 7 | 67% | 36% |
| pricing | 1 | 0 | 0 | 100% | 100% |
| benefits | 0 | 1 | 0 | — | — |
| faq | 0 | 0 | 0 | — | — |
| form | 1 | 7 | 0 | 13% | 100% |

This is **much weaker than trust detection (98/84)** — and that is the finding.
The section classifier (`classifyType` in `scripts/sections.ts`) is keyword-driven
and conservative, so:

- **It labels almost everything `content`.** notion → 21 sections, **0** typed
  `hero`; gymshark → 28 sections, all `content`. Hence low recall on
  hero/features/testimonials — the real sections exist but come back `content`.
- **`hero` is rarely emitted as a section type** even when the page clearly has
  one, because `<header>`/geometry guards fire first. The product's actual hero
  finder is the *separate* `deriveHero`, which DOES locate it — that mechanism is
  measured by the CTA metric below, not here.
- **features/testimonials need magic heading words** (`/feature|how it works/`,
  `/testimonial|customer|review/`). Headings like "Remarkable results", "Loved by
  teams that ship", "Bring all your work together" miss → false negatives.
- **`form` (search sections) + the geometry `hero` on news/app pages** are the
  residual FPs; testimonials on editorial pages (verge/ikea) is the next pass.

> **v1.16.0 precision gate.** The first run scored **P 46.7%** — news/blog/feed
> pages turned every card into a section: dev-to's "Why Your Search Bar
> Understands You" → benefits, "…System Design Questions" → faq; Der Spiegel's
> "…plant Fronta…" → pricing. `pricing/faq/features/benefits` now only fire when
> the heading reads like a short section *label* (1–4 words, no trailing ?/!),
> not when a keyword sits inside an article title. Killed 9 editorial FPs
> (precision +10 pts) at a cost of one recall point — loom's 6-word "Powerful
> features for easy, custom recordings" is now missed (recoverable via structural
> cues). Corpus byte-identical (hubspot/linear carry none of these four types).

### Primary CTA — **pick accuracy 85.7% (12/14)**, no-false-primary 16.7% (3/18)

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

The CI gate (`__tests__/structure-eval.test.ts`) floors section P≥0.40 / R≥0.35
and CTA accuracy ≥0.70 — a few points under measured, so a broad regression reds
the build while the known weakness doesn't. **Re-tighten as the classifier
improves.** The honest takeaway: trust detection is production-grade; section
typing is the next thing to harden, and this benchmark is the yardstick for it.
