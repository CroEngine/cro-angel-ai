# Angel Adaptive — runtime

The adaptive layer that personalizes any website **per visitor, in real time**,
without changing the customer's codebase. This module is the clean rebuild of the
core loop described in the product blueprint.

> One snippet → read the visitor's context → decide what to show from a library
> of **safe patterns** → apply it in the browser → log the outcome. Nothing is
> invented; only content the site already published is re-surfaced. Every change
> is reversible and logged.

## The loop

```
 customer site
      │  <script src="/adaptive.js" data-site="acme">   (public/adaptive.js)
      ▼
 client signals ──POST /api/adaptive/decide──▶  buildVisitorContext (context.ts)
                                                        │
                                                 loadInventory (inventory.ts)
                                                        │
                                                 decide() (decide.ts) ──uses──▶ PATTERNS (patterns.ts)
                                                        │
      ◀──────────────── Decision { adaptations[] } ─────┘
      │
 snippet applies reversible DOM ops ──▶ POST /api/adaptive/events  (persistence.server.ts)
```

## Files

| File                               | Role                                                         | Blueprint step |
| ---------------------------------- | ------------------------------------------------------------ | -------------- |
| `types.ts`                         | Shared domain types (pure data)                              | —              |
| `context.ts`                       | Build `VisitorContext` from headers + client signals         | Step 3         |
| `inventory.ts`                     | Pure inventory surface: demo fixture + helpers (client-safe)  | Step 2         |
| `crawler-inventory.ts`             | Map crawler output → `ContentInventory` (audit + corpus)     | Step 2         |
| `inventory.server.ts`              | Resolve a site's inventory: DB → corpus → demo → empty        | Step 2         |
| `patterns.ts`                      | The fixed **Pattern Library** of safe transformations        | Step 6         |
| `decide.ts`                        | The **Adaptive Decision Engine** (rule-based, deterministic) | Step 5         |
| `persistence.server.ts`            | Best-effort event/decision logging + inventory save/load     | Step 8         |
| `index.ts`                         | Public barrel (client-safe; excludes `*.server`)             | —              |
| `../routes/api/adaptive/decide.ts` | `POST /api/adaptive/decide`                                  | Step 5         |
| `../routes/api/adaptive/events.ts` | `POST /api/adaptive/events`                                  | Step 8         |
| `../../public/adaptive.js`         | The customer snippet (vanilla, reversible)                   | Steps 1, 7     |
| `../routes/demo.tsx`               | `/demo` page proving the loop end-to-end                     | —              |

## Design choices

- **Rule-based first.** `decide()` is a pure function of `(site, context, inventory)`
  — no IO, no clock, no randomness. Same visitor → same decision → same stable
  `decisionId`. This is debuggable today and leaves a clean seam to layer the
  AI/learning engine on later ("ju mer data, desto bättre besluten").
- **Safe by construction.** The engine can only pick from `PATTERNS`. Patterns
  marked `requiresContent` are dropped when the inventory lacks the content, so
  Angel never fabricates copy.
- **Reversible.** The snippet records the original DOM before each op;
  `window.AngelAdaptive.reset()` unwinds everything. The server never mutates the
  page and persists nothing into it.
- **Fail open.** If `/decide` fails, the page is left exactly as the customer
  built it. If event persistence is unavailable, the loop still runs.

## Try it

```bash
bun run dev
# open /demo and use the simulator bar to switch visitor scenarios
```

Run the engine tests:

```bash
bun run vitest run src/adaptive
```

## Content inventory: where it comes from

`resolveInventory(site)` (server) resolves a site's inventory in priority order:

1. **Database** (`angel_content_inventory`) — the crawler's persisted output,
   written by `saveInventory(mapAuditToInventory(audit))`.
2. **Corpus golden** — real captured sites bundled in `corpus/` (e.g. `hubspot`),
   adapted by `mapGoldenToInventory`.
3. **Demo fixture** (`site === "demo"`).
4. **Empty** — the engine then applies only content-free patterns.

Two mappers, because the crawler has two output shapes:

- `mapAuditToInventory(audit)` — the **full live crawler output** (`PageAuditData`),
  which keeps the **selectors** the snippet needs to target real DOM. This is the
  production path: crawl → map → `saveInventory` → DB.
- `mapGoldenToInventory(golden)` — the **reduced corpus snapshot**. Selectors are
  stripped in golden, so this recovers the text slots (CTA labels, headlines,
  microcopy) and records reveal/reorder slots as *present*; full DOM targeting
  needs the live crawler's pre-persistence output.

Both only ever copy published text — CTA intents are inferred from the label
(`classifyCtaIntent`) and microcopy is matched against published phrases
(`extractMicrocopy`); nothing is fabricated.

## Status

Done: snippet, context, pattern library, decision engine, decide + events
endpoints, demo page, schema migration, unit tests, and the **crawler →
inventory** pipeline (mappers + `resolveInventory` + DB save/load), verified
against the real HubSpot corpus.

Next: run the live crawler/orchestrator to persist real per-site inventory
(`saveInventory`) so selector-backed patterns target production DOM; apply the
migration in Lovable Cloud and regenerate `integrations/supabase/types.ts`; then
build the customer dashboard (Overview, Segments, Live Adaptations, Performance,
Content Inventory) on the `angel_events` data.
