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

## Run #3 — with Browserbase render fallback (capture is the real ceiling)

Every prior run's biggest hole was **capture**, not typing (18% never fetched,
19% of successes thin). Run #3 wires the now-proven Stagehand render path
(`capture-test #4`) into the harness as a **shell/thin/fail fallback**: static
fetch first, and when it returns `<3` sections the site is rendered in
Browserbase and re-captured. Render is a fallback only, so content-rich static
sites are untouched (no regression).

**Capture jumped from 82% to 95.5%.**

| | Static-only (runs #1–2) | With render (run #3) |
|---|---|---|
| Captured | 163/199 (82%) | **190/199 (95.5%)** |
| Failed | 36 | **9** |
| Sections | 1,469 | **1,793** (+324) |
| Evidence promotions | 134 | **188** (+54) |

**`===CAPTURE===`:** 70 sites triggered render → 48 beat static → **38 fully
recovered** (shell/fail → ≥3 real sections), 1 render errored. ~5.5 min
wall-clock; render concurrency capped at 3 (no session-limit errors, no hang —
`process.exit(0)` after the aggregate).

**What render recovered** — the SPA/JS-store class static capture is blind to:
`gymshark 0→11`, `sofi 0→27`, `kyliecosmetics 0→22` (8 evidence), `doordash
0→19`, `rei 0→17`, `uber 0→16`, `patreon 0→12` (8 evidence), `ritual 0→7` (4
evidence, a real pricing grid), `chime`, `klarna`, `dropbox`, `sephora 2→9`,
`hims`, `tripadvisor 0→10` (3 evidence), `udemy` (3 evidence). +54 evidence
sections the static-only run never saw — pricing grids, testimonials, logo walls.

**Honest caveats.**
- **Typing precision on recovered content is unchanged (~61%).** Render hands the
  classifier *more* to type; it doesn't make the labels more right. Fresh noise
  from newly-seen content: `airbnb` listing cards typed `testimonials`; `ro.co`
  "3,000,000+ members" typed `testimonials` (should be `stats`); `oura.com`
  resolved to a French transit page (a DNS/geo artifact, not a typing miss). Still
  review-assisted, not unattended.
- **A real bug the run surfaced (now fixed):** the LLM JSON parse threw on a
  ```-fenced Haiku response and silently dropped to floor-only typing on those
  sites — so run #3's typing is a slight *under*-count of what the fixed parser
  now yields. Fixed in `llm-json.ts` (fence/prose-tolerant, +9 tests).

**Bottom line:** capture was the ceiling, and render lifts it hard — 27 net new
sites and +54 evidence sections for ~5 minutes and a bounded credit spend. The
next precision gains are in typing (logos/testimonials-vs-stats), not capture.

## Render fidelity — "how do we know we rendered it correctly?" (2026-07-26)

The recovery metric above only proves **"not a shell"** (≥3 sections). A cookie
wall, bot-challenge, error page, unstyled/broken render, or the **wrong site**
(`oura.com` → a French transit page) can also clear ≥3 headings. So we verified
the 38 recovered sites directly (`scripts/redesign/render-fidelity.ts`): render
each, take an **above-fold screenshot** (uploaded as an artifact), run
deterministic signature checks (bot-challenge / consent-wall / error / wrong-page
via brand-token / unstyled / thin), then **eyeball the screenshots** — because
only the picture confirms "looks like the real page."

**Result (all 38 screenshots reviewed): ~37/38 rendered the real, correct page.**
The lesson worth keeping: **the automated signature check is a weak proxy** — on
the first pass it flagged the wrong site (`kyliecosmetics`, a brand-token false
positive — the page says "Kylie Cosmetics", not the domain label) and *missed*
the one genuinely broken render (`sofi` came back as an unstyled nav list that
run). The screenshot is the source of truth; the signature check only points.

**Two capture gaps the screenshots exposed — fixed in `scripts/redesign/render-page.ts`
(the shared render path used by freeze-page, scale-test, capture-test, fidelity):**
- **Unstyled/broken renders** (`sofi` that pass) — `pageLooksStyled` (CSSOM rule
  count) now flags them; scale-test rejects them, freeze-page refuses to freeze
  them. (The break is transient — `sofi` rendered fine on the re-run — so this is
  a guard, not a constant.)
- **Intrusive modals** (auth / email-capture / cookie / onboarding overlays) —
  `dismissOverlays` presses Escape (a no-op on Stagehand's page, which has no
  `keyboard` — a bug that first took the whole capture down 38/38 until it was
  made throw-proof) and clicks a curated allowlist of safe close controls (cookie
  accept/reject, "no thanks", labeled ×). **Honest limit:** this clears *labeled*
  modals (glossier's email modal ✓) but not *icon-only* auth modals whose close
  is an unlabeled SVG (doordash's sign-in modal remains). Partial, best-effort,
  and it can never fail the capture.

Anti-bot is probabilistic: `hashicorp` served a Vercel "verifying your browser"
checkpoint on one run and the real page on another — expected, and the fidelity
check catches it (as not-faithful) rather than silently trusting it.

## Re-run

GitHub → Actions → **Section scale test** → Run (optional `urls=`). Artifacts:
`scale-test.out` + `scale-test.json` (14-day retention). Render fallback needs
`BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` (else static-only).
