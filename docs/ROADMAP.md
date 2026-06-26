# Angel Adaptive — Roadmap

Milestone slicing for the architecture in [`ARCHITECTURE.md`](./ARCHITECTURE.md). Each
milestone is **independently shippable** — M1 alone is a sellable analytics product; the
adaptation engine arrives at M4–M5. Ordering front-loads a thin end-to-end vertical slice
with **no AI and no adaptation**, then layers intelligence on top.

Mapped to the three product phases:

| Phase | What it means | Milestones |
|---|---|---|
| **1 — Learn Mode** | Crawl the site + capture every visitor. **Zero changes to the site.** Dashboard delivers value day 1. | M0, M1, M2 |
| **2 — Intelligence Mode** | Per-segment behavioral models + a probabilistic decision engine. Angel proposes, nothing is served. | M3 |
| **3 — Adaptive Mode** | Real-time, per-visitor DOM adaptation from the safe-op library, grounded in the site's own content. | M4, M5 |
| *(cross-cutting)* | Scale the event firehose off Postgres. Invisible to customers. | M6 |

---

## M0 — Schema + tenancy foundation
**Phase 1 · no user-visible feature · unblocks everything**

- Supabase migration (`supabase/migrations/`) for `sites`, `visitors`, `sessions`, `events`,
  `events_rollup` (content/intelligence tables can land with M2/M3).
- RLS policies on every table; regenerate `src/integrations/supabase/types.ts`.
- Seed a `site` row + `public_site_key`.

**Done when:** an owner-scoped site exists, types compile, RLS verified.

---

## M1 — Thinnest vertical slice: snippet → ingest → dashboard
**Phase 1 · the first shippable product (analytics) · no AI, no adaptation**

- Hand-built `script.js` (< 30 KB) in `src/snippet/`, separate Vite lib build → `public/cdn/`.
  Sends `page_view` + scroll + exit via `navigator.sendBeacon`, consent-gated.
- `POST /api/ingest` (public, CORS, `corpus.$.ts` idiom) writing through `SupabaseEventSink`.
- Nightly rollup into `events_rollup`.
- Auth-gated **dashboard** page (recharts): traffic by source/device/geo + a sessions table.

**Done when:** loading the snippet on a test page produces live visitor rows the dashboard
charts. *This is the "Dashboard under Fas 1" — value with zero site changes.*

---

## M2 — Content Inventory crawler
**Phase 1 · completes Learn Mode**

- `crawl.functions.ts` + `crawler.server.ts` wrapping `freezeSite` + `collect`/`pageAudit`
  over a URL frontier; persist `content_inventory` + `crawl_runs`. Lazy-Browserbase, offline
  lane (mirror `run.functions.ts`).
- SSE crawl-progress route (reuse `$runId.stream.ts`).
- Dashboard gains an **inventory browser** (every CTA/testimonial/logo/FAQ by category) and
  the first cross-join insight: *"72% of LinkedIn visitors leave before your testimonials
  (section 4)"* — `events_rollup` ⋈ `content_inventory` section positions.

**Done when:** a crawl indexes the test site into categorized inventory rows and the first
behavioral insight renders.

---

## M3 — Segmentation + intelligence (advisory only)
**Phase 2 · Intelligence Mode**

- Rollup job builds per-segment behavioral `model`s; `segments` auto-created from signal
  clusters.
- `angel-adapt.server.ts`: `runAngel` authors `AdaptationPlan`s per segment, validated
  against the inventory, stored as **`proposed`** with the Angel's `rationale`. **Nothing is
  served to visitors.**
- Dashboard shows segment insights + *recommended* arrangements (dry-run).

**Done when:** the dashboard shows auto-created segments and validated, human-reviewable
proposed plans — still zero live changes.

---

## M4 — Adaptation runtime, shadow mode
**Phase 3 prep**

- Snippet **interpreter** for `AdaptationPlanSchema` + anti-flicker (bounded hide, watchdog,
  apply-then-reveal, `DocumentFragment` reorders).
- `GET /api/decision` + `GET /api/config` (edge-cached).
- Run in **shadow/QA mode**: plans apply only for dashboard-flagged preview sessions; a
  control holdback is always preserved.

**Done when:** an approved plan applies cleanly on a real customer site in preview with **no
FOUC and no CLS**, and the original site is the proven fallback on timeout/error.

---

## M5 — Live adaptive mode + results loop
**Phase 3 — the full vision**

- Flip approved plans to **`live`** for real segments with a **control holdback**.
- `adaptation_results` aggregation; dashboard shows **lift / confidence per segment**.
- **Auto-pause guardrail** if a plan underperforms its control.

**Done when:** two visitors see two different, grounded arrangements at the same URL, and the
dashboard reports per-segment lift against a control.

---

## M6 — Hot-path migration to Cloudflare-native
**Cross-cutting scale milestone — can land any time after M1 once volume warrants**

- Add `wrangler.jsonc`; implement `AnalyticsEngineEventSink`; move the firehose off Postgres.
- Edge-cache decisions in KV/Cache API; optional `SessionDO` for sticky per-session variants.
- **Snippet + public API contracts unchanged** — the proof the `EventSink` seam paid off.

**Done when:** the event firehose runs on Analytics Engine with no change to the snippet or
the public API contract.

---

## Open decisions (decide before the relevant milestone)

| # | Decision | Target |
|---|---|---|
| 1 | **Human-approved vs. fully-autonomous** adaptation posture (recommend approval gate at launch; `status` supports both) | M4/M5 |
| 2 | **Conversion definition** without backend access + statistical method (control holdback, significance) for lift claims | M5 |
| 3 | Selector-stability tolerance + **re-crawl cadence** (freeze has a 90-day TTL); optional text-anchored fallback selector | M2/M4 |
| 4 | **Event-volume threshold** that triggers the M6 cutover; cookieless / consent-denied coverage | M6 |
| 5 | Snippet **anti-flicker timeout** (proposed 1500 ms) + whether to inline precomputed plans in `/api/config` | M4 |
| 6 | **Second Vite build** setup so the snippet never imports `src/lib/**` (`src/snippet/contract.ts` is the only shared module) | M1 |

See [`ARCHITECTURE.md` §9](./ARCHITECTURE.md#9-open-decisions) for the full rationale.
