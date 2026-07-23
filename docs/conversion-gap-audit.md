# Conversion-fundamentals gap audit — the real gap between demo and product

**Date:** 2026-07-22 · Four grounded, code-cited investigations across the whole loop
(perception · adaptation vocabulary · mobile+a11y · measurement+serving). Every claim
below traces to code. Ranked by business impact, not by ease.

---

## The meta-finding — decide this before building anything

**There are two engines, they are diverging, and the recent work went into the one
customers don't run.**

- **Customers run** `public/adaptive.js` — `VERSION "0.1.0"`. Serves `move_up` / `set_text`
  / `insert_snippet` from `/api/adaptive/decide`.
- **We've been improving** `src/adaptive-lab/` — `VERSION "0.16.0"`. Read only by scripts;
  **no customer ever loads it.** The last several commits (v0.14–v0.16: section typing,
  proof→section linking, broadened reorder, trust-bar stand-down) are all here.

They are **not** subsets of each other — each has what the other lacks:

| | Lab (`adaptive-lab`, v0.16) | Customer (`adaptive.js`, v0.1) |
|---|---|---|
| reorder | CSS `order`, full self-check, rollback-on-drift | **DOM `insertBefore`, no self-check** |
| trust at CTA | ✗ (top bar only) | ✓ `inject_badge` near goal ("no credit card", rating-near-goal) |
| secondary-CTA surfacing | ✗ | ✓ `inject_secondary` |
| goal model | ✗ (picks "a" CTA) | ✓ `classifyGoalKind` + LLM `judgeSiteGoals` |
| device awareness | ✗ | ✓ `classifyDevice` + `mobile_simplify` |
| proof→section linking, structural typing, stand-down | ✓ (new) | ✗ |

So the customer runs the engine with the **riskier** reorder and **none** of this
session's safety gains — while the safe reorder + typing sit in a bundle customers never
load. **Nothing else in this report can be sequenced until the go-forward engine is
chosen and the two converge.**

---

## Tier 1 — where the product can be *false* or create liability

**1. Measurement can declare a false winner.** The whole metric catalog
(`metrics.ts:35-44`) is `conversion / form_submit / cta_click / pricing_view / engaged /
deep_scroll / return_visit / bounce` — **no revenue, no paying-customer, no lead-quality
metric anywhere.** A variant that lifts signups but pulls worse leads passes every
guardrail (guardrails only test bounce/engaged) and is surfaced as `recommend_winner`
(`winner.ts:168`). And for a real SMB (~200 visits/mo) significance on the actual goal is
**decades** away, so the live dashboard promotes a **page-2 engagement proxy** to
"winner" — while `estimateVerdictTime` (which would say "this goal is 40 years away at
your traffic") exists but is **never surfaced in the live dashboard**. For a product whose
pitch is *honest measurement*, this is the sharpest edge.

> **✅ FIXED (2026-07-23, the closable part):** the live dashboard's recommendation now
> runs `evaluateWinnerWithGuards` — bounce/engagement guards built from the real arms
> (previously `evaluateWinner(…, [])`: the guard machinery existed but was never fed),
> and under the continuation proxy the GOAL itself is a guard: a proxy win over a
> significantly sinking goal is **withdrawn**, and a proxy win with an unproven goal
> carries an explicit caveat. `serving→winner` is now **gated server-side**
> (`promotionBlockReason`): promotion is refused on demonstrated harm (contract
> guardrail breach / primary loss / recommend_stop) because promotion freezes the A/B
> and makes live harm unmeasurable. `estimateVerdictTime` is now surfaced per variant
> ("verdict needs ~N/arm, ≈D days at current traffic") whenever data is insufficient.
> **Still open (needs new collection):** a real revenue/lead-quality metric — the
> catalog has nothing money-shaped to guard with; that requires a value channel through
> the snippet + events + arms RPC and is its own project.

**2. Accessibility → legal exposure.** `reorder_proof_first` — the flagship pattern —
moves proof **visually via CSS `order` but never touches the DOM** (`patterns.ts:370-377`),
so screen-reader and keyboard users get the **original** order and a scrambled focus path:
a **WCAG Level A** violation (2.4.3). Injected bars have no `role="status"`/`aria-live`
(Level AA, 4.1.3); the CTA animation has no `prefers-reduced-motion` guard; "contrast
guarantee" is asserted, never computed. Angel is a **third-party snippet injected into the
customer's page** — it can downgrade an AA-conformant customer below ADA / EN 301 549
(European Accessibility Act, in force 2025). Their liability, our defect.

**3. Mobile is validated only at desktop.** Every lab harness photographs at 1200/1280px
(`fleet-shots/run.ts`, sweeps, E2E); there is **no viewport gate** in `adaptive.ts` and
**zero mobile branch** in `src/adaptive-lab`. Yet the repo **already has a 390×844 mobile
standard** the customer engine + audit tools use — the lab is the outlier. Because
above-fold and every presentability gate are viewport-relative, mobile fires **different
patterns, unseen**: bars wrap to 2–3 lines (~10% of the mobile fold), the longest/best
numeric claims cross the `>90px` refusal and **silently don't fire**, and `scale(1.04)`
can overflow a full-width mobile CTA into horizontal jiggle. Most traffic is the viewport
we've never looked at.

> **✅ FIXED (2026-07-23, on the go-forward engine):** after ADR-001 retired the lab the
> situation had *inverted* — the customer verify chain gated only at mobile 390×844 while
> coarse segments (no device dimension) serve every device, so **desktop** was the
> unverified viewport. Verification is now segment-aware (`viewportsForSegmentKey`):
> a device-pinned segment gates at its own viewport; a coarse/tablet/unknown segment
> gates at BOTH extremes (mobile 390×844 + desktop 1280×900). The canonical viewport
> runs the retry ladder + owner screenshots; every additional viewport runs a
> confirmation pass on **exactly the ops that will serve** (no separate retry — one op
> list serves the whole segment) and any failure holds the variant. Evidence records
> the coverage (`viewportsChecked`, `viewportConfirmations`) plus a desktop
> before/after screenshot pair, uploaded by the nightly loop and exposed through the
> dashboard's comparison data. The lab-harness photography (fleet-shots at 1280) is a
> research concern and stays as-is.

---

## Tier 2 — cheap, high-value: signals we already detect, then throw away

**4. Form friction — detected in full, discarded.** `formsRun` computes `fieldCount`,
`requiredFields`, `socialProviders` (google/apple/…), `socialLogin`, `containsCreditCard`,
per-field detail — then the inventory assembler collapses it to `{count, hasSignup}`
(`inventory.ts:368`) and the customer inventory reads no forms at all. The single
highest-ROI CRO lever (the form is the conversion moment) is computed and dropped.
*Fix:* widen the assembler + a `surface_sso` badge (reveal an existing provider button —
never hide fields). Effort **S–M**.

**5. Trust at the point of decision + distraction removal — missing from the lab.** The
customer engine already ships `inject_badge` next to the goal and `inject_secondary`; the
lab's only trust is a top bar the visitor scrolled past, and it emphasizes the primary CTA
but never **dims the competing ones** (all CTAs are already classified by intent — the
"others" set is free). *Fix:* `cta_reassurance` + `dim_secondary_ctas`. Effort **S–M**.

**6. Diagnostics captured then dropped.** Page-speed/CLS/LCP proxies (`missingDims`,
`lazy`, `eagerImagesAboveFold`, `largestImagePx`), goal **confidence** (computed, never
shown in the picker — a coin-flip and a checkout button look identical to the owner), and
value-prop **clarity** (hero located, never judged) — all detectable or already computed,
none surfaced as owner-facing advice. LCP/CLS alone are among the most universal
conversion fixes. *Fix:* surface as owner issues. Effort **S** each.

---

## Tier 3 — measurement rigor (real, second-order)

**7. Novelty / regression to the mean — zero handling.** No novelty correction, no
cool-down, no re-measurement. Worse, once a variant wins it serves at **100%, control
stops filling, and the reading freezes** (`serve.ts:186-209`) — a honeymoon-inflated lift
is locked in and never revisited. Plus the verdict recomputes every night + every
dashboard load against a fixed-horizon alpha (peeking).

**8. Production winner computed with no guardrails attached.** `evaluateWinner(..., [], …)`
is called with an **empty** secondaries array (`dashboard.functions.ts:431`); the guardrail
ruling is a *separate* object. Two verdicts on the same data can silently disagree —
"winner" vs "guardrail breach" — reconciled only by the UI. The hierarchy's core rule ("a
guardrail breach overrides a primary win") is bypassed in the exact surface the owner reads.

---

## What's genuinely strong (leave alone)

- **Consent / privacy** — anonymous-by-default, no storage/events without a positive
  signal, GPC/DNT as hard opt-outs, no back-fill on late grant, CMP no-touch zones. A real
  strength, not a gap.
- **The detection layer is rich.** Almost every gap above is *mapping/acting*, not seeing —
  most Tier-2 fixes are "reclaim what we already detect," which is why they're cheap.

---

## Recommended sequence

0. **Decide the go-forward engine and converge the two** — everything else depends on it.
1. **Honesty + liability** (protect the promise): a mandatory revenue/quality guardrail
   before any proxy can be a "winner"; surface `estimateVerdictTime` in the live dashboard;
   fix `reorder` to a real DOM move (or retire it); add a 390×844 validation pass.
2. **Cheap conversion wins**: form-friction → `surface_sso`, `cta_reassurance` at the CTA,
   `dim_secondary_ctas`.
3. **Measurement rigor**: novelty/hold-out re-measure; attach guardrails to the winner call.

*Honest note:* this session's section-typing + reorder-broadening live in the lab engine,
so their payoff hinges on step 0 — and the reorder we broadened carries the Tier-1 a11y
issue. Auditing before building more was the right call.
