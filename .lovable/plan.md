## Plan: finish Fas 1B with deterministic diagnosis

1. **Add temporary trust debug output**
   - Instrument the testimonial candidate loop in `src/lib/tests/scripts/trustSignals.ts` with a `trustDebug` array on the audit payload.
   - For each candidate around the testimonial guard, record: selector, text preview, headings, image alts, link/button texts, and booleans for `hasExplicitTestimonialClass`, `hasStoryHeading`, `hasCustomerLogo`, `hasByline`, `hasNamedCustomer`, `hasCtaButton`, `headingTextHits`, `passesGate`, and final reject reason.
   - Keep it lightweight and only for candidate containers, so JSON stays readable.

2. **Run the targeted Ualá / Elation / TourRadar comparison**
   - Use the existing audit flow on the HiBob page that produced `testimonialCount: 1`.
   - Compare the three debug entries to identify the exact split: brand/list issue, heading-scope issue, CTA disqualifier, visibility/mobile selector issue, or another guard branch.

3. **Apply the smallest guard fix based on evidence**
   - If heading scope is the split: evaluate the story-heading regex over the whole candidate subtree, not only heading elements.
   - If CTA is the split: let a strong customer-story signal overrule CTA disqualification, while keeping product/department cards blocked.
   - If logo/name matching is the split: remove any accidental hardcoded customer-name path and keep only structural signals.
   - If mobile is the split: adjust candidate selection/visibility for carousel or mobile-rendered cards rather than loosening testimonial logic globally.

4. **Verify regressions before declaring done**
   - Re-run HiBob desktop and mobile; target is `testimonialCount ≈ 3` with evidence for TourRadar, Elation Health, and Ualá.
   - Re-run the English SaaS regression and compare against the pre-strict-guard baseline, weighting this more heavily than the HiBob-specific result.
   - Once stable, either remove `trustDebug` or keep it gated/minimal if useful for future audits.