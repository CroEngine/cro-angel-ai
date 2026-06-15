## Goal

Get `build:dev` green now, then remove the underlying disease (Stagehand/Browserbase/MCP chain bundled into the Worker) so the alias can be deleted.

## Diagnosis (corrected)

The import chain dragging `pkce-challenge` into the Worker bundle is NOT through `$runId.stream.ts`. That route only touches `orchestrator.server.ts`, which is pure in-memory pub/sub — no Stagehand, no MCP.

The actual leak:

```
src/components/browser-shell/BrowserShell.tsx           (client component)
  → import { startTestRun, stopTestRun } from "@/lib/tests/run.functions"
    → run.functions.ts (top-level imports):
        ./browserbase.server     → @browserbasehq/stagehand → @modelcontextprotocol/sdk → pkce-challenge
        ./engine.server          → ./runners/pageAudit.server → stagehand chain
```

Server-function modules (`*.functions.ts`) are part of the client/Worker module graph — only the `.handler()` body is stripped. Every top-level import in `run.functions.ts` is therefore evaluated at Worker isolate init. That is why a UI button on `/corpus` pulls Playwright-grade machinery into workerd.

## Phase 1 — Land the alias (5-minute unblock)

Edit `vite.config.ts`:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  vite: {
    resolve: {
      alias: {
        "pkce-challenge": fileURLToPath(
          new URL("./node_modules/pkce-challenge/dist/index.node.js", import.meta.url),
        ),
      },
    },
  },
});
```

Notes on the previous critique:

- Global `resolve.alias` is acceptable because `pkce-challenge` is only reachable from `.server`-gated code; client bundles never see it.
- Picking `index.node.js` over `index.browser.js` is a judgment call. `index.browser.js` uses Web Crypto (native in workerd) and avoids the `nodejs_compat` shim, which is the safer target IF the alias survives long-term. Phase 1 picks `index.node.js` because that path is already validated by users of `@modelcontextprotocol/sdk` in Node tooling — fewer surprises. Revisit if we keep the alias.

### Verification gate before declaring Phase 1 done

Resolution success ≠ Worker boot success. After the build is green:

1. `bun run build:dev` exits 0.
2. Open `/corpus` in preview, **then** open `/api/tests/anything/stream` (404 expected — what we're testing is that the route module evaluates without throwing during isolate init). If the worker can't boot the chain, we see a 500 with the SSR error wrapper output, not a 404.
3. Hit `/` and `/corpus` and confirm normal render. Watch dev-server logs for any `[unenv] X is not implemented yet!` or `__dirname is not defined` lines — those mean Stagehand/Playwright/Browserbase top-level code is failing under workerd even though the build passed.

If step 2 or 3 fail, we go straight to Phase 2 — alias is not enough.

## Phase 2 — Sever the chain (the actual fix)

The Worker never needs Stagehand/Browserbase/Playwright/MCP at runtime. The freeze pipeline runs under `bun run scripts/freeze-site.ts` (Node). The render-canary runs under `bun run scripts/render-canary.ts` (Node). The `/api/tests/$runId/stream` route is pure SSE over an in-memory bus.

The remaining question: does `startTestRun`/`stopTestRun` (called from `BrowserShell.tsx`) need to actually drive Browserbase from inside the Worker?

- If **no** (the UI is just replaying frozen runs / triggering work that lives elsewhere), the fix is to delete the static imports from `run.functions.ts` and move the Stagehand-using code paths to a Node service or to dynamic-load only in environments where the chain works.
- If **yes** (the UI really does start live Browserbase sessions from the Worker today), then `run.functions.ts` is mis-targeted: Playwright/child_process don't work in workerd at all (see server-runtime card). That's a target/architecture issue, and the alias is masking a runtime failure that just hasn't been hit yet because nobody clicks "start run" in preview.

### Investigation (no edits yet)

1. Read `BrowserShell.tsx` end-to-end to see what `startTestRun` is expected to do in preview.
2. Read `run.functions.ts` handlers to see whether `createSession`/`runSteps` are reached at request time, or only as types.
3. Decide: severance pattern (a) or (b):
   - **(a) Lazy-load inside the handler.** Replace top-level `import { createSession } from "./browserbase.server"` with `const { createSession } = await import("./browserbase.server")` inside `.handler()`. This still gets resolved and chunked by Rollup, but it isolates the chain into a separate chunk that workerd never loads unless the handler runs — and gives us a clear runtime error if someone actually invokes it in preview. **Verifies the "static import is the leak" hypothesis.**
   - **(b) Move the orchestration entirely out of the Worker.** `run.functions.ts` becomes thin: it validates input and writes a job record; a separate Node process (the same one that runs `freeze-site.ts`) picks it up. The Worker only does SSE replay via `orchestrator.server.ts`. This is the right end-state if the UI is meant to drive real runs in production.

Phase 2 lands (a) first as a smaller change that should already let us drop the alias. (b) is tracked as a follow-up if the runtime semantics demand it.

### Fallback if Phase 2(a) still trips resolution

Add SSR `resolve.conditions` widening (better than alias because it fixes a class of failures, not one package):

```ts
vite: {
  environments: {
    ssr: {
      resolve: {
        conditions: ["workerd", "worker", "node", "import", "module", "browser", "default"],
      },
    },
  },
}
```

## Out of scope

- Render-canary, externalize, freeze pipeline — untouched.
- Client-side code paths and existing UI — untouched.
- Replacing Browserbase/Stagehand with a workerd-native solution — separate ticket if Phase 2(b) becomes necessary.

## Done definition

- `build:dev` green.
- `/corpus`, `/`, and `/api/tests/<id>/stream` all boot their route modules without isolate-init errors in dev-server logs.
- Alias either deleted (Phase 2(a) worked) or explicitly accepted as a known temporary with a tracked follow-up ticket.
