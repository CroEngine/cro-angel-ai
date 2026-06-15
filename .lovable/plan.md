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
