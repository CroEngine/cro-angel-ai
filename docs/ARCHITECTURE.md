# Angel Adaptive — Technical Architecture

> **Status:** Locked design blueprint. Grounded against the real repo.
> **Scope:** Build *Angel Adaptive* — an Adaptive Website Platform — **into** the
> existing TanStack Start + Cloudflare Workers + Supabase app, reusing the deterministic
> CRO substrate (`collect → croScore → croProjection → runAngel`) and the Browserbase
> freeze pipeline as first-class building blocks.
>
> Milestone slicing lives in [`ROADMAP.md`](./ROADMAP.md).

---

## What we're building

The customer installs **one JavaScript snippet** and never touches their site again.
Angel then **observes → learns → adapts** the page, per individual visitor, in real time,
by patching the DOM locally in the visitor's browser. The same URL can render differently
for different visitors. The original site/CMS/codebase is **never** changed; every
adaptation is **ephemeral** (it vanishes when the visitor leaves).

**Five hard principles** (the product's non-negotiables):

1. **Install once, zero implementation** — no CMS/WordPress/Shopify plugin, no developer.
2. **Never invent content** — no new testimonials, stats, prices, offers, or guarantees.
   Everything shown must already exist somewhere on the customer's site.
3. **Original site never changes** — the snippet only patches the current visitor's DOM;
   changes disappear on leave.
4. **Two people can see two different sites** at the same URL.
5. **Learn before adapting** — understand the site and the visitors first, optimize later.

---

## Table of contents

- [0. The key insight: ~40% is already built](#0-the-key-insight-40-is-already-built)
- [1. System overview](#1-system-overview)
- [2. The client snippet (`script.js`)](#2-the-client-snippet-scriptjs)
- [3. The safe-adaptation typed contract](#3-the-safe-adaptation-typed-contract)
- [4. Data-store strategy (the event-volume problem)](#4-data-store-strategy-the-event-volume-problem)
- [5. Database schema](#5-database-schema)
- [6. API surface](#6-api-surface)
- [7. How the existing Angel pipeline plugs in](#7-how-the-existing-angel-pipeline-plugs-in)
- [8. Privacy / consent / GDPR](#8-privacy--consent--gdpr)
- [9. Open decisions](#9-open-decisions)

---

## 0. The key insight: ~40% is already built

The existing CRO test harness was engineered with exactly the disciplines Angel Adaptive
needs. The new system is mostly **plumbing, storage, and a small DOM interpreter** around
a proven extraction/decision core. **We reuse; we do not reinvent.**

| Product need | Already in the repo | File |
|---|---|---|
| Crawl a live page (consent, MHTML, capture-validity) | `freezeSite()` | `src/lib/tests/snapshot/freeze.server.ts` |
| Extract every element with a **stable, single-match CSS selector** | `buildSelector()` | `src/lib/tests/scripts/collect.ts:136` |
| Content taxonomy → inventory category enum | `TrustSignalType` / `SectionType` / `ElementCategory` | `src/lib/tests/schema.ts` |
| A brain that decides changes but **cannot invent content** | `runAngel()` + `ANGEL_SYSTEM_PROMPT` | `src/lib/tests/angel.server.ts`, `angel.ts:170` |
| Deterministic grounding signals | `scoreCro()` / `projectCro()` | `src/lib/tests/croScore.ts`, `croProjection.ts` |
| Public, CORS-open, unauthenticated endpoint idiom | `corpus.$.ts` route | `src/routes/api/public/corpus.$.ts` |
| Streaming (SSE) progress idiom | `$runId.stream.ts` | `src/routes/api/tests/$runId.stream.ts` |
| Lazy-Browserbase server-fn pattern (never at Worker init) | `run.functions.ts` | `src/lib/tests/run.functions.ts` |
| Server admin DB (service role, bypasses RLS) | `supabaseAdmin` | `src/integrations/supabase/client.server.ts` |
| Worker entry where Cloudflare `env` bindings arrive | `fetch(request, env, ctx)` | `src/server.ts:41` |

**Design rule #1: do not reinvent any of the above.** The `TrustSignalType`/`SectionType`
unions become — almost verbatim — the `content_inventory.category` enum. `buildSelector`
becomes the selector authority for the adaptation contract. `freezeSite` becomes the
crawler. The Angel becomes the per-segment strategy author.

**A constraint the repo teaches us (and we preserve):** the heavy Stagehand/Browserbase
chain is **lazy-loaded** and must never be evaluated at Worker isolate init (see
`run.functions.ts` and the `pkce-challenge` alias note in `vite.config.ts`). Crawling
therefore lives in an **off-Worker execution lane**, never in the request hot path. This
shapes the whole crawler/decision split below.

---

## 1. System overview

**Seven subsystems**, in two execution lanes:

- **Offline / Learn lane** — crawl, rollups, and Angel plan-authoring. Lazy-imported,
  scheduled/triggered, **never on the request hot path**.
- **Runtime / hot lane** — event ingestion and decision serving. Cheap, edge-cacheable.

```
                          ┌──────────────────────────────────────────────────────┐
   CUSTOMER SITE          │                ANGEL ADAPTIVE PLATFORM                 │
   (never modified)       │                                                        │
                          │   OFFLINE / LEARN LANE          RUNTIME / HOT LANE      │
 ┌───────────────┐        │   ┌───────────────────┐      ┌────────────────────┐    │
 │ <script        │        │   │ (4) Crawler        │      │ (2) Ingestion API  │   │
 │  src=cdn/...   │──load──┼──▶│  = freezeSite()    │      │  POST /api/ingest  │◀──┼── snippet beacons
 │  data-site-id> │        │   │  per-URL frontier  │      │  (public, CORS,    │   │   (events)
 └──────┬────────┘        │   │  → Content         │      │   unauthed)        │   │
        │ runs in          │   │    Inventory        │      └─────────┬──────────┘   │
        │ visitor browser  │   └─────────┬──────────┘                │ writes        │
        ▼                  │             │ writes                    ▼               │
 ┌───────────────┐         │             ▼                  ┌────────────────────┐   │
 │ (1) Snippet/   │         │   ┌───────────────────┐      │ (3) EventSink       │   │
 │     SDK        │         │   │   POSTGRES (cold)  │◀────▶│  swappable:         │   │
 │  - signals     │         │   │  sites,            │      │  v1 Supabase →      │   │
 │  - consent     │         │   │  content_inventory │      │  v2 CF Analytics    │   │
 │  - apply plan  │         │   │  segments,         │      │  Engine / DO / KV   │   │
 └──────┬────────┘         │   │  adaptations,      │      └─────────┬──────────┘   │
        │ GET decision      │   │  adaptation_results│                │ rollups       │
        ▼                  │   └─────────┬──────────┘                ▼               │
 ┌───────────────┐         │             │              ┌────────────────────┐       │
 │ (5) Decision   │◀────────┼─────────────┴──────────────│ (6) Decision Engine │       │
 │     fetch      │         │                            │  segment match →    │       │
 │  GET /api/     │         │                            │  plan select →      │       │
 │   decision     │         │              authored by   │  grounding check    │       │
 └───────────────┘         │              ┌────────────▶ └────────────────────┘       │
                          │              │ runAngel()  (per-segment strategy author)  │
                          │   ┌──────────┴─────────────────────────────────────────┐ │
                          │   │ (7) Dashboard (auth-gated): recharts analytics,     │ │
                          │   │  inventory browser, segment insights, plan review   │ │
                          │   └─────────────────────────────────────────────────────┘ │
                          └──────────────────────────────────────────────────────┘
```

**The five data flows:**

1. **Install + boot.** Browser loads `cdn/script.js` async. Snippet reads `data-site-id`,
   checks consent, loads/creates a pseudonymous visitor id, gathers signals.
2. **Decision fetch (hot, Phase 3).** On boot the snippet asks `/api/decision` for the
   chosen **Adaptation Plan** for its segment; applies it to the DOM. Edge-cached per
   `(siteKey, segmentId, extractorVersion)` — decisions are per-segment, not per-visitor.
3. **Event ingestion (always-on, Phase 1+).** The snippet batches behavior events and
   `POST`s them to `/api/ingest`, which writes through the **EventSink** to the event store.
4. **Crawl (offline).** A job walks the site (`freezeSite` per URL), runs the existing
   extractors, and writes a normalized **Content Inventory** — the ground truth of *what
   content exists* (the spine of Principle 2).
5. **Intelligence (offline, Phase 2).** A rollup job aggregates events into per-segment
   models, auto-creates segments, and invokes `runAngel()` to author candidate plans
   (grounded strictly in the inventory). Plans land as `proposed`; the dashboard surfaces
   them for review; `adaptation_results` close the loop with per-segment outcomes.

The **dashboard** is the day-1 value: traffic analytics (recharts) + early insights
("72% of LinkedIn visitors leave before testimonials"), derived from event rollups joined
against inventory section positions.

---

## 2. The client snippet (`script.js`)

### 2.1 Build & delivery

- **Zero framework.** Hand-written TypeScript compiled to a single ES5-safe IIFE. No React,
  no dependencies. Target **< 30 KB gzip** (realistically < 12 KB if disciplined).
- Source lives at `src/snippet/` (new), built by a **separate Vite lib build** (a second
  config, *not* the app build, which pulls React/TanStack). Output emitted to
  `public/cdn/` and served as a static asset by the same Worker (mirrors how
  `public/corpus/**` binaries are served today).
- **Versioning.** Ship `public/cdn/v1/script.js` (immutable, long cache) plus a ~1 KB
  `public/cdn/script.js` **loader stub** that injects the pinned version — lets us
  cache-bust the real bundle without the customer changing their tag.
- **No bundler coupling.** The snippet never imports from `src/lib/**` (Worker/Node code).
  The *only* sanctioned shared module is `src/snippet/contract.ts` (the plan schema, §3),
  imported by both the snippet build and the server. The contract is the seam.

### 2.2 What it collects (signals)

- **Acquisition/context (cheap, once):** `document.referrer`, full UTM set,
  `navigator.language`, screen/viewport, first-vs-returning, timezone. The raw UA is parsed
  **server-side** (saves bytes). **Geo is derived server-side** from the edge request
  (`request.cf.country/city/region`, `CF-IPCountry`) — the snippet sends nothing about IP.
- **Behavior (streamed, batched):** scroll depth (throttled), time-on-page
  (visibility-aware), CTA/interactive clicks (delegated listener keyed by the *same
  selectors* the inventory uses), hover-intent, exit/`pagehide` (final
  `navigator.sendBeacon`), and a coarse in-session journey.

Events are buffered in a ring and flushed on N events / T ms / `pagehide`. The final flush
always uses `sendBeacon` (survives unload). Payloads are compact positional arrays.

### 2.3 Consent-first boot

The snippet boots into a **consent-pending** mode: it stores nothing in cookies/localStorage
and collects nothing PII-bearing until consent is resolved, in this order:

1. **TCF v2 / CMP API** (`window.__tcfapi`) if present — the freeze pipeline already
   interoperates with CMPs (Sourcepoint, etc.), so we know these are common.
2. **Site-configured signal** the customer points us at via dashboard config (e.g. read a
   `cookieConsent` cookie the site already sets).
3. **`anonymous_default`** — no CMP detectable: in-memory session id only, no persistent
   cookie, aggregated geo only, no cross-session linking. Adaptation still runs (it needs
   *signals*, not *identity*).

Stored centrally as `sites.consent_mode = 'tcf' | 'site_signal' | 'anonymous_default'`.

### 2.4 The DOM adaptation contract (the heart of the product)

An adaptation is **never code the snippet executes** — it is **data**: a JSON **Adaptation
Plan** of constrained operations that reference elements *proven to exist* in the Content
Inventory by stable selector. The snippet is a small, dumb, deterministic **interpreter**
of that plan. This is what makes "Angel can never invent content" a **structural guarantee**
rather than a prompt-time hope.

```jsonc
{
  "planId": "pl_…",
  "siteId": "…",
  "segmentId": "seg_linkedin_saas",
  "extractorVersion": "1.6.0",          // plan is tied to the inventory snapshot it was authored against
  "ops": [
    { "op": "reorderSections", "order": ["#testimonials", "#hero-cta-row", "#pricing"] },
    { "op": "emphasizeCta",    "selector": "a[data-testid='start-trial']", "style": "sticky" },
    { "op": "showElement",     "selector": "#trust-badges" },
    { "op": "swapImage",       "selector": "#hero-img", "toInventoryId": "ci_8842" },
    { "op": "showMicrocopy",   "slotSelector": ".cta-row", "fromInventoryId": "ci_3310" } // "No credit card" — must pre-exist
  ],
  "fallback": "noop"
}
```

Every `selector` and every `*InventoryId` is validated **at author time** against the
inventory (the element must exist in the crawl) **and at apply time** by the snippet (the
element must exist in *this* DOM). A failed op is **skipped**, never invented.

**Anti-flicker / no-CLS application strategy** (the classic A/B-test FOUC problem, solved
for our ephemeral, per-visitor model):

1. **Bounded synchronous hide.** The ~1 KB loader stub injects a synchronous `<style>` that
   hides only the **adaptation-eligible containers** for this site — *not* `<body>`. That
   selector set is the union across all approved plans, delivered in the edge-cached
   `/api/config`. Hide via `visibility:hidden` (**reserves the layout box → no CLS**), never
   `display:none` (collapses layout → *causes* CLS on reveal).
2. **Hard watchdog timeout (~1500 ms).** If the decision is slow or fails, the site reveals
   **unmodified** within the timeout. The customer's original site is always the safe
   fallback (Principle 3). Never trap the visitor behind a hidden element.
3. **Apply, then reveal.** When the decision arrives: resolve selectors, mutate the DOM
   while still hidden, then remove the hide style in one `requestAnimationFrame` — no
   intermediate state is ever visible.
4. **Reorder without reflow thrash.** Section/element reorders use `DocumentFragment` moves
   of **existing nodes** (never clone-and-inject), so handlers, images, and iframes survive
   — and we are physically incapable of introducing new content.
5. **Emphasis/show/hide** are class toggles + `position:sticky`/`display` on existing nodes.
   `swapImage` swaps `src`/`srcset` to **another image already in the inventory**.
   `showMicrocopy` reveals text recorded verbatim in the inventory, referenced by
   `fromInventoryId` — there is **no free-text field**.

**Determinism & safety guarantees baked into the interpreter:**

- A **fixed, finite opcode set**. No `eval`, no `innerHTML = …`, no fetch-and-inject. A new
  capability requires shipping a new snippet version with a new opcode — it cannot be done
  from data.
- Every op is **idempotent and reversible in-session**. Changes are ephemeral; there is
  nothing to clean up server-side.
- The plan carries `extractorVersion`; if it doesn't match the site's current inventory,
  the Decision Engine won't serve it (stale plan → safe noop).

**Fallbacks if elements aren't found** — three layers, all degrade to "show the original":

- **Op-level:** missing selector → skip that op, continue.
- **Plan-level:** > X% of ops fail (site changed since crawl) → abort the plan, reveal
  original, emit a `plan_stale` event so the dashboard flags a re-crawl.
- **System-level:** any uncaught interpreter error → remove the hide style, show original.
  The snippet must **never** leave the page broken or hidden.

---

## 3. The safe-adaptation typed contract

`src/snippet/contract.ts` (shared by snippet build + server). A **zod discriminated union**
defines the *entire* set of operations. Anything not expressible here cannot be authored,
stored, transmitted, or applied.

```ts
import { z } from "zod";

// An element ref MUST be a stable selector the inventory proved exists, and/or an
// inventory item id. Both are validated against content_inventory at author time.
const InventoryRef = z.object({
  selector: z.string().min(1),                 // single-match, from buildSelector()
  inventoryId: z.string().uuid().optional(),   // ties the op to a proven content row
});

// ── the finite opcode set — each op only REARRANGES/REVEALS existing nodes ──
const Op = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reorderSections"), order: z.array(z.string().min(1)).min(2) }),
  z.object({ op: z.literal("showElement"), ...InventoryRef.shape }),
  z.object({ op: z.literal("hideElement"), ...InventoryRef.shape }),
  z.object({ op: z.literal("moveElement"), ...InventoryRef.shape,
             position: z.enum(["before", "after"]), anchorSelector: z.string().min(1) }),
  z.object({ op: z.literal("emphasizeCta"), ...InventoryRef.shape,
             style: z.enum(["emphasize", "sticky", "primary-swap"]) }),
  z.object({ op: z.literal("switchCta"), fromSelector: z.string(), toInventoryId: z.string().uuid() }),
  z.object({ op: z.literal("swapImage"), selector: z.string().min(1), toInventoryId: z.string().uuid() }),
  z.object({ op: z.literal("reorderNav"), order: z.array(z.string().min(1)).min(2) }),
  // Microcopy can only POINT AT recorded inventory text — there is no free-text field.
  z.object({ op: z.literal("showMicrocopy"), slotSelector: z.string().min(1),
             fromInventoryId: z.string().uuid() }),
  // Pricing/Security/Testimonials/Logos/FAQ/CaseStudies are expressed via the primitives
  // above (surface earlier = move/show on the inventory row of that category). Keeping the
  // opcode set minimal IS the safety property — no category-specific free-form op exists.
]);

export const AdaptationPlanSchema = z.object({
  planId: z.string(),
  siteId: z.string().uuid(),
  segmentId: z.string().uuid(),
  extractorVersion: z.string(),       // must match current inventory to be served
  ops: z.array(Op).max(12),           // bounded — small, reviewable plans only
  fallback: z.literal("noop").default("noop"),
});
export type AdaptationPlan = z.infer<typeof AdaptationPlanSchema>;
```

**Why this is safe by construction:**

- **No opcode accepts arbitrary HTML or free text.** The only text that can appear came from
  an `inventoryId` → a row whose `text` was captured verbatim from the customer's own site.
  Angel cannot write "Save 50%!" — there is no field to write it into and no inventory row
  to point at unless the site already says it.
- Numbers, prices, guarantees, testimonials are all `inventoryId` references.
- The schema mirrors the product's allowed-operations list 1:1 (Trust/Testimonials/Logos/
  FAQ/CTA/Pricing/Security/Images/CaseStudies/Navigation/Sections/Microcopy all reduce to
  reorder/show/hide/move/swap-to-existing).
- **Two-sided validation:** the server validates the plan against the schema *and* against
  the live inventory before `status` can become `approved`; the snippet re-validates against
  the live DOM at apply time.

---

## 4. Data-store strategy (the event-volume problem)

"Every visitor, every event" is a high-write, append-only firehose that does **not** belong
long-term in transactional Postgres. But Supabase is already wired and is the fastest path
to a shippable Phase 1. The resolution: an **`EventSink` interface** that decouples the
snippet/API contract from the storage engine, so we start on Supabase and move the hot path
to Cloudflare-native later **without touching the snippet or the public API**.

### 4.1 The `EventSink` seam — `src/lib/ingest/event-sink.ts`

```ts
export interface IngestEvent {
  siteId: string;
  visitorId: string;     // pseudonymous
  sessionId: string;
  type: string;          // 'page_view' | 'scroll' | 'cta_click' | 'exit' | …
  ts: number;            // client ts (server also stamps receivedAt)
  url: string;
  selector?: string;     // for element-scoped events, keyed to inventory
  value?: number;        // scroll %, dwell ms, …
  ctx?: Record<string, string | number>; // utm/device hints (validated, bounded)
}

export interface EventSink {
  writeBatch(events: IngestEvent[], meta: RequestGeo): Promise<void>;
}
```

The ingestion route depends only on `EventSink`. Implementations:

- **`SupabaseEventSink` (v1, ship now).** One multi-row `insert` into `events` via
  `supabaseAdmin`. Good to low-hundreds-of-writes/sec with batching. Partition by month;
  aggregate nightly into `events_rollup` so the dashboard never scans raw events.
- **`AnalyticsEngineEventSink` (v2, the hot-path move).** Writes each event as a data point
  to **Cloudflare Workers Analytics Engine** (purpose-built for cheap, high-write,
  high-cardinality telemetry, queried later via SQL API). Postgres then keeps only *derived*
  aggregates and relational entities.
- **`DurableObjectSessionSink` (v2.5, optional).** A Durable Object keyed by `sessionId`
  holds live session state at the edge and flushes terminal aggregates on session end — also
  the natural home for **consistent sticky variants** (same visitor → same variant) without
  a DB round-trip per event.

**The commitment:** the snippet and `/api/ingest` contract are **frozen** across these
swaps. Migration = change which `EventSink` the route constructs. No customer redeploys.

### 4.2 What goes where

| Data | Store | Why |
|---|---|---|
| `sites`, `content_inventory`, `segments`, `adaptations`, `adaptation_results` | **Postgres (Supabase)** | Relational, low-volume, transactional, RLS, join-heavy for dashboard + authoring |
| `visitors`, `sessions` (dimension rows) | **Postgres**, upsert-light (one row per visitor/session, not per event) | Bounded cardinality; needed for returning + journey |
| `events` (firehose) | **v1 Postgres (batched, partitioned) → v2 Analytics Engine** | The only true high-volume stream — isolated behind `EventSink` |
| `events_rollup` (per-site/segment/day aggregates) | **Postgres** | Dashboard reads these, never raw events |
| Live session state / sticky variant | **v2: Durable Object** | Edge-consistent, no DB on hot path |
| Decision / config responses | **Edge cache (Cache API) + KV** | Per-segment plans are highly cacheable |

### 4.3 Cloudflare bindings the v2 migration needs

There is **no `wrangler.toml`/`wrangler.jsonc` today** — the app builds via
`@lovable.dev/vite-tanstack-config` (Nitro → Cloudflare). The Worker entry already receives
`env` at `src/server.ts:41`; bindings would arrive there, they're just not declared yet. v2
introduces a wrangler config declaring `analytics_engine_datasets` (`ANGEL_EVENTS`),
`kv_namespaces` (`ANGEL_CONFIG`), and optionally `durable_objects` (`SessionDO`).

**Recommendation:** keep relational entities **and rollups** in Supabase Postgres (RLS,
mature SQL, already wired, join-heavy dashboard). Use **Analytics Engine** for the firehose
and **KV + Cache API** for decision/config caching. Reach for **D1** only if we later want
rollups co-located at the edge for decision latency (optional, not on the critical path).
Because `env` must be read **per-request inside the handler** (the repo's documented Worker
pattern — `SECRETS.md`, `angel.server.ts` read `process.env` inside the function), the
`EventSink` factory takes `env`/`ctx` from request scope, not module load.

---

## 5. Database schema

Postgres (Supabase). New migration under `supabase/migrations/` (none exist yet). Types
regenerated into `src/integrations/supabase/types.ts` (currently empty) after the migration.
**RLS on every table.** Dashboard reads go through user-scoped auth (`attachSupabaseAuth`);
writes through `supabaseAdmin`. **[HV]** = high-volume (Analytics Engine in v2, partitioned
PG in v1).

```sql
-- ── tenancy ──────────────────────────────────────────────────────────────
sites
  id uuid pk
  owner_user_id   uuid     -- → auth.users; RLS scopes everything to the owner
  domain          text     -- canonical host the snippet is allowed to run on
  public_site_key text unique  -- the data-site-id value in the <script> tag
  phase           text     -- 'learn' | 'intelligence' | 'adaptive'
  consent_mode    text     -- 'tcf' | 'site_signal' | 'anonymous_default'
  consent_config  jsonb    -- selector/cookie name when site_signal
  allowed_origins text[]   -- CORS allow-list for ingest/decision (defense in depth)
  created_at, updated_at

-- ── content ground truth (the spine of Principle 2) ────────────────────────
crawl_runs
  id uuid pk
  site_id uuid fk→sites
  status text              -- 'queued'|'running'|'done'|'failed'
  pages_crawled int
  extractor_version text
  started_at, finished_at

content_inventory          -- one row per extracted item, per page
  id uuid pk
  site_id uuid fk→sites
  crawl_run_id uuid fk→crawl_runs
  url text
  category text            -- ENUM mirrors schema.ts TrustSignalType ∪ SectionType ∪
                           -- {cta, image, headline, microcopy, nav_item, case_study}
  selector text            -- stable, single-match — produced by buildSelector()
  text text                -- the actual visible text/microcopy (verbatim from site)
  attrs jsonb              -- href, src/srcset, alt, rating, logoCount, …
  rect jsonb               -- x/y/w/h at capture viewport
  section_kind text        -- nav|header|hero|cards|content|footer
  above_fold bool
  visual_weight int
  extractor_version text
  first_seen_at, last_seen_at
  UNIQUE (site_id, url, selector, category)   -- idempotent re-crawl upsert

-- ── audience ───────────────────────────────────────────────────────────────
visitors                   -- pseudonymous; one row per visitor id
  id uuid pk
  site_id uuid fk→sites
  visitor_key text         -- the snippet's first-party id (hashed)
  first_seen_at, last_seen_at
  first_referrer text, first_utm jsonb
  is_returning bool
  UNIQUE (site_id, visitor_key)

sessions                   -- one row per session (NOT per event)
  id uuid pk
  site_id uuid fk→sites
  visitor_id uuid fk→visitors
  started_at, ended_at
  entry_url text, exit_url text
  device jsonb             -- parsed UA: device/browser/os
  geo jsonb                -- country/region/city from request.cf (coarse)
  language text, utm jsonb
  source text              -- derived channel: 'linkedin'|'google_organic'|…
  segment_id uuid fk→segments      -- assigned at decision time
  bounced bool, max_scroll_pct int, duration_ms int

events  [HV]               -- the firehose
  id bigint pk
  site_id, visitor_id, session_id
  type text, url text, selector text, value numeric
  client_ts timestamptz, received_at timestamptz, ctx jsonb
  -- v1: partitioned by month, batch-inserted; v2: Analytics Engine data points

events_rollup              -- dashboard reads ONLY this, never `events`
  id, site_id, segment_id nullable, day date
  source text, section_kind text
  views int, cta_clicks int, reached_section int, exits_before int
  avg_scroll_pct numeric, conversions int
  UNIQUE (site_id, coalesce(segment_id), day, source, section_kind)

-- ── intelligence ───────────────────────────────────────────────────────────
segments
  id uuid pk
  site_id uuid fk→sites
  name text                -- 'LinkedIn SaaS visitors'
  definition jsonb         -- match rules over signals (source, device, geo, returning…)
  auto_created bool
  model jsonb              -- per-segment behavioral stats (conv lift estimates)
  size_estimate int
  created_at

adaptations                -- a candidate/active Adaptation Plan for a segment
  id uuid pk
  site_id uuid fk→sites
  segment_id uuid fk→segments
  plan jsonb               -- the validated safe-ops Adaptation Plan (§3)
  extractor_version text   -- inventory version it was authored against
  status text              -- 'proposed'|'approved'|'live'|'paused'|'retired'
  authored_by text         -- 'angel' | user id
  rationale text           -- the Angel's grounded "why" (advisory only)
  created_at, approved_at

adaptation_results         -- per-segment outcome of a live plan (closes the loop)
  id uuid pk
  adaptation_id uuid fk→adaptations
  segment_id uuid fk→segments
  day date
  exposures int, conversions int, cta_clicks int
  control_conversions int  -- holdback group (ALWAYS keep a control)
  lift numeric, confidence numeric
  UNIQUE (adaptation_id, day)
```

**Relationships:** `sites 1—* content_inventory`, `sites 1—* visitors 1—* sessions 1—*
events`. `segments` are per-site; `sessions.segment_id` records assignment. `adaptations`
belong to a `(site, segment)` and reference inventory items **by id inside the plan JSON** —
so a plan is only valid while those rows exist at that `extractor_version`.
`adaptation_results` aggregate per plan per day, always against a control holdback.

Everything is Postgres **except `events`**, the only unbounded stream — the thing the
`EventSink` abstraction exists to relocate.

---

## 6. API surface

Two established idioms: file-based routes under `src/routes/api/` for HTTP endpoints (like
`corpus.$.ts`), and `createServerFn` for auth-gated dashboard RPC (like `run.functions.ts`).

### Public, unauthenticated, CORS-open (mirror `corpus.$.ts` exactly)

Hit by the snippet from arbitrary customer origins. They authenticate by **`public_site_key`
+ origin allow-list**, never by user auth, and reuse the `CORS_HEADERS` + `OPTIONS` 204
pattern.

- **`POST /api/ingest`** — `src/routes/api/public/ingest.ts`. Batched event payload, zod
  validated; resolves `siteId` from `public_site_key`; checks `Origin` against
  `sites.allowed_origins`; derives geo from `request.cf`; calls `EventSink.writeBatch`.
  Returns `204`. Cheap, non-blocking; also handles the `sendBeacon` content-type.
- **`GET /api/config`** — `src/routes/api/public/config.ts`. The snippet's runtime config for
  a site: phase, consent mode/config, and the **anti-flicker selector set** (union of
  selectors any approved plan may touch). Heavily **edge-cached**; this is what bounds the
  anti-flicker hide (§2.4).
- **`GET /api/decision`** (Phase 3) — `src/routes/api/public/decision.ts`. Input: site key +
  signal bundle. Output: the chosen Adaptation Plan JSON (or `{plan:null}` in Learn/
  Intelligence). **Cache by `(siteKey, segmentId, extractorVersion)`**. Returns control/noop
  for the holdback group.

### Auth-gated dashboard RPC (`createServerFn`, behind `attachSupabaseAuth`)

User-scoped Supabase (RLS) so an owner only sees their sites.

- **`startCrawl(siteId)` / `getCrawlStatus(runId)`** — `src/lib/crawl/crawl.functions.ts`.
  Kicks the offline crawler; mirrors `startTestRun` in `run.functions.ts`, including the
  **lazy-import of the Browserbase chain** so it never loads at Worker init.
- **`GET /api/crawl/:runId/stream`** — crawl progress, reusing the SSE pattern in
  `$runId.stream.ts` verbatim.
- **Dashboard queries** (`getTrafficAnalytics`, `getInventory`, `getSegments`,
  `getSegmentInsights`, `getAdaptations`) — read `events_rollup`, `content_inventory`,
  `segments`. Power the recharts views.
- **Authoring/review** — `proposeAdaptations(segmentId)` (invokes `runAngel`, §7),
  `approveAdaptation(id)`, `pauseAdaptation(id)`. **Human-in-the-loop approval is a hard gate
  before `status='live'`** (see §9).

```
src/routes/api/public/ingest.ts        POST     public  CORS   (EventSink)
src/routes/api/public/config.ts        GET      public  CORS   edge-cached
src/routes/api/public/decision.ts      GET      public  CORS   edge-cached
src/routes/api/crawl/$runId.stream.ts  GET      authed  SSE
src/lib/crawl/crawl.functions.ts       serverFn authed  (lazy Browserbase)
src/lib/adapt/adapt.functions.ts       serverFn authed  (Angel authoring + review)
src/routes/app/**                      pages    authed  dashboard (recharts)
```

---

## 7. How the existing Angel pipeline plugs in

The existing pipeline is the **brain and the eyes**, reused with minimal change.

**The crawler = `freezeSite()` + the existing extractors, per URL.** A new
`src/lib/crawl/crawler.server.ts` orchestrates a URL frontier (seed = root + sitemap, which
`pageAudit` already parses). Per URL it calls `freezeSite` (consent, MHTML, capture-validity
all free) then `collect` + the `pageAudit` runner (`trustSignals`, `sections`, `ctas`). The
output is exactly the entities the inventory needs:

- `CollectedElement[]` → inventory rows for CTAs, headlines, nav items, images (each already
  carries a `buildSelector()` selector, `category`, `section`, `aboveFold`, `rect`,
  `visualWeight`).
- `TrustSignal[]` → inventory rows for testimonials, logos, badges, guarantees, security,
  social-proof (categories already match `TrustSignalType`).
- `PageSection[]` + `sectionOrder` → the section list and current order that
  `reorderSections` permutes.

Net: **the Content Inventory is a database-persisted, multi-page version of the existing
single-page `pageAudit` output.** Almost no new extraction code — a persistence + frontier
layer around proven extractors, in the offline lane, lazy-imported.

**The deterministic scorer becomes the per-segment diagnostic.** For each segment we compute
a `croProjection` of the current page plus the segment's behavioral evidence ("this segment
exits before the testimonials section at position 4"), giving the Angel grounded,
regression-stable signals.

**`runAngel()` becomes the per-segment strategy author** — new
`src/lib/adapt/angel-adapt.server.ts` mirrors `angel.server.ts` but:

- **System prompt** extends the existing `ANGEL_SYSTEM_PROMPT` (which already forbids
  inventing content — `angel.ts:186`) with: "You may only propose operations from the
  provided safe-op catalog, and may only reference elements present in the supplied Content
  Inventory. You are choosing an *arrangement* of existing content, not authoring content."
- **Input** = the segment's `croProjection` + behavioral model + the page's inventory items
  (each with id, selector, category, text) — the grounding set.
- **Output schema** = `AdaptationPlanSchema` (§3) via the existing `messages.parse`
  structured-output path (the repo already does Zod-3 → hand-written JSON-schema in
  `angel.ts`). Because the output *is* the constrained plan schema, the model is
  structurally unable to emit free content.
- The Angel's prose `rationale` is kept (on `adaptations.rationale`) for the dashboard's
  "why" — advisory, exactly as the CRO report is today, and **never** the thing applied.

**Grounding validation (the gate).** After `runAngel` returns a plan, a deterministic
`validatePlanAgainstInventory` checks every `selector`/`inventoryId` resolves to a live
`content_inventory` row at the current `extractor_version`. Only then can the plan be stored
as `proposed`. The codebase's discipline is preserved: **the LLM proposes, deterministic
code verifies, and the verified artifact is the source of truth.**

---

## 8. Privacy / consent / GDPR

Designed in, not bolted on, because the snippet touches every visitor:

- **Consent-first boot (§2.3).** No persistent storage, no cross-session identity, until
  consent resolves. Default to `anonymous_default` when no CMP is detectable.
- **Pseudonymous by construction.** `visitor_key` is a random first-party id, **hashed**
  before storage; we never store IPs, never store raw UA beyond a parsed device summary, and
  store **coarse geo** (country/region/city from `request.cf`) — never precise location. No
  PII in the firehose.
- **Server-side geo only.** The snippet sends nothing about IP/location.
- **Per-site consent policy** on the `sites` row drives behavior centrally; a strict-regime
  customer sets `consent_mode='tcf'` and we honor TCF purposes.
- **Data-subject rights primitives.** Pseudonymous, keyed rows make deletion/export by
  `visitor_key` straightforward; the firehose carries the same key for cascade deletion.
  Ship a `purgeVisitor(siteId, visitorKey)` server function from day 0.
- **Origin allow-listing** (`sites.allowed_origins`) on ingest/decision prevents a stolen
  site key from injecting events from arbitrary origins (defense in depth beyond CORS).
- **Ephemeral adaptations** leave nothing on the visitor's machine (Principle 3). A tiny
  `window.__angel` exposes opt-out + "what data" introspection for a privacy center.

---

## 9. Open decisions

These are recorded here and flagged at their target milestone; none block the foundation.

1. **Human-approved vs. fully-autonomous adaptation.** I've designed an **approval gate**
   (`proposed → approved → live`) because shipping LLM-authored DOM changes to production
   sites unreviewed is a brand/liability risk even with the safe-op constraint. The vision
   implies autonomy. The `status` field supports both; this is a launch-posture policy call.
   *(Target: M4/M5.)*
2. **Conversion definition without backend access** + statistical method. "+X% lift"
   requires a **control holdback** and significance testing, plus a per-site conversion
   definition (proxy via existing CTA clicks / thank-you-page URL patterns?). Reserved in
   `adaptation_results`; methodology is open. *(Target: M5.)*
3. **Selector stability across crawl ↔ live DOM** (highest technical risk). Mitigations are
   designed in (op-skip, plan-abort + `plan_stale`, `extractorVersion` pinning, re-crawl);
   the **acceptable failure rate** and **re-crawl cadence** (freeze already has a 90-day TTL)
   are product calls. Consider a text-anchored fallback selector per inventory row.
   *(Target: M2/M4.)*
4. **Event-volume trigger for the M6 cutover** to Analytics Engine, and **cookieless /
   consent-denied coverage** (no first-vs-returning in `anonymous_default`). *(Target: M6.)*
5. **Snippet performance budget.** < 30 KB gzip is comfortable; the anti-flicker hide is a
   real LCP/CLS risk if the eligible-selector set is large or the decision is slow. Decide
   the hard timeout (proposed 1500 ms) and whether to inline precomputed plans in
   `/api/config` to collapse two requests into one (recommended fast-follow to M4).
6. **Second Vite build for the snippet** — a dedicated `vite.config.snippet.ts` lib build so
   the snippet never imports `src/lib/**` Worker code (`src/snippet/contract.ts` is the only
   sanctioned shared module).

---

## Critical files (reuse anchors)

- `src/lib/tests/snapshot/freeze.server.ts` — the crawler engine.
- `src/lib/tests/scripts/collect.ts` — extractor + `buildSelector()` (selector authority).
- `src/lib/tests/angel.server.ts` + `angel.ts` — the grounded brain; the plan author is a
  sibling that swaps the output schema to `AdaptationPlanSchema`.
- `src/routes/api/public/corpus.$.ts` — the public/CORS route idiom the snippet APIs copy.
- `src/integrations/supabase/types.ts` (regenerated from a new `supabase/migrations/*.sql`) +
  `src/integrations/supabase/client.server.ts` — the empty schema the §5 tables fill.
- Supporting: `src/lib/tests/schema.ts` (category enum source),
  `src/lib/tests/run.functions.ts` (lazy-Browserbase pattern),
  `src/routes/api/tests/$runId.stream.ts` (SSE), `src/server.ts:41` (Cloudflare `env`).
