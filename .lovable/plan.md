Revised ordering. Same four fixes, but sequenced by **verifiability in the same sitting**, not blast radius. One fix → one commit → one regression run between.

## Order: 1 → 4 → 2 → 3

Rationale: a solo builder can't tell which fix moved a number if they ship a block. And the value of doing a fix first depends on whether you can confirm it worked in the same session — not just on its blast radius.

---

### Fix 1 first — rename + internal reconciliation (safe, mechanical, snapshot-verifiable)

Builds momentum and clears terminology before any behavior change. Touches many files but each change is mechanical.

- Rename `collect.summary.primaryCtaCount` → `primaryConversionCtaCount` (category=primary AND intent=conversion).
- Declare `CTAS_SCRIPT` canonical for `pageSummary` and document in `audit-helpers.ts`. Keep `pageSummary.primaryCtaCount` only under that declaration; otherwise rename.
- **Close the within-object gap** in `pageSummary`: `primary(3) + secondary(11) = 14` but `ctaTotalCount = 15`. The missing one is `icon_button`. Either:
  - add `iconButtonCount` / `otherCtaCount` so `primary + secondary + iconButton + other === total`, or
  - exclude `icon_button` from `ctaTotalCount` and document.
- Sweep consumers: `findings.ts`, `engine.server.ts:346`, `:404`, `schema.ts:282`, `:540`.

**Verify:** snapshot diff is small, surgical, and limited to field names + the chosen icon_button decision. Commit. Run regression — if numbers shift, it's not this fix.

---

### Fix 4 second — only after a test page with a real embed exists

The fix has the highest behavioral value, but it's also the only one you can't confirm without a known-good page. HiBob /sv has no form on the landing page (it's behind the CTA), so shipping Fix 4 against it returns 0 with a logged reason whether the logic works or not. **Shipping unverifiable code is the worst first step.**

Prerequisite (do this before coding):

- Pick a fixture page with a known HubSpot/Calendly/Marketo embed visible on the landing route. Add it to the regression set.

Then implement:

- **Settle before scanning.** `waitForLoadState('networkidle')` + 500–1000ms grace before `FORMS_SCRIPT`. Without this the iframe heuristic sees an empty DOM.
- **Iframe provider detection.** Match `iframe[src]` host against `hsforms|hubspot|marketo|calendly|typeform|cognitoforms|jotform|gohighlevel|tally|fillout|paperform`. Emit `{ kind: 'embedded', provider, src, rect, fieldCount: null }`.
- **Same-origin iframe introspection.** Try `iframe.contentDocument` in try/catch; on success, run the existing scan against that document and merge.
- **Unwrapped input clusters.** ≥ 3 inputs sharing a common ancestor that isn't a `<form>` → `kind: 'unwrapped'`.
- **Schema.** Add `kind: 'native' | 'embedded' | 'unwrapped'` to the form entity and update `findings.ts`.

**Flag, don't build:** the actual ceiling on gated demo pages is interaction-based — click the primary CTA via Stagehand `act`, observe the result. The static heuristic above is the approximation. Leave a TODO in `forms.ts` pointing at the interactive path.

**Verify:** the fixture returns ≥ 1 `embedded` entry. HiBob /sv still returns 0 (expected). Commit. Run regression.

---

### Fix 2 third — schedule when snapshots can be re-baselined

**Corrected diagnosis (carried from previous revision).** The two "Play video" rows aren't a double-count: identical selector/w/h/score but `rect.y` differs (5228 vs 5574) — two real buttons in stacked cards collapsing to `button:nth-of-type(1)`.

**Why this fix needs a quiet window:** the `buildSelector` change rewrites *every* selector in the output. If the regression compares full JSON snapshots, the diff becomes noisy (all selectors change at once) and you can't eyeball whether anything else moved. Don't sandwich this between two other fixes.

Two distinct goals — decide before coding:

- **Goal A — "stop one repeated control eating two top-5 slots."** Lever is `groupRepeatedControls` (`audit-helpers.ts:225`): drop the `arr.length >= 3` threshold to `>= 2` for `topVisualWeight` only; keep `>= 3` for the global `repeatedGroups` report.
- **Goal B — addressable selectors.** Walk `buildSelector` up to ~4 ancestors until the path is unique in the document. Needed before Stagehand `act()` can target these. Does **not** remove the duplicate from `topVisualWeight`; it gives the two real entries distinct selectors.

Recommendation: ship both. Goal A removes the visible duplicate; Goal B is prerequisite for interaction. Drop the previous "dedupe on `selector + rect.x + rect.y`" idea — it wouldn't fire and conflates the goals.

**Verify:** re-baseline snapshots in the same commit. Confirm `topVisualWeight` shows only one "Play video" row, and that no two collected elements share a selector across the page.

---

### Fix 3 last — gated on a consumer grep, may be zero work

Footer math holds (37 of 61 elements are footer). But **do the grep first**:

```
rg -n "intentBreakdown" src/
```

- If nothing scores or branches on `intentBreakdown` → the fix is cosmetic. **Skip it.** Tidier numbers, zero finding change.
- If a finding penalizes unclassified action density → implement, with both caveats:
  - **`unknown` also lives in `pageAudit.ctas`** (6 of 15) from a different extractor. Patch both `collect.classifyIntent` and the pageAudit-side classifier, or it's a new drift case.
  - Section-aware fallback: after all `INTENT_RX` tries, if `section ∈ {footer, nav, header}` and the element is a link / `nav_item`, return `navigation`.
  - Modest vocab additions to `INTENT_RX.navigation` en+sv: `press|career|careers|blog|news|integritet|villkor|terms|privacy|cookie|sitemap|kontakt|contact|about|om oss|support|status|partners|legal`.

**Verify:** if implemented, `intentBreakdown.unknown` drops on HiBob /sv; English SaaS regression doesn't shift. If skipped, document the consumer-grep result so this doesn't get re-raised.

---

## Cross-cutting (unchanged)

Fixes 1 and 3 are both symptoms of one architectural debt: `pageAudit` and `collect` are two independent extractors. Renames and fallbacks buy clarity now; reconciliation remains out of scope and the actual fix.

## Out of scope

- Reconciling `collect` vs `pageAudit` extractors.
- Interaction-based form detection via Stagehand `act` (flagged in Fix 4).
- LLM-based intent classification.