## Execute Part A (dev-machine) + Part B (read-only investigation) in parallel

Both threads from the v3 plan, run together. Part A needs a dev machine with chromium; Part B is read-only and runs anywhere.

### Part A — Corpus acceptance (dev machine)

1. **Chromium install.** `npx playwright install chromium` on the dev machine. Sandbox can't do this — confirmed by today's `THROW (launch: Executable doesn't exist ...)` on both `hibob` and `hubspot`.
2. **Run canary:** `bun run scripts/render-canary.ts --all`. Capture stdout + the two `corpus/<site>/render-canary.families.json` receipts.
3. **Triage per `gate1.reason`** (rules from v3 plan, unchanged):
   - `ok` → record A3 receipt paragraph, proceed.
   - `metric_twin` → A1 side-by-side inspection (family-applied vs forced-system-fallback crop). Verdict `confirmed-coincidence` or `confirmed-degenerate-cid`. Do NOT auto-pass.
   - `fallback` → unicode-range exclusion is the primary suspect (A2 now routes correctly). Fix sample text or the served face's range.
   - `check_mismatch` → write a Vitest case for the offending family-pair FIRST, then canonicalize in `mhtml-fonts.server.ts`.
   - `unresolved` → real MHTML extraction bug vs. legitimately-missing face. `loadError` disambiguates.
   - `timeout` on `file://` → page-eval ordering bug in `render-canary.server.ts`. Near-zero expected.
4. **Gate 2 opt-in re-run.** Diagnostic only in v1; `drift` rows surface families for a future subset ticket.
5. **Update `.lovable/plan.md` Part 2 outcome** with per-family counts, `metric_twin` inspection verdicts, Gate-2 drift findings, plus the A3 paragraph verbatim.

No edits to `canary-constants.ts` in response to corpus results.

### Part B — Scope the workerd SSE-cancellation ticket (read-only, sandbox-OK)

1. **Confirm relay-only architecture.** Read `src/routes/api/tests/$runId.stream.ts` end-to-end. Look for: run-driving (does GET start anything?), awaits reaching `harness.server` or `freeze.server`, sync work before first `controller.enqueue`. If GET both starts and drives the run, architecture drifted — that's the bug to file; stop B here.
2. **Capture the cancel-reason string.** Hit `/api/tests/<runId>/stream` against the workerd preview with a known runId; record exact string from worker logs. Disambiguators:
   - "code had hung" → (a) byte-silent first-event window OR (b) detached producer pump
   - "exceeded CPU" → (d) per-event sync work in handler
   - 500-class stream error → producer threw (not a runtime cancel)
   - Clean "Workers runtime canceled this request" → evidence AGAINST the fs hypothesis from Part 1
3. **Pick cause from (a)–(d) by signature.** No preselection.
4. **Write ticket** in `.lovable/plan.md` "Open ticket" section with:
   - Reproduction command
   - Exact cancel-reason string
   - Confirmed architecture (relay-only or drifted)
   - Picked cause
   - Matching remediation:
     - (a)+(b) → SSE preamble/heartbeat (`:\n\n` on connect) + retain pump promise on request scope
     - (c) → **DO-backed, with resumable-SSE semantics optionally layered on top** (resumable-SSE alone collapses into DO because in-memory pub/sub has no replay log and Worker isolates are non-sticky)
     - (d) → identify and remove per-event sync work from the relay handler
   - Framing: "cheap fix and architectural fix share a symptom; the reason string picks"

No code changes in Part B this round.

### Sequencing

Part A and Part B in parallel. Part B's eventual remediation commit does not inherit Part A's acceptance commit (separate bisectable changes).

### Out of scope

- Fixing SSE
- Subset algorithm changes
- Phase 2(b) Worker-orchestration move
- `canary-constants.ts` default changes
- UI changes

---

## Execution outcomes (2026-06-15)

### Part A — blocked at step 1 (sandbox limitation, not a code issue)

Re-tried after `npx playwright install chromium` succeeded (113 MiB downloaded to `/chromium_headless_shell-1223`). Launch then failed with:

```
[pid=…][err] /chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell:
  error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file
```

The sandbox image is missing chromium's GTK/X11 system libs. `playwright install-deps` requires root `apt-get`, not available here. Both `hibob` and `hubspot` runs exited with `launch: Target page, context or browser has been closed`.

**Status:** Part A genuinely cannot run in this sandbox. Step 1 must run on a dev machine that has `libatk-1.0`, `libnss3`, `libcups2`, `libxkbcommon0`, `libxcomposite1`, `libxdamage1`, `libxrandr2`, `libgbm1`, `libpango-1.0`, `libcairo2`, `libasound2` installed (typical `playwright install-deps` set on Ubuntu). Tests (`render-canary.test.ts`) already skip cleanly in this environment via the existing chromium-availability probe — no test changes needed.

**Hand-off command for dev machine:**
```
npx playwright install --with-deps chromium
bun run scripts/render-canary.ts --all
```
Then resume at v3 Part A step 3 (triage by `gate1.reason`).

### Part B — Ticket (read-only investigation complete)

**Reproduction command** (dev machine, requires a real runId from a started run):
```
# Terminal 1
bun run dev:worker
# Terminal 2 — start a run via UI or POST /api/tests/run, note the runId
curl -N http://localhost:8787/api/tests/<runId>/stream
# Watch terminal 1 for the workerd cancel-reason line
```

**Architecture: confirmed relay-only.** `src/routes/api/tests/$runId.stream.ts` GET handler only:
1. Looks up the run via `getRun(runId)` (returns 404 if absent — that's the Part-1 regression guard, intact).
2. Constructs a `ReadableStream` whose `start(controller)` writes an immediate `": connected\n\n"` preamble.
3. Calls `subscribe(runId, listener)` from `orchestrator.server.ts`. The listener writes one `event:` + `data:` frame per orchestrator event, calls `controller.close()` + `unsub()` on `done` / `error`.

No run-driving, no awaits reaching `harness.server` or `freeze.server`, no fs writes, no module-init side effects. **The fs hypothesis from Part 1 is excluded by static analysis** — exactly as v3 B2 said it would be under relay-only.

**Cause picked (subject to live reason-string capture): not pure (a), not (b), most likely a heartbeat-interval variant of (a) or (c).**

Static evidence narrows the (a)–(d) set further than v3 anticipated:

- **(a) pure byte-silent first-event window — partially eliminated.** The handler already writes `": connected\n\n"` synchronously inside `start(controller)`. First bytes flow before any orchestrator event. So the *first-event* form of (a) is excluded.
- **(a-variant) periodic-heartbeat absence — still plausible.** workerd's "code had hung" can fire on lack of *ongoing* progress, not just zero-bytes-ever. An 11-byte preamble + then several seconds of silence before the orchestrator's first `session_started` event would re-trigger the cap. Repro shows cancel "~2s after run start" (from Part 1 step 4) — consistent with this if Browserbase/Stagehand init takes >2s to produce the first event.
- **(b) detached producer pump — eliminated.** The `subscribe` listener closure is held by `orchestrator.server.ts`'s module-scope `runs.get(id).listeners: Set<Listener>`. Heap-reachable independent of the stream's own scope. As long as the Run exists in the module-scope `runs` Map (it does — entries are removed only 30s after `terminate()`), the listener survives. No external pump promise to retain.
- **(c) request-lifetime / streaming-duration cap — plausible, secondary.** Orchestrator's `HARD_TIMEOUT_MS = 300_000` (5 min) is the upper bound. workerd's SSE streaming cap interacts with this on long runs. **But the 2s observed cancel is inconsistent with a duration cap firing** — duration caps fire at the cap, not at 2s. (c) is the right framing for *long-run* cancels, not the 2s symptom.
- **(d) CPU time exceeded — eliminated.** Handler does no per-event sync work beyond `JSON.stringify(event.data)` + `controller.enqueue`. Negligible.

**Primary remediation (a-variant): periodic heartbeat + retain preamble.**
- Keep the connect preamble.
- Schedule a `setInterval(() => write(": keepalive\n\n"), 15_000)` inside `start(controller)`, cleared on `controller.close()` and inside the `done`/`error` branches of the subscribe callback.
- Two-line-ish change, separate commit.

**Secondary remediation (c) if heartbeat doesn't resolve long-run cancels:** DO-backed, with resumable-SSE semantics optionally layered on top. Resumable-SSE alone collapses into DO because:
- The orchestrator is pure in-memory pub/sub — no replay log for `Last-Event-ID` reconnect to read from.
- Worker isolates are ephemeral and non-sticky — a reconnect lands on a fresh isolate with zero memory of the run.
- These are the same property: leak-freeness == non-durability == no reconnect substrate.

So the realistic (c) follow-up is **DO-backed first, resumable-SSE optional on top** — not "pick one." Recording this so the (c) ticket doesn't open by trying naive `Last-Event-ID` against stateless pub/sub.

**Framing:** Cheap fix (heartbeat for a-variant) and architectural fix (DO+resumable for c) share the "stream died" symptom. The reason string + the duration-until-cancel together pick: ≤a few seconds → heartbeat; near 5-min HARD_TIMEOUT or scaling with run length → DO.

**Side observation (not the cancel cause, file as separate small leak):** The `ReadableStream` has no `cancel(reason)` handler. If a client disconnects mid-run, `unsub()` is never called and the listener leaks in `runs.get(id).listeners` until `terminate()` runs 30s after the run ends. Fix: add `cancel() { unsub(); }` to the stream init object, hoisting `unsub` out of `start`. Not blocking; ship with the heartbeat commit.

**Cancel-reason string: NOT YET CAPTURED.** Static analysis exhausted what can be concluded without running the workerd preview + starting a real Browserbase-backed run. Next dev-machine session runs the reproduction command above, captures the exact string, then matches against the remediation table here.
