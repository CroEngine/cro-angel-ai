## Phase 2(a) — Lazy-load Stagehand chain inside `startTestRun` handler

### Static-graph trace (the load-bearing claim, now verified, not asserted)

You're right that the payoff depends on *every* static path from a Worker route entry being free of the heavy chain — not just `run.functions.ts`. Traced before writing this plan:

Worker route entries that exist today: `src/routes/index.tsx`, `src/routes/corpus.tsx`, `src/routes/api/tests/$runId.stream.ts`, `src/routes/api/public/corpus.$.ts`, plus `__root.tsx`. Static reach into Stagehand/Browserbase/MCP/Playwright:

- `routes/index.tsx` → `BrowserShell.tsx` (client component) → `@/lib/tests/run.functions` → **`./browserbase.server`** (static) and **`./engine.server`** (static, value import) → Stagehand + MCP + pkce-challenge. **This is the only live static path into the heavy chain from any Worker entry today.** This is exactly what 2(a) cuts.
- `routes/api/tests/$runId.stream.ts` → `@/lib/tests/orchestrator.server`. Verified: `orchestrator.server.ts` has **zero** non-type imports (`rg "^import" src/lib/tests/orchestrator.server.ts` returns nothing). The "pure in-memory pub/sub" claim isn't asserted, it's transitively confirmed.
- `routes/corpus.tsx` → `@/lib/corpus.functions` → `node:fs`, `node:path`. No edge to the chain.
- `routes/api/public/corpus.$.ts`, `__root.tsx`: no edge to the chain.

Harness / freeze / render-canary / externalize / mhtml-fonts: imported only from `scripts/*.ts` (Node bin) and `src/lib/tests/snapshot/__tests__/*.ts` (vitest). No file under `src/routes` or `src/components` imports them (`rg` confirmed). They are not in the Worker bundle today, and 2(a) doesn't need to touch them. Tracked as a follow-up *invariant*, not a fix: any future static import from a route into `harness.server` / `freeze.server` would re-leak Stagehand and silently defeat 2(a).

So the precondition for 2(a) being meaningful is met: `run.functions.ts` is the single static bridge, and cutting it removes the chain from the Worker isolate-init graph.

### Change set

Edit `src/lib/tests/run.functions.ts`:

1. Remove the two top-level value imports:
   ```ts
   // delete
   import { createSession, closeSession } from "./browserbase.server";
   import { runSteps, type Step } from "./engine.server";
   ```
2. Re-add the `Step` symbol as a pure type import (erased by esbuild — contributes nothing to the runtime graph; keep it literally `import type` so a future refactor can't accidentally promote it back to a value import):
   ```ts
   import type { Step } from "./engine.server";
   ```
3. Inside `startTestRun.handler()`, dynamic-import both modules just before the first use, in parallel:
   ```ts
   const [{ createSession, closeSession }, { runSteps }] = await Promise.all([
     import("./browserbase.server"),
     import("./engine.server"),
   ]);
   ```
   Failure mode is a named/default export mismatch — caught the first time Run is clicked in step 5 below.
4. `stopTestRun` is untouched — orchestrator-only, already clean.

That's the whole edit. The `pkce-challenge` alias in `vite.config.ts` stays (Rollup still resolves dynamic import targets at build time — your earlier note is the reason).

### What this buys / does NOT buy

Buys: Stagehand / Browserbase / MCP move out of Worker isolate-init evaluation into a lazy chunk loaded only when `startTestRun` is invoked. A top-level throw inside any of those packages can no longer kill `/corpus` or unrelated pages — it becomes a per-request error on Run-click, with a real stack.

Does NOT buy: alias removal. Does NOT change the runtime path of an actual Run — Stagehand still drives Browserbase over CDP/WS at request time, which is fine in workerd (you're right that the earlier "Playwright can't run there" objection was wrong — remote-CDP is HTTP/WS).

### Verification — gated on workerd, not Vite dev

Vite dev's module runner loads on demand, so "no Stagehand lines in dev log on `/corpus` load" passes trivially even if the production bundle still evaluates the chain at isolate init. That's a false green. Verification has to run against the workerd preview that `build:dev` produces.

1. `bun run build:dev` exits 0. (Alias still doing its job.)
2. **Static-graph re-check** after the edit, before any runtime test:
   ```
   rg "from ['\"].*(engine|browserbase|stagehand|harness|freeze|render-canary|externalize|mhtml-fonts)" src/routes src/components src/lib
   ```
   Expected: zero matches in `src/routes/**`, `src/components/**`, or `src/lib/**.functions.ts` outside of dynamic `import()` calls and `import type` lines. Any static value import from those paths re-opens the leak.
3. **Workerd preview load test.** Start the preview (the actual built Worker, not Vite dev), cold-load `/`, `/corpus`, and hit `/api/tests/anything/stream`. Watch the Worker logs for the `[unenv] X is not implemented yet!` class and any Stagehand/MCP module-init line. Expected: silent on load for all three. If anything from the chain shows up here, 2(a) is a no-op and the static trace missed an edge — re-run step 2.
4. **Workerd Run-click test.** Click Run on `/`. Expected: the same `[unenv] / Stagehand init` lines we want to see at request time, *now* — proving the chain moved from init to per-request, not that it disappeared. (If we see *nothing* at Run-click either, the dynamic import didn't resolve — named/default mismatch in step 3 of the edit.)
5. Full happy path on Run: `session_started` arrives, live iframe loads, steps execute, terminal event fires. Catches the export-shape failure mode for the lazy-import.

Done = steps 2, 3, 4 all pass against the workerd preview. Dev-server log alone does not count.

### Out of scope (explicitly)

- Phase 2(b): moving live-Browserbase orchestration to a separate Node process so the Worker becomes a thin proxy. That's what drops the alias and structurally guarantees the harness/freeze invariant. Separate ticket.
- Switching alias target between `index.node.js` and `index.browser.js`. Don't conflate.
- Render-canary, freeze pipeline, externalize, client code, UI.

### Risk

Low. Mechanical edit, exported names already known, one failure mode (export-shape mismatch) caught immediately by step 4–5. Cold-isolate cost on first Run is module evaluation of the lazy chunk (not a fetch) — once per isolate, on a user click. Acceptable.
