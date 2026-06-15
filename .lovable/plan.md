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