# Contradiction audit — toward one goal model for any conversion site

> Audit of `main` @ `7bb49dd` (2026-07-06). Method: all rule-bearing code was
> inventoried (408 rules/heuristics/thresholds/prompt sentences across the six
> subsystems: audit scripts, findings/scoring, adaptive engine, goal system,
> robustness harness, dashboard/docs), 60 candidate contradictions were
> generated from five independent lenses, and **each candidate was adversarially
> verified against the code** — a claim only survived if both rules exist as
> described AND a single realistic page makes them fire in conflicting
> directions. Result: **24 unique confirmed contradictions** (2 high),
> 14 candidates refuted. Line numbers refer to `7bb49dd`.
>
> **Status:** wave 1 resolves **B6, C2, E1, E2, A4, A5, A6**; wave 2 resolves
> **B1, A1, A3** (shared intent classifier + contact intent + auth pageType);
> wave 3 resolves **A2, B2, B4, B5, B7, B8, B9, C1** and part of **B3**.
> Each is marked ✅ below with what changed. Still open: B3 (section-typing
> half), C3, and the measurement group D1–D4.

## Root cause

The product currently has **four independent vocabularies for "what a
conversion is"**, grown at different times:

| Layer | Vocabulary | Where |
| --- | --- | --- |
| Audit scripts (in-browser) | `INTENT_RX` keyword lists + `cta_primary` heuristics — in **two divergent copies** | `scripts/ctas.ts`, `scripts/collect.ts` |
| Goal system | `GoalKind` (11 kinds, business-type-aware) + labeler intents (9 values) | `crawler-inventory.ts`, `goal-judge.server.ts`, `labeler.server.ts` |
| Runtime engine | `demo \| trial \| sales` (SaaS-only) + SaaS pattern library | `decide.ts`, `patterns.ts` |
| Measurement | two different "conversion rate" definitions + engagement proxies | `aggregate.ts`, `performance.server.ts` |

Almost every finding below is a collision between two of these vocabularies.
The durable fix is not patching each mismatch — it is making the **judged,
owner-confirmed goal the single source of truth that every layer conditions
on** (see [Target architecture](#target-architecture) at the end).

---

## A. The same button both is and isn't "the conversion" (audit vs goal system)

### A1. `tel:`/`mailto:`/contact CTAs are "utility" to the audit but THE goal to the goal system — *medium* — ✅ fixed

- `src/lib/tests/scripts/collect.ts:259` forces `tel:`/`mailto:` to
  `intent='utility'` **before** any keyword check, and the utility wordlist
  (`:247`) contains `contact|kontakt`. `ctas.ts:10` does the same.
- `src/adaptive/crawler-inventory.ts:576` classifies `tel:` as goal kind
  `lead` and `mailto:` as `contact`; `KIND_TEXT:547` and `GOAL_RX:437` treat
  contact/quote as goals; the judge prompt says *"comparison/leadgen → … a
  callback lead form"*.

**Scenario:** a Swedish clinic/law-firm site whose hero button is
`<a href="tel:…">Ring och boka</a>`. The findings panel reports
**"Primary-conversion CTAs: 0"** and counts the button in *Competing CTAs
above fold*, while the goal judge proposes that same button as the #1 goal,
the owner confirms it, and the engine measures clicks on it. One layer says
the conversion path is absent; the other says it's the whole point of the site.

**Fixed:** the shared classifier tests conversion keywords BEFORE the
`tel:`/`mailto:` short-circuit ("Ring och boka" is a conversion), and
contact actions get the new first-class `contact` intent in `schema.ts` —
never `utility`. Applies to both scripts via the shared source (B1).

### A2. Every form-submit is unconditionally "conversion" — *medium* — ✅ fixed

`collect.ts:256-257` returns `conversion` for any `type=submit` button before
keyword checks, so a newsletter "Skicka" or a search submit counts as a
conversion CTA — while the goal judge (`goal-judge.server.ts:58`) defines the
goal as *"the primary money/value action for THIS business"*. In the no-LLM
path, `rankGoalCandidates` scores a hero newsletter submit above a below-fold
"Köp" button. **Fixed:** `formKindShared` inspects the submit's form in BOTH scripts
(search form → `utility`, email-only field → `engagement`, else conversion),
and the harvest stamps `inForm` so `classifyGoalKind` types in-form submits
as `lead` in the no-LLM ranker — a hero newsletter form can no longer
masquerade as the signup goal.

### A3. Login pages are "conversion pages" — *medium* — ✅ fixed

`context.ts:146` (`CONVERSION_PATH_RX`) includes `log[-_]?in|logga[-_]?in`, so
`/login` classifies as `pageType='conversion'` — "the visitor is already AT
the goal" — and `decide.ts:184/203/218` suppresses `emphasize_goal`,
`sticky_goal_cta` and `show_secondary_cta` there. But the product's own role
taxonomy (`crawler-inventory.ts:156-159`, labeler prompt) states auth is
**never** a conversion. A first-time mobile visitor landing on `/logga-in` is
exactly the visitor the sticky goal shortcut exists for, and gets nothing.
**Fixed:** auth paths moved out of `CONVERSION_PATH_RX` into a new
`pageType='auth'` (goal decoration stays ACTIVE there); ROLE_RULES' auth
href gained the Swedish `logga-in|inloggning` paths; and a drift-guard test
pins the canonical login paths both taxonomy sides must agree on.

### A4. The judge is told "nonprofit → donate" but no `donate` kind exists — *low*

`goal-judge.server.ts:60` instructs the model *"nonprofit → donate"*; the kind
enum (`:65`, `GOAL_KINDS`) has no `donate`. A `kind:"donate"` reply fails
validation at `:215` and is silently re-labelled via `classifyGoalKind` as
`start_flow`/`signup`. **Fixed:** `donate` added to `GoalKind`/`GOAL_KINDS`, `KIND_TEXT`, `KIND_HREF`
and the judge prompt enum; `JUDGE_VERSION` bumped to `g2` so cached judgments
re-run.

### A5. The runtime engine ignores the judged goal kind entirely — *medium*

`decide.ts:140-143` maps every visitor to intent `demo` or `trial` — a pure
SaaS assumption — and `confirmGoal` (`dashboard.functions.ts:442`) **discards
the candidate's `kind`** when the owner confirms. A confirmed `contact`-kind
goal on a lead-gen site means `clarify_cta` hunts for demo/trial labels that
don't exist, forever. The baseline rule shows a "2 minute setup" badge to
every site type. **Fixed:** new `angel_sites.conversion_kind` column (migration
`20260706150000`); `confirmGoal` persists the candidate's kind (a raw owner
override clears it); `SiteGoal.kind` flows through `/api/adaptive/decide`;
`clarify_cta` walks a goal-kind-derived preference chain (`contact|lead|quote
→ sales` first) and the kind is part of `decisionIdFor`.

### A6. `classifyCtaIntent` produces a `sales` intent the engine can never request — *medium*

`crawler-inventory.ts:226-233` stamps CTAs `demo|trial|sales`, but
`decide.ts:140` only ever asks for `demo` or `trial` — `sales`-labelled
variants are dead inventory, and `pickItem`'s first-item fallback plus the
`otherLabel` guard means `clarify_cta` silently never fires on sales-led
sites. **Fixed:** with A5's preference chain every published variant (incl.
`sales`) is reachable, and the arbitrary `pickItem` first-item fallback is
gone — strict intent match only, so the reason string cannot misreport.

---

## B. Duplicated definitions that drifted (audit-internal)

### B1. Two copies of the conversion-keyword classifier drifted — *medium* — ✅ fixed

`collect.ts:243` has `gå med|gratis|ladda ner|lägg i (varu)?kund?korg|lägg
till|bidra` that `ctas.ts:8` lacks; the two `classifyIntent` functions also
differ in rule ORDER (form-submit and `tel:` rules exist only in collect).
Bonus bug found during verification: the drifted regex has a typo —
`lägg i (varu)?kund?korg` matches "lägg i kundkorg" but **never the common
"lägg i varukorg"** (intended `(varu|kund)korg`). The same button is a
conversion CTA in one half of the report and not in the other.
**Fixed:** one shared `classifyIntentShared` (src/lib/tests/scripts/shared/
intent.ts) is inlined into BOTH script template strings via `toString()` —
neither script defines its own wordlists anymore, and an inline-parity test
asserts the exact shared source appears in both. (The `varukorg(en)` typo
fix + harvest vocabulary landed in the previous wave.)

### B2. `cta_primary` requires above-fold in `ctas.ts` but not in `collect.ts` — *medium* — ✅ fixed

`ctas.ts:123-131` scores 4 signals and requires **4/4** (above-fold is
mandatory → a below-fold buy button can never be primary). `collect.ts:222-231`
adds a 5th signal (`!inChrome`) and requires 4/5 (below-fold primary
possible). Same page → "primary-script 0" and "Primary-conversion CTAs: 1"
in the same findings card; `deriveHero` finds no hero CTA. **Fixed:** `classifyCategoryShared` (shared/category.ts) is the one
5-signal rule, inlined into both scripts — a prominent below-fold buy button
can be primary in both now, and chrome links are `nav_item` everywhere.

### B3. "Hero" has four different boundaries — *medium* — ⚠️ partially fixed

`sections.ts:106` = first **0.4** viewports; `collect.ts` ≈ 1.0–1.2;
`ctas.ts:72` and `visualHierarchy.ts:102` = **1.1**. With a tall announcement
bar the LLM context simultaneously asserts a hero exists (`cro.hero`,
hero-role CTAs) and shows a section flow with no hero. **Partially fixed:** the three ELEMENT-level scripts interpolate one shared
`HERO_MAX_VIEWPORTS` (1.1) — the 1.0/1.1/1.2 spread is gone. Still open:
sections.ts's 0.4-viewport section-typing rule is deliberately different
(documented at the constant); reconciling element labels against typed
sections server-side remains future work.

### B4. CTA trust-proximity uses its own crude trust detector — *medium* — ✅ fixed

`ctas.ts:184-191` measures `nearestTrustSignalDistance` from class-name
guesses (`[class*="testimonial"]`, `[class*="star"]`, `blockquote`…), not from
`trustSignals.ts`'s output. Same report: "Trust signals: 1 above fold" and
"trust 9999px" for the CTA next to it — and the reverse (class-name hits that
the trust engine rightly rejects). The `9999` sentinel also reads as a real
distance downstream. **Fixed:** the in-script class-name heuristic is deleted;
`computeTrustProximity` (audit-helpers) fills the distance server-side from
the trust engine's canonical rects, and pages without positioned trust
signals get `null` — never a 9999 sentinel.

### B5. `wcagLevel` means two different measurements — *medium* — ✅ fixed

`ctas.ts:226` = real text-vs-own-background contrast (correct WCAG semantics);
`visualHierarchy.ts:143/187` = element-surface-vs-page-background salience,
emitted under the same field name and shared `WcagLevel` type. A white button
with dark text on a white page is simultaneously `AAA` and `FAIL` in the same
`PageAuditData`. **Fixed:** the hierarchy metric is renamed `bgSeparation` and its fake WCAG
level is gone — `wcagLevel` now means text contrast (CTAEntity) and nothing
else.

### B6. JSON-LD review signals silently delete every visible review widget — **high**

`trustSignals.ts:763` anchors schema.org `AggregateRating` entries to
`document.body`; `hierarchyDedup` (`:878-916`) keeps the shallowest anchor per
type and `body.contains(x)` is true for everything — so on any page with
JSON-LD ratings (standard on Shopify/e-commerce), **all visible
review_rating signals (Trustpilot/G2 widgets, "4.7 av 5" text) are dropped**
from findings, `trustSummary`, the inventory and the goal judge's `trust`
hint. **Fix:** give document-level schema entries `_block = null` (dedup
already skips those), mark them `section='document'`, `aboveFold=false`.

### B7. `findings.ts` sums review counts over a type that can never exist — *medium* — ✅ fixed

`trustSignals.ts:945-963` collapses all `stars` entries into one
`stars_aggregate` before returning — and drops `reviewCount` in the collapse —
while `findings.ts:205-207` computes total review count over
`review_rating || stars`. The "Total review count" finding silently
undercounts/vanishes. **Fixed:** the stars collapse carries `reviewCount` (max, not sum) onto
`stars_aggregate`, and findings sums over `review_rating || stars_aggregate`
— the dead `stars` arm is gone.

### B8. The audit's own ideal page can never score "Competing CTAs: 0" — *medium* — ✅ fixed

`engine.server.ts:350-357` counts **every** above-fold non-navigation CTA as
"competing" — including the primary itself — while the per-CTA
`competingActions` (`ctas.ts:217-223`) excludes self. A textbook single-CTA
landing page shows "Competing CTAs above fold: 1" next to "competing 0" for
the same button. **Fixed:** `competingAboveFold` reserves one slot for the primary — the
ideal single-CTA page reads 0, matching the per-CTA self-exclusion; the raw
pool is exposed as `conversionCtasAboveFold`.

### B9. `ctasScriptPrimaryCount` documented as NOT intent-gated, computed intent-gated — *medium* — ✅ fixed

`schema.ts:294` documents the count as category-only ("not intent-grided");
`audit-helpers.ts:135-137` filters `category === 'cta_primary' &&
intent === 'conversion'`. A primary-styled "Logga in" is listed as a primary
CTA in the rows but excluded from the count above them. **Fixed:** `buildPageSummary` counts category-only, exactly as the schema
documents; the intent-gated number lives solely in
`CollectSummary.primaryConversionCtaCount`.

---

## C. The runtime engine violates the audit's own doctrine

### C1. Angel injects a competing CTA that Angel's own audit then flags — *medium* — ✅ fixed

The audit penalizes *"Competing CTAs above fold"* (`findings.ts:66`), while
`cold_soft_path` (`decide.ts:104,215`) injects a secondary CTA beside the goal
for every first-time visitor — and **no collector excludes Angel's own
injected elements**, although every injected node carries
`data-angel-injected`. An audit crawl of a snippet-installed site can count
Angel's own pill/badge/link as page CTAs, polluting the inventory and even the
goal-judge input on re-harvest. **Fixed:** both collectors skip anything inside `[data-angel-injected]` /
Angel's own class names (mirrors the cookie-root exclusion) — the audit
never counts Angel's injections as the page's own content.

### C2. The robustness gate hard-fails covered clickables; the flagship mobile pattern covers clickables — and the harness structurally can't see it — **high**

`analyze.ts:217-221` hard-fails when any interactive element's centre becomes
covered (`elementFromPoint` hit-test). `sticky_goal_cta` renders a
`position:fixed` bottom-centre pill at z-index 2147482000
(`public/adaptive.js:322`) that covers whatever sits in that band (cookie-bar
accept buttons, bottom sticky navs) whenever the goal is off-screen. The
robustness runner calls `decide()` **without a goal**
(`runner.server.ts:434`), so all three goal patterns resolve to `null` and the
launch gate has never actually tested the pattern most likely to trip it.
**Fix:** thread a goal into the harness (deterministic
`rankGoalCandidates` floor, or the stored confirmed goal), and teach the
snippet to nudge the pill when it would cover an interactive element.

### C3. The harness warns about behavior the engine documents as correct — *medium*

`analyze.ts:227` warns *"no adaptations decided (empty inventory?)"* — but
`decide()` returns zero **by design** on conversion pages and honest-gated
thin inventories (`decide.ts:183-341`). Sweeps produce warn-noise on exactly
the pages where the engine behaves best, training people to ignore warnings.
**Fix:** emit structured decline reasons from `resolve()`
(`no_goal_configured | conversion_page | no_inventory_for_slot | …`) and let
`analyze()` distinguish "declined by design" from "empty inventory".

---

## D. Measurement disagrees with itself

### D1. Two incompatible numbers are both called "conversion rate" — *medium*

Overview headline: `conversions / pageviews` (event-based,
`aggregate.ts:556`); "What's working" arms: distinct converted visitors /
distinct exposed visitors (`aggregate.ts:246-343`). Same site, same day: 1.2%
vs 6.8% with no denominator hint in the UI — and double-firing
`convert()` inflates only one of them. **Fix:** make the headline
per-visitor (both sets already exist in `aggregate()`), keep raw event KPIs
as secondary numbers.

### D2. The engagement proxy is anti-correlated with fast conversion — *medium*

`microScore` (`performance.server.ts:53-55`) rewards deep scroll, multi-page
and return visits. A pattern that converts visitors **immediately** (the
point of the product) depresses all three — converted visitors stop scrolling,
browsing and returning — so on low-volume sites the winning pattern collects a
negative nudge while a pattern that merely makes people wander collects a
positive one. **Fix:** hierarchical score — conversion is the terminal
signal; engagement only scores the non-converted remainder
(`score = convRate + (1 − convRate) · engagement(non-converters)`).

### D3. The "never suppressing" micro nudge suppresses the baseline pattern — *medium*

`performance.server.ts:42-44` documents micro nudges as *"capped far below a
proven win and never suppressing"*, but `MICRO_MAX_NUDGE = 10` exactly equals
the `baseline` rule's priority 10 (`decide.ts:132-136`), and the
`priority > 0` filter (`decide.ts:393`) drops the pattern at 0 — full
site-wide suppression from a sub-significance engagement gap. **Fix:** floor
non-sentinel deltas at effective priority 1; only `PERF_SUPPRESS` may kill.

### D4. The rollup is per pattern only, not per pattern × segment — *medium*

`docs/attribution-rollup.md:29-40` specifies attribution *"per (site, path,
segment, pattern, variant)"*; `attribute()` keys on pattern only. A pattern
that wins on LinkedIn and loses on paid gets one blended verdict — possibly
`PERF_SUPPRESS`-killed site-wide including the segment where it wins,
directly against the doc's stated purpose. **Fix:** add a segment key inside
`attribute()` (payloads already carry `trafficSource`/device/path), emit
overall + per-segment rows, make `PatternBoost` segment-aware.

---

## E. Policy vs code

### E1. Consent: docs mandate opt-in/anonymous default; code defaults to full collection — **high**

`docs/consent-gate.md` (*"never assume consent → always anonymous"*, GDPR
default must be opt-in; also note the doc's `tcf | site_signal |
anonymous_default` modes were never built) vs `createSite`
(`dashboard.functions.ts:588-597`) inserting `consent_mode='attested'` for
every new site → `adaptive.js:980` immediately writes a persistent visitor id
and sends `visitorHash` events, even when the page has a CMP the visitor
hasn't answered (or has **rejected** — downgrade is unimplemented). GPC/DNT
are honoured; CMP state is not. **Fix:** either stop overriding the DB's
`'anonymous'` default at create, or make attestation a *baseline* that still
defers to a detected CMP signal; align the doc with whichever policy is
chosen. Legal exposure — decide deliberately.

### E2. Holdout: documented "default 0, opt-in per site"; code auto-sets 12% — *medium*

`docs/attribution-rollup.md:25` + migration comment vs
`DEFAULT_HOLDOUT_PCT = 12` applied at `createSite` and on attestation
(`dashboard.functions.ts:81,380-388`). ~12% of visitors get no adaptations
from day one on every new site, and the attestation bump (`holdout_pct=0` →
12) conflates "owner chose off" with "untouched". **Fix:** update the doc to
the shipped policy; distinguish explicit-0 from unset (nullable column or
`holdout_set_by_owner` flag).

---

## Verified non-findings

For completeness, the loudest *rejected* candidates (checked and found not to
be real conflicts): `pickGoalCta`'s signup-first ordering is legacy off the
live proposal path (the judge + `rankGoalCandidates` govern; `KIND_TEXT` is
already purchase-first); `shorten_hero` hides only `[data-angel-secondary]`
markers, which the interaction probe handles; `performanceProxy` in
`llmContext` is provenance-only exposure, not a score input; the judge's
4-goal cap vs the dashboard's 6-candidate cap are different lists by design.

---

## Target architecture

The pattern behind all 24 findings: **each layer invented its own goal
model.** To "find improvements on any site where conversion-to-something is
the goal", invert the dependency — the goal is judged once, confirmed once,
and every rule downstream is *conditioned on it*:

```
harvest → goal judge (businessType + ranked GoalKind candidates)
        → owner confirms ONE goal (selector + text + KIND persisted)
        → everything below reads (businessType, goalKind):
            • audit rules   — goal-conditioned rule packs
            • findings/LLM  — framed relative to THE goal
            • pattern library — eligibility per goalKind
            • measurement   — one conversion definition, goal clicks/URL
```

Concrete steps, in dependency order:

1. **One vocabulary.** `GoalKind` (+ `donate`) becomes the only intent enum.
   Map the labeler's intents onto it (`newsletter → subscribe`), delete
   `demo|trial|sales` (A5/A6), split `contact` out of `utility` (A1), make
   form-submit intent form-content-aware (A2), add `pageType='auth'` (A3).
2. **One implementation per concept.** Shared source for `INTENT_RX`,
   CTA-category scoring, hero boundary, and WCAG math, interpolated into the
   browser-script strings (B1-B3, B5). Cross-scores (trust proximity) computed
   server-side from each engine's canonical output, never re-detected (B4).
3. **Persist the goal kind.** `conversion_kind` column; `SiteGoal.kind`;
   `decide()` and the harness receive it (A5, C2).
4. **Goal-conditioned rule packs.** Every audit heuristic and every pattern
   declares `appliesTo: { businessTypes?, goalKinds? }`. "No credit card
   required" applies to `trial|signup`; "2 minute setup" to SaaS; urgency
   patterns to `purchase|booking`. A rule that doesn't declare relevance for
   the site's judged kind doesn't fire — instead of firing wrongly.
5. **Findings framed relative to the goal.** Replace absolute doctrine
   ("Primary-conversion CTAs: 0") with goal-relative statements ("Your
   confirmed goal is *Ring och boka*; 3 above-fold elements compete with it").
   This is what makes the report correct for a comparison portal, a nonprofit
   and a webshop at once.
6. **A contradiction linter in CI.** With rules in one registry carrying
   `{observable, direction, appliesTo}`, add a test that fails when two rules
   reward and penalize the same observable for the same goal kind — the class
   of bug this audit found by hand becomes a failing test.
7. **One measurement definition.** Per-visitor conversion rate everywhere
   (D1); engagement subordinate to conversion (D2); only significance may
   suppress (D3); verdicts per segment (D4).

Suggested fix order: **B6, C2, E1 first** (high severity: silently deleted
trust signals, an untested launch-gate pattern, and a consent default with
legal exposure), then the taxonomy unification (step 1) which collapses most
of section A, then B (shared classifiers), then C/D.
