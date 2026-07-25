# Section pipeline — 200-site scale test + adversarial verification (2026-07-25)

Full pipeline (floor → LLM ceiling → group → rank) run over **199 real sites** in
CI (`Section scale test` workflow), then a **36-promotion sample independently
audited** by 5 skeptical verifiers (`scripts/redesign/scale-test.ts` +
`verify-wf.js`). This is the honest scale read — headline metrics *and* verified
precision, not cherry-picked wins.

## Run

199 attempted / **163 captured** / 36 failed. 1,469 sections → **443 promotions**
(30%), of which **134 are evidence-type**; 811 sections stayed generic on the
deterministic floor. avg confidence 0.85. ~77s wall-clock (pool of 8).

## Verified precision (audited sample, n=36)

**22/36 correct = 61%** (95% CI ≈ 45–75%).

| Evidence type | Correct | Precision | Audited / population |
|---|---|---|---|
| Stats | 8/11 | 73% | 11/41 |
| Testimonials | 5/8 | 63% | 8/53 |
| Logos | 7/12 | 58% | 12/27 |
| Pricing | 2/5 | 40% | 5/12 |

**avg confidence 0.85 vs measured precision 0.61 → the score is overconfident by
~24 points and cannot be used as a self-gate.** The one guardrail that holds is
the floor: 811 sections stayed generic, so every false positive is contained to
the 443 promotions, never the whole page.

## Confirmed false positives (14/36) — systematic, not random

| Host | Claimed → shouldBe | Why |
|---|---|---|
| coinbase / hulu / salesforce | pricing → features | No price/tier anywhere |
| plaid / rust-lang | stats → features/section | No hard number ("hundreds") |
| twilio | stats → logos | A Gartner badge, zero numbers |
| asana / clickup | logos → section | Gartner/G2 award badges, not a customer wall |
| headspace | logos → stats | Org proof-count, no logo wall in excerpt |
| ro.co | logos → section | A single person's bio |
| shopify | logos → section | Merchant archetype labels, not company names |
| gitlab / gumroad | testimonials → stats | Metrics/$ figure dominate; quote secondary |
| ikea | testimonials → section | Editorial about IKEA's own designers |

**Patterns.** Reliable: stats with a literal big number (Stripe $1.9T, Docker 91%
of Fortune 100, Wise 14.8M), named-customer quotes (monday, atlassian), 3+ real
company names → logos (github, okta, coursera). Risky: pricing with no price;
award/analyst badges (no taxonomy class); quote+number mixtures; non-company
content as logos; proof-flavored prose as stats.

## Three-lens read

- **Skeptic:** ~2 of 5 evidence promotions wrong on the highest-value subset;
  confidence unusable as a threshold. n is thin (pricing n=5).
- **CRO:** when right it surfaces the money assets; most errors are taxonomy
  slips of *real* proof (badges, stats-as-testimonials) — still useful to a
  strategist. The only harmful class is price-less "pricing" (invents a section).
- **Engineer:** capture is the biggest hole — 18% never fetched (bot/403), 19%
  of successes thin → only 66% got a full-quality pass. Some "errors" (twilio,
  headspace) are partial-capture artifacts, so better capture buys precision for
  free. The plumbing scales cleanly; the weak links are inputs and labels.

## Bottom line

**Not ready to run unattended on customer sites; ready as a review-assisted pass.**
Errors are systematic (cheap to fix) and the floor contains the blast radius.

## Fix applied (this commit)

**#1 fix from the report — a deterministic ceiling-check: the LLM proposes, a
token-presence check disposes.** In `refineSectionTypesLlm`, an evidence label is
only accepted if its defining signal is physically present: no price token → never
`pricing`; no digit → never `stats`. This kills 6 of the 14 FPs (coinbase, hulu,
salesforce, plaid, rust-lang, twilio) and lifts the sample from 22/36 to ~28/36
(**~78%**) with no real hit dropped. Mirrors the system's own design — a
deterministic floor now has a deterministic ceiling-check. Tested against the exact
FP shapes (`section-llm.test.ts`).

## Next (not yet done)

1. **Recognition/badge class** — Gartner/G2 award strips need their own type
   (fixes asana/clickup/twilio); the model currently forces them into logos/stats.
2. **Capture coverage** — the 18% fetch failure is the real ceiling on scale
   (Browserbase render + anti-bot); no typing change beats capturing the page.
3. **Logos guard** — require ≥2 distinct company-like names, not bios/archetypes.

## Run #2 + re-verification (after recognition class + gates)

Shipped the recognition class, tightened logos/stats prompt, and routed the scale
harness through the shared gate; re-ran 199 sites and **re-audited a focused
adversarial set** (old FPs' new status + logos-leak suspects + controls — NOT a
random sample, so 35% here is diagnostic, not comparable to the 61% baseline).

**What the re-audit proved:**
- **recognition class = clean win** (5/6; controls github/stripe/hims/monday 4/4,
  zero regression on true positives). Gartner/G2 badges now type correctly.
- **the stats gate I shipped was porous** — `/\d/` passes on incidental digits
  (CSS `24px`, a year, `24/7`), so `cloudflare` "Region: Earth" (zero real
  numbers) sailed through. **Fixed:** stats now requires a *proof-shaped* number
  (`%`, currency, K/M/B/million, `3.9x`, `12,000`, `N+`, `N in N`).
- **logos is the top residual leak** (1/8) and had no gate. It over-fires on
  community-size (`reactjs` "two million developers"), content catalogs (`spotify`
  artists), archetypes (`shopify`), bare org-counts (`headspace`), and heading-only
  copy whose logo wall is *images not in the text* (`figma`, `tailwindcss`).
  **Partial fix:** a safe anti-gate demotes community-size-of-people from logos;
  the rest (catalogs, archetypes, image-only walls) need a brand list or better
  capture — genuinely hard for a regex or a 600-char text excerpt.
- **excerpt/capture is the real ceiling.** Several "errors" are capture artifacts:
  `databricks` awards bled in from an *adjacent* section (segmentation), `figma`/
  `tailwindcss` logo walls are images absent from the text. The classifier can
  only be as right as the slice it's handed.

**Honest verdict:** recognition + the proof-number stats gate are real precision
gains; logos/testimonials remain leaky and are **not** one-commit fixes — they're
semantic (customer-logo-wall vs content-catalog; quote vs feature-copy) and
capture-limited. The highest-leverage next investment is **capture + fuller
section context to the LLM**, not more regex gates. Ceiling stays review-assisted.

## Re-run

GitHub → Actions → **Section scale test** → Run (optional `urls=`). Artifacts:
`scale-test.out` + `scale-test.json` (14-day retention).
