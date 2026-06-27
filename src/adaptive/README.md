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
| `inventory.ts`                     | Content inventory access (demo fixture + loader seam)        | Step 2         |
| `patterns.ts`                      | The fixed **Pattern Library** of safe transformations        | Step 6         |
| `decide.ts`                        | The **Adaptive Decision Engine** (rule-based, deterministic) | Step 5         |
| `persistence.server.ts`            | Best-effort event/decision logging (server only)             | Step 8         |
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

## Status (this milestone: end-to-end thin slice)

Done: snippet, context, pattern library, decision engine, decide + events
endpoints, demo page, schema migration, unit tests.

Next: persist a real per-site content inventory from the existing crawler
(`scripts/freeze-*`, `src/lib/tests`), apply the migration in Lovable Cloud and
regenerate `integrations/supabase/types.ts`, then build the customer dashboard
(Overview, Segments, Live Adaptations, Performance, Content Inventory) on the
`angel_events` data.
