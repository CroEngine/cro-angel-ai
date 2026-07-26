# Section-typer — broad live report (2026-07-24)

The LLM section-typer (the "ceiling" above the deterministic typing floor) run
live across a diverse cross-section of the web, analysed from several angles.
Reproduce with the **Section-typer report** GitHub Action (`workflow_dispatch`,
optional `urls=`) or `scripts/redesign/section-typer-report.ts`.

**Method.** Per site: static-fetch the homepage → deterministic floor
(`extractContentModel`: heading vocab + structural cues) → every section the
floor left generic (`section`/`content`/`features`) goes to the real Haiku
ceiling with its body excerpt (`<img alt>` surfaced) → a promotion is applied
only if confidence ≥ 0.70, the type is promotable, and it differs from the floor.
The ceiling **only promotes generics — it never demotes** a floor-assigned type.

---

## Headline numbers

| | |
|---|---|
| Sites fetched | **27 / 29** (2 rate-limited: allbirds, glossier → HTTP 429) |
| Sections seen | **419** |
| Left generic by the floor | **327** (78% — the floor is deliberately conservative) |
| Ceiling promotions | **78** |
| …to **evidence** types (lift targets) | **30** — stats 13, testimonials 11, pricing 3, logos 3 |
| …to non-evidence (brief-only) | 48 — features 30, cta 14, integrations 3, video 1 |
| Avg confidence (promoted) | **0.85** |
| Run time / cost | ~52 s, ~1 Haiku call/site — cents |

---

## Perspective 1 — The skeptic (precision)

Manual inspection of all 78 promotions: **~29 of 30 evidence promotions are
correct (~97%)**. The lone soft call is casper *"Discover the Casper difference"*
→ stats @0.75 (it's a value-prop, not a number). The 48 non-evidence promotions
landed on genuine feature/CTA sections — none are lift targets, so even a wrong
one is harmless.

**The strongest precision signal:** the two news sites, **bbc (116 generic
sections) and wired (33)**, produced **zero promotions**. Given 149 chances to
hallucinate "evidence" out of article lists, the ceiling invented none — it
refuses to type news content as proof/pricing. This is exactly where the *regex
floor* still over-fires (bare `plans`/`question`/`reviews` on headlines); the
LLM, seeing the body, is strictly more precise here.

## Perspective 2 — The CRO strategist (lift value)

The evidence recoveries are proof the reorder engine can now *see and move up* —
all invisible to the floor because they're image-rendered, div-based, or
heading-buried:

- **whoop** — membership **pricing** (`$199/yr`, 0.98) + 5 **testimonials**
  (Ronaldo, Niall Horan, Sha'Carri Richardson, Patrick Mahomes, Virgil van Dijk —
  recovered purely from `<img alt>`) + a proof **stat**.
- **docker** — three **stats** @0.95: *91% of the Fortune 100*, *20B+ pulls/mo*,
  *20M+ developers*.
- **github** / **coursera** — customer **logo walls** (0.98 / 0.85: American
  Airlines·Mercedes·Spotify… / L'Oréal·P&G·Tata…).
- **mailchimp** — **Standard/Premium pricing** tiers (0.95) + a case-study
  **testimonials** carousel.
- **casper** — three real sheet-review **testimonials** (0.90–0.95).
- **calendly** (169% ROI stories), **wise** (14.8M customers / $16B mo),
  **gumroad** (creator earnings + quote), **monday** (customer quote + an
  integrations grid).

On the sites where it fired, the ceiling **roughly doubled evidence coverage**.

## Perspective 3 — The engineer (cost / failure modes)

Cheap and fast (Haiku, one batched call per site). Failure modes the run
surfaced, none of them the typer's fault:

- **Bot-blocks:** allbirds, glossier → HTTP 429 from the datacenter IP.
- **SPA shells:** gymshark (0 sections), ruggable (2), warbyparker (4) —
  static fetch got an empty shell. **Nothing to type because nothing was
  captured.**
- **CSS-in-excerpt bug (fixed this run):** brex/plaid/mongodb excerpts were
  `<style>` text — `stripTags` drops the tag but not the CSS between it.
  `sectionBodyExcerpts` now strips `<script>/<style>` content first.

## Perspective 4 — The site owner (would they agree with their own labels?)

Spot-checking each page against what its owner would say: whoop/docker/casper —
yes, those *are* their testimonials/stats/pricing. News sites — yes, their
article lists are *not* evidence. hellofresh's meal-plan cards were labelled
`features`; an owner might call them "plan selectors" (pricing-adjacent), but
`features` is defensible and harmless. No label an owner would find wrong-headed.

## Perspective 5 — The data lens (aggregate shape)

Floor leaves 78% of sections generic → it under-commits, by design. The ceiling
promotes 24% of those, and only ~9% of all sections become *evidence*. Evidence
promotions cluster at high confidence (0.85–0.98); the 0.70 promotions are almost
all `features` — the model hedges appropriately on the fuzzy category. Floor and
ceiling **compose**: on brilliant the floor already caught the testimonials, so
the ceiling correctly added nothing.

## Perspective 6 — Capture-readiness (the real bottleneck)

The run's clearest lesson isn't about typing — it's that **typing is only as good
as capture**. ~4 / 29 sites (~14%) came back as near-empty SPA shells or blocked
fetches; on those, neither floor nor ceiling can help because there is no content
to read. This is the stage-2 (Browserbase render) gap, quantified. Investing in
render coverage would unlock more value than any further typing tuning.

---

## Honest caveats & next steps

1. **`features` eagerness (30 / 78).** Harmless (never a lift target) but noisy.
   Option: keep the 0.70 floor for evidence types, require a higher bar (~0.8)
   for `features`. Left as a documented knob, not changed.
2. **News-site floor false positives persist.** The ceiling only sees *generic*
   sections, so floor-typed FPs like bbc *"Canada plans response"* → pricing are
   not fixed here. That's a separate regex-precision task on `\bplans?\b` etc.
3. **Capture, not typing, is the ceiling on coverage** (Perspective 6). Prioritise
   stage-2 render breadth (Browserbase) for SPA/blocked sites.
4. **Fixed this run:** `<style>/<script>` content no longer leaks into LLM
   excerpts.

## Re-run

- GitHub → Actions → **Section-typer report** → Run (optional `urls=a.com,b.com`).
- Or **Section-typer smoke** for a single `url=` before/after.
- Artifact `section-typer-report.txt` is attached to each run (14-day retention).
