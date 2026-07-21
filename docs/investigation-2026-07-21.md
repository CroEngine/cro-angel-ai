# Investigation — more advantages + refactoring audit (2026-07-21)

Two read-only investigations requested by the founder: (1) find more advantages,
especially **moving content between pages**; (2) check what needs refactoring.
Every load-bearing claim below was verified against the code by the lead.

---

## Part 1 — More advantages

### Headline: cross-page lifting already exists and runs live — but only for price

The founder's insight ("flytta saker från andra sidor") is **not** a green-field
build. The full pipeline — signal → pick source page → verbatim whitelist →
validate → safe reversible insert → live serving → A/B → owner approval — is
already shipped in the server line. It is just **narrow**: it lifts one content
type (a verbatim **price**), in one placement (below the hero), on one snippet
(`public/adaptive.js`).

Verified path:
- Live decide route calls serving behind owner gates and returns variant ops to
  the snippet: `src/routes/api/adaptive/decide.ts:169` (`servingEnabled` +
  domain-verified + billing) → `serveDecision(loadServableVariants(site, path), …)`.
- The snippet applies + reverts the lift op: `public/adaptive.js:1000` (apply),
  `:1066` (record undo), `:1107` (revert).
- Verbatim gate (LLM never trusted): `src/adaptive/redesign/generate.ts:136`
  forces `insert_snippet` to be a whitespace-normalized verbatim quote from an
  offered source page. Same-site-only href guard: `src/adaptive/redesign/serve.ts:75`
  (`isSameSitePath`); text inserted as data in a `<p>`, never markup (`:52`).
- Onward-navigation signal that motivates the lift: `angel_page_flow_rollup`
  (`supabase/migrations/20260718000000_angel_page_flow_rollup.sql`) + source-page
  selection with a never-double-show guard: `scripts/redesign/auto-generate.ts:239`, `:299`.

### What already exists (the foundation)
- **Multi-page storage** is already there: `angel_content_inventory` is keyed
  per `(site, path)` and holds verbatim testimonial / security / guarantee / FAQ
  text with selectors — `src/adaptive/persistence.server.ts:241`; path column
  added in `supabase/migrations/20260701133000_angel_content_inventory_add_path.sql`.
- The dashboard already reads across **all** paths (no path filter):
  `src/lib/dashboard/dashboard.functions.ts:309`.
- The visitor profile is already cross-page: `AngelProfile.pages[]` records
  `{path, time, sectionTypes[]}` per visit and already emits `seen:pricing` from
  it — `src/adaptive-lab/profile.ts:23`, `:140`, `:238`.

### Ranked opportunities (value-to-effort)
1. **Generalize the lift beyond price** (M) — reuse the whole pipeline for a
   testimonial (`/customers`), a security/SOC2 badge (`/security`), a money-back
   guarantee, an FAQ answer. Content is already catalogued per-page. Needs
   per-slot verbatim extractors + per-slot placement + per-slot double-show guard.
2. **Multi-page inventory read** (S) — `loadSiteInventory(site)` = the dashboard's
   all-paths query generalized, keeping `path` as provenance. ~30 lines.
3. **Cross-page cohorts** (S) — emit `seen:security` / `seen:faq` from
   `profile.pages[].secs`; gate lifts on them. Profile already tracks the data.
4. **Answer-as-link for any strong onward flow** (S) — surface the destination
   page's own headline as a same-site link even when there's no price to lift.
   `extractQuoteAnswer` + the serve op already exist as the price fallback.
5. **Persist the live snippet's per-page inventory into the pool** (M) — makes the
   pool build itself from real traffic. NOTE: the lab `collect` edge fn is a
   non-deployed reference impl writing a different table — see caveats.
6. **Bring cross-page lift to the lab snippet** (M/L) — the newer client line can
   only reorder/emphasize same-page content today.
7. **Site-search "unmet intent" cohort** (M) — `site_search` is already a
   first-class server event (`src/adaptive/types.ts:333`); pair with a lift.
8. **Onward-navigation as a measured outcome** (S/M) — the natural success metric
   for a lift ("got the answer here instead of bouncing to find it").
9. **Rage-click surfacing** (S/M) — `rage_click` already a server event; lab
   `behavior.ts` doesn't track it yet. (Vision doc: must never auto-drive a change.)
10. **Plan-card-level pricing spotlight** (M) — `patterns.ts:333` explicitly defers
    this pending card-level inventory.

**Recommended path:** #2 → #3 → #1 on the already-live `adaptive.js` path — fastest
to real visitors because serving/measurement/approval already ship.

### Caveats
- **Two product lines** (`src/adaptive/*` + `adaptive.js` vs `src/adaptive-lab/*`);
  which is strategic go-forward is unclear from code. Changes effort materially.
- **Stale comment**: `src/adaptive/redesign/serve.ts:9` says the serving path is
  "deliberately NOT wired… routes nothing" — contradicted by `decide.ts:169`,
  which wires it. The route is authoritative; the comment should be reconciled.
- **Lab collector may persist nowhere live**: `supabase/functions/collect/index.ts`
  is a reference impl writing a different table than `angel_content_inventory`.
- Cross-page lift depends on an **offline LLM loop** (`scripts/loop/nightly.ts`)
  today; a site with no nightly run has no lift variants.
- **Relevance ranking** (which item to lift for which cohort) is the unproven part
  for non-price content — where lift quality is won or lost.

---

## Part 2 — Refactoring audit

**Overall: broadly clean for ~81k LOC.** 5 TODO/FIXME markers total, no
commented-out/dead code, clean client/server import boundaries, the detector
codegen (`gen-detectors.ts`) is a genuine single-source design, and the production
revert path is byte-exact tested (`serving-smoke.mjs`). Not a rewrite. Debt is
concentrated in three spots.

### HIGH (verified)
1. **`build-harvest.ts` silently corrupts live inventory.** Header claims "single
   source of truth — can never drift apart" (`:1-3`) but imports only 4 of 6
   detectors (`:14-17`, missing `FORMS_SCRIPT`/`NAVIGATION_SCRIPT`); forms & nav
   are hand-written inline and have **already drifted** from canonical
   `src/lib/tests/scripts/{forms,navigation}.ts`. The harvester POSTs to the live
   `/api/adaptive/inventory`, so on-page harvest writes a different forms/nav shape
   than the headless crawler → the per-site CRO-bank is quietly inconsistent.
   *Fix:* interpolate the two canonical scripts like the other four.
2. **Two adaptation engines diverge (strategic).** `public/adaptive.js` (v0.1.0,
   `window.AngelAdaptive`) vs `src/adaptive-lab/` (v0.13.0, `window.__angelAdaptive`)
   — different op vocab, different `angel-*` revert classes, different versions.
   ~15 internal harnesses (including the fleet gallery) inject the **research**
   engine; the one internal demos validate is not the one customers run.
   *Fix:* decide the go-forward engine, document the relationship, extract the
   pattern-apply + presentability-guard + revert core into one shared module.
3. **Winner-labeling math untested.** `pBetaGreater` (`aggregate.ts:404`),
   `twoProportionZ` (`:1104`), `probFromZ` (`variant-stats.ts:16`) produce the
   owner-facing "probability B beats A," lift %, and winner verdicts — **zero**
   direct tests (grep of `*.test.ts` returns nothing). A sign error silently
   mislabels winners. *Fix:* add known-value assertions (low effort, high protection).

### MED / LOW
4. Three separate normal-dist approximations (`measure.ts:33`, `aggregate.ts:391`,
   `variant-stats.ts:16`); only one tested. Consolidate into one pure `lib/stats.ts`.
5. `overview-panel.tsx` — single 1033-line component; split into sub-views.
6. `overlays.tsx` `JourneysOverlay` ~913 lines; move to its own file.
7. `crawler-inventory.ts` (955) bundles CTA curation + goal ranking + audit→inventory
   mapping; split along the seams the tests already use.
8. Consent-selector list copy-pasted across ~6 files; extract `CONSENT_SELECTORS`
   for the Node-side copies (eval-string copies can't import — accept/template).
9. Price regex duplicated across ~6 files; extract shared `PRICE_RX`.
10. `normalize.ts` — 15 avoidable `any` on a typed-elsewhere surface (NOT the
    eval-boundary kind); type with existing audit/inventory interfaces.
11. `dashboard.functions.ts` — 350-line `getDashboard` + billing endpoints mixed in.
12. `public/adaptive.js:20` stale `VERSION = "0.1.0"` after 44 commits; align.

### Quick wins (<1h each)
#3 (test winner math) · #1 (fix harvest drift) · #8/#9 (extract constants) ·
#10 (type normalize.ts) · #12 (version) · serve.ts:9 stale comment.

### Leave-alone (looks like a smell, is fine)
Root `*.node.mjs` (git-ignored build outputs) · `detectors.generated.ts` + codegen
(healthy single-source) · eval-boundary `any` in `inventory.ts` (inherent) · the
four `inventory*.ts` (distinct roles) · `aggregate.ts` (large but cohesive, 84
tests) · production revert path (well-covered) · `winner.ts` (exemplary — imports
shared stats instead of re-implementing).

---

## Cross-cutting recommendation
Both investigations independently flag the **two-engines split** as the crux.
Highest-leverage move: decide the go-forward engine and consolidate the pattern
core into one shared module — every pattern fix is currently made twice, and the
internal proof (the gallery) validates the research engine, not the customer one.
The cross-page lift generalization (Part 1 #1) then lands once, in the right place.
