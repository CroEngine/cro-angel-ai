## Two-part plan: close 2(a) on workerd evidence, then ship Gate-1/Gate-2 canary

### Part 1 — Workerd preview verification

Reason: deferring is unbounded. The canary work is Node-side (`scripts/render-canary.ts` → `harness.server` → playwright on disk MHTML); nothing in Part 2 produces a Worker bundle, so without Part 1 the verification slides until an unrelated deploy.

Protocol:

1. `bun run build:dev` — exit 0.
2. Start the workerd preview (the wrangler/workerd one `build:dev` produces — **not** the Vite dev server we tested freeze on).
3. **Cold-load test.** Hit `/`, `/corpus`, and `/api/tests/anything/stream` (404 expected) on a fresh isolate. Watch worker logs for `[unenv] X is not implemented yet!`, any `Stagehand`/`pkce-challenge`/`@modelcontextprotocol` module-init line, any module-scope env-missing throw.
   - Pass: silent at load. The chain is no longer in isolate-init.
   - Fail: re-run `rg` for static imports of `engine|browserbase|stagehand` from anything reachable by a route; trace missed edge.
4. **Run-click test.** Click Run on `/` with default URL. Triage the three possible outcomes:
   - **Silent on click, no fetch fires** → dynamic-import destructure failed on a named/default export mismatch in `run.functions.ts`. Mechanical fix.
   - **`startTestRun` throws** (`[unenv]` / `fs` / `ENOENT` / native-binding-class) → **not a name fix**. This is the first time the request-time chain executes under workerd at all; Vite-dev hid it because Vite-dev runs in real Node with a real filesystem. The freeze path (`harness.server` / `freeze.server`) writes to `corpus/<name>/…` from the script side; if any code reachable from `startTestRun` also writes to disk, workerd has no fs and rejects. Remediation is architectural (freeze-to-stream, R2/KV, or "the Worker run path never freezes, only streams events; the script path is the only writer"), not a typo. Out of Part 1's scope — file as a real ticket, do not jam it into 2(a).
   - **Reaches frozen with overlays + N datapoints** → ticket closes. Confirm separately that the run-click path holds results in-memory and streams to the client only; do not let Vite-dev's success stand in for that confirmation.
5. Alias stays as known-temporary with a one-line note in `.lovable/plan.md` pointing at Phase 2(b).

Expected code changes: zero (or the one name-fix in 4-silent).

### Part 2 — Render-driven canary with explicit Gate 1 and Gate 2

The current `render-canary.server.ts` does most of Gate 1 (fallback width-diff + `document.fonts.check` tie-breaker). Gaps:

- **Family identifier is the load-bearing input and isn't pinned.** `document.fonts.load`/`check` key off an exact match to the `@font-face` `font-family` descriptor — quoting, casing, declared-name vs used-name all matter. If `expectedFamilies` comes from CSS `font-family` properties (fallback lists, inconsistent quoting) instead of the descriptor verbatim, every Gate-1 measurement is noise. **This is the analog of "orchestrator.server must be transitively clean": pin the source.**
- **`timeout` is the wrong name for the failure the canary exists to catch.** An unresolvable `cid:` under `file://` rejects fast — `document.fonts.load` *rejects*, it doesn't hang. A `timeout`-only enum mislabels the headline diagnostic and burns the full timeout in negative Vitest cases.
- **Gate 2 absent.** Subset-vs-original face comparison doesn't exist.
- **Gate-2-by-width is blind to outline/hinting drift that preserves advance width.** Catches advance + kerning corruption (`GPOS` drops), misses shape corruption. Naming this boundary is a choice we make explicitly.
- **Gate-1 logic has a hidden hole.** `delta_load > EPS && fontsCheck === false` (width says loaded, check says no) currently falls through to `ok`, but that combination is usually a `fonts.check` false-negative from the family-string mismatch above. Calling it `ok` hides a misconfiguration; it deserves its own reason.
- **Determinism knobs not pinned.** DPR must be set at context creation, not after.
- **No per-family JSON receipt on disk.**

Concrete change set:

1. **New module `src/lib/tests/snapshot/canary-constants.ts`** — exports:
   - `CANARY_SAMPLE_TEXT` (40–60 chars, mixed letters + digits)
   - `EPSILON_LOAD_PX` (Gate 1; default 2px)
   - `EPSILON_FIDELITY_PX` (Gate 2; default 0.5px)
   - `CANARY_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 }`
   - `FONT_LOAD_TIMEOUT_MS` (default 3000) — **overridable per call** via `runRenderCanary` opts so Vitest negative cases don't each wait the full timeout.
   Imported by `render-canary.server.ts` AND the Vitest path. No literal copies.

2. **Pin family-source contract.** `expectedFamilies` MUST be the verbatim `@font-face` descriptor strings, sourced from the snapshot manifest (the same place the cid: faces are declared), not from any computed `font-family` in the DOM. Helper `extractDeclaredFamilies(mhtml)` in `mhtml-fonts.server.ts` becomes the single producer; `harness.server` consumes it; `render-canary.server.ts` receives them unchanged. Add a Vitest case asserting that a manifest with `"font-family": 'Sentinel A'` (no quotes wrapping the value) and a CSS rule using `font-family: "Sentinel A"` resolve to the same canonical descriptor going into the canary.

3. **Extend `FamilyReport`**:
   ```ts
   gate1: {
     wWith: number; wFallback: number; deltaLoad: number;
     fontsCheckPass: boolean;
     pass: boolean;
     reason: "ok" | "unresolved" | "fallback" | "metric_twin" | "check_mismatch" | "timeout";
     loadError?: string; // populated when reason === "unresolved"
   };
   gate2?: {
     wOrig: number; deltaSubset: number;
     pass: boolean;
     reason: "ok" | "drift" | "skipped";
   };
   ```
   Old `widthVsFallback` field retained as deprecated alias one cycle.

4. **Reason enum semantics** (this is the table consumers will read):
   - `unresolved` — `document.fonts.load` rejected (the cid:-fast-reject case). Captures `loadError.message`. **Gate-1 fail.** This is the headline diagnostic, not `timeout`.
   - `timeout` — `Promise.race` against `FONT_LOAD_TIMEOUT_MS` lost. **Gate-1 fail.** Genuinely rare on `file://`; mostly indicates network face that hung.
   - `fallback` — load resolved, but `delta_load <= EPS` AND `fontsCheckPass === false`. Page is using fallback despite "load success" — silent fall-through. **Gate-1 fail.**
   - `metric_twin` — load resolved, `fontsCheckPass === true`, but `delta_load <= EPS`. Loaded font is metric-compatible with its fallback. **Gate-1 pass** (closes the hole you flagged), logged.
   - `check_mismatch` — `delta_load > EPS` (width says loaded) AND `fontsCheckPass === false`. Strongly suggests family-string mismatch between manifest and `@font-face` descriptor. **Gate-1 fail** with explicit "canary of the canary" reason — refuses to silently pass on a misconfiguration.
   - `ok` — `delta_load > EPS` AND `fontsCheckPass === true`.

5. **Page-eval mechanics**:
   - `Promise.race([document.fonts.load(\`1em "${family}"\`, sample).then(() => "loaded").catch((e) => ({ error: e.message })), timeoutP])` per family. Branch into `ok`/`unresolved`/`timeout` from the race result, then continue to width measurement only when not `unresolved`/`timeout` (we still measure for the receipt, but the reason is already set).
   - Measuring node is `position:absolute; left:-99999px; visibility:hidden; white-space:pre`, **NOT `display:none`**. A `display:none` node reports 0 width and may skip face load — nulls the measurement.
   - `family` substituted into the page-eval is quoted exactly once: `\`"${family.replace(/"/g, '\\"')}"\``.

6. **Gate 2 (optional, flag on opts)**: register a `FontFace` from the *original un-subset* file URL (stored alongside the subset in the snapshot manifest as `originalUrl`), `await face.load()`, append to `document.fonts`, measure `w_orig`, `delta_subset = |w_with - w_orig|`, pass = `delta_subset < EPSILON_FIDELITY_PX`. Reason `drift` vs `ok`. **Documented boundary**: this catches advance/kerning drift only. Outline/hinting drift that preserves advance width is invisible to width-diff — out of scope for v1; raster diff is a future ticket.

7. **Pin DPR at context creation** in `harness.server`: `browser.newContext({ viewport: CANARY_VIEWPORT, deviceScaleFactor: 1 })`. Setting `deviceScaleFactor` *after* `setViewportSize` does not retroactively re-render — must be at context init.

8. **Per-family receipt**: `corpus/<name>/render-canary.families.json` — one row per family with full `gate1` + `gate2` objects. Written by `harness.server` after the canary returns. On `unresolved` the receipt names the family + the load error — that's the cid-resolution diagnostic, surfaced.

9. **Vitest coverage** in `src/lib/tests/snapshot/__tests__/`:
   - Synthetic MHTML fixture, two faces: one cid: that resolves, one cid: that 404s in the MHTML map → assert `gate1.reason === "ok"` and `gate1.reason === "unresolved"` (NOT `timeout`) with a non-empty `loadError`.
   - Family-descriptor canonicalization test (point 2 above).
   - Gate 2: same face served twice (original + a deliberately advance-mangled subset variant) → assert `gate2.pass === false, reason === "drift"`. Pass `FONT_LOAD_TIMEOUT_MS: 200` via opts so negative cases don't each wait 3s.
   - All tests import `CANARY_SAMPLE_TEXT` / `EPSILON_*` from `canary-constants.ts` — drift in the constants breaks tests, not silently weakens production gates.

10. **Run against corpus**: `bun run scripts/render-canary.ts --all`. Acceptance: HiBob + HubSpot all families pass Gate 1 with `reason: "ok"` (no `metric_twin` slips, no `check_mismatch` slips). Gate 2 either all-pass or surfaces specific families — either outcome is real signal.

### Sequencing

Part 1 first (5 min pre-flight). Part 2 blocks on Part 1 passing (don't tangle a workerd-leak fix with constants/gates rewrites — that commit can't be bisected). If Part 1 step 4 surfaces a request-time `fs`-class throw, that's a separately scoped ticket, NOT inline remediation here.

### Out of scope

- Phase 2(b) (move orchestration out of Worker).
- Freeze-to-disk → freeze-to-stream refactor if step 4 surfaces it.
- Switching alias target.
- Subset algorithm itself — Gate 2 measures it, doesn't change it.
- Raster-diff Gate 3 for outline/hinting drift.
- UI / orchestrator changes.

---

## Part 1 outcome (2026-06-15)

- Cold-load on workerd preview (id-preview deploy): silent. No `[unenv]` / Stagehand / pkce-challenge / MCP module-init lines on `/` or `/corpus` loads. Phase 2(a) closed on real workerd evidence.
- Run-click `_serverFn/startTestRun` POST returns 200 on workerd — chain executes at request time as designed.
- `pkce-challenge` alias in `vite.config.ts` stays as known-temporary; structural fix is Phase 2(b).

## Open ticket spawned from Part 1 step 4

- **SSE stream cancellation under workerd.** `GET /api/tests/<runId>/stream` returns 0 with "Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response", ~2s after the run starts. Reproduced ≥4× in worker logs. Not caused by 2(a) (route only touches `orchestrator.server`, which is unchanged). Likely Worker request-lifetime / CPU-time cap interacting with the long-lived subscription. Out of scope for the canary work; should be triaged before any UI-driven Run is shipped to a public audience. Scoping protocol now lives in "Next round — corpus acceptance + SSE scoping" below.

---

## Next round — corpus acceptance for the canary + SSE ticket scoping (v3)

### Part A — Corpus acceptance

**A1. `metric_twin` is inspect-required, not auto-pass.**
On distinctive brand faces an observed `metric_twin` is more likely a cid that resolved to a structurally-valid-but-wrong body (parseable face → `fonts.check === true`, glyph metrics collapsed toward fallback) than a genuine width coincidence. Treat as Gate-1 inspect-required.
**Inspection artifact = side-by-side crop**, family-applied vs forced-system-fallback (inject a stylesheet that drops the declared family and re-render). Family-only crops don't show the delta. Receipt stores both crop paths + verdict (`confirmed-coincidence` | `confirmed-degenerate-cid`). Rule lives in the acceptance protocol; `render-canary.server.ts` does not auto-pass `metric_twin`.

**A2. Page-eval discriminator for `document.fonts.load → []`.**
Empty result has two distinct causes per the CSS Font Loading spec:
1. No registered FontFace has a matching family descriptor → genuine name mismatch → `check_mismatch`, fix in `mhtml-fonts.server.ts` canonicalization.
2. A matching descriptor exists but its `unicode-range` excludes the sample text → face filtered before loading, identical empty array, completely different root cause. Most likely `fallback` cause on real marketing sites (split latin / latin-ext / cyrillic subsets are exactly what HiBob/HubSpot serve).

Discriminator inside the empty branch: iterate `document.fonts` for a FontFace whose family descriptor matches (case/quote-normalized). Match → fall through to normal width+check path (yields `fallback`). No match → `check_mismatch` with `loadError: "no face matched descriptor"`.

**A2 tests run in the Playwright harness, not jsdom.** Behavior under test is CSS Font Loading semantics — unicode-range honored at load time, FontFace registration. jsdom's `document.fonts` is a non-functional stub that won't reproduce empty-on-out-of-range. A jsdom version locks in nothing; keep in-browser or it's decorative. Two cases, both required (or the test locks in the collapse):
- FontFace `"Brand"` with `unicode-range: U+0041-005A`, sample `"abc"` → empty load, descriptor match found → `fallback` (NOT `check_mismatch`).
- Same FontFace registered, query family `"Brnad"` → empty load, no descriptor match → `check_mismatch`.

**A3. Receipt language paragraph (verbatim in Part 2 outcome):**
*Gate 1 certifies a non-system-fallback face took effect for the sample text. It does NOT certify correct glyphs rendered. A structurally-valid-but-wrong face body can slip green through `ok` (advances differ from fallback) or `metric_twin` (they don't); the inspect-required rule on `metric_twin` catches the second case, the first is acceptable v1 because the canary's threat model is resolve-vs-not-resolve under `file://`. Glyph-correctness is Gate 2 (advance/kerning drift) and a future raster check (outline/hinting drift).*

**Steps:**
1. Vitest green (incl. both A2 cases).
2. `bun run scripts/render-canary.ts --all`, capture stdout + both `render-canary.families.json` receipts.
3. Triage by `gate1.reason`:
   - `ok` → A3 receipt language, proceed.
   - `metric_twin` → A1 side-by-side inspection. Do not auto-pass.
   - `fallback` → **unicode-range exclusion is the primary suspected root cause** (now that A2 stops misrouting). Fix in sample text or served face's range.
   - `check_mismatch` → canonicalization fix in `mhtml-fonts.server.ts`; add the offending family-pair as a Vitest case before fixing.
   - `unresolved` → cid miss in MHTML extraction (real bug) vs legitimately-declared-but-unserved face (per-corpus known-missing list). `loadError` disambiguates.
   - `timeout` on `file://` → near-zero expected. If observed, page-eval ordering bug in `render-canary.server.ts`.
4. Gate 2 opt-in re-run; `drift` is diagnostic only in v1.
5. Update Part 2 outcome section with per-family counts, `metric_twin` inspection verdicts, Gate-2 drift findings, **plus A3 paragraph verbatim**.

No edits to `canary-constants.ts` in response to corpus results.

### Part B — Scope the workerd SSE-cancellation ticket (read-only)

**B1.** Read `src/routes/api/tests/$runId.stream.ts` end-to-end. Confirm relay-only (no run-driving, no chain, no awaits reaching `harness.server` / `freeze.server`). If GET both starts and drives the run, architecture drifted — file that as the bug and stop. fs-hypothesis from Part 1 does not transfer.

**B2.** Candidate causes, picked by the captured cancel-reason string (`bun run dev:worker` + GET against a known runId):
- **(a) byte-silent first-event window.** Stream writes nothing until orchestrator emits first event; workerd reads zero-bytes as hung.
- **(b) detached producer pump.** Async pump not retained relative to returned `Response`; isolate considers producer unreachable.
- **(c) request-lifetime / streaming-duration exceeded.** Test runs are minutes (Browserbase session + Stagehand + freeze). If SSE response held open for full run, plausible primary cause, not tail risk. Heartbeat does not buy out of a hard duration cap.
- **(d) CPU time exceeded.** Only if the handler does meaningful per-event sync work.

Disambiguators: "code had hung" → (a) or (b). "exceeded CPU" → (d). 500-class stream error (clean throw) points at producer bug, not runtime cancel. **Clean "Workers runtime canceled this request" is evidence against the fs hypothesis, not for it.**

**B3.** Per-signature remediations named in the ticket (no preselection):
- (a)+(b) → immediate SSE preamble/heartbeat (`:\n\n` on connect, decouples first-byte from first-event) + retain pump promise on request scope. Two-line-ish change, separate commit.
- (c) → architectural. **The two options aren't parallel — option 1 collapses into option 2:** resumable SSE via `Last-Event-ID` requires a durable, replayable per-run event log, but the orchestrator is pure in-memory pub/sub by design (the property that makes it leak-free is the same property that makes it non-durable). Worker isolates are ephemeral and non-sticky; a reconnect can land on a fresh isolate with zero memory of the run. So resumable SSE needs the same durable substrate a Durable Object provides natively. The realistic (c) choice is **"DO-backed, with resumable-SSE semantics optionally layered on top,"** not "resumable-SSE vs DO." Record this coupling in the ticket — otherwise the (c) follow-up starts by trying naive `Last-Event-ID` against stateless pub/sub and discovers the dependency three commits in.
- (d) → identify and remove per-event sync work from the relay handler.

Ticket framing must read **"cheap fix and architectural fix share a symptom; the reason string picks"** so nobody scans it and walks away thinking it's a two-line heartbeat job before the signature is captured.

**Step 4:** Land outcome in "Open ticket" entry above (or new sub-section) with: reproduction command, exact cancel reason string, confirmed architecture, picked cause (a)–(d), matching remediation. No code changes this round.

### Sequencing & out of scope
Part A first; Part B read-only, parallel. Part B's eventual remediation commit does not inherit Part A's acceptance commit. Out of scope: SSE fix, subset algorithm changes, Phase 2(b) Worker-orchestration move, `canary-constants.ts` default changes, UI changes.
