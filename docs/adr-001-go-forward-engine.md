# ADR 001 — The go-forward engine

**Status:** Accepted · 2026-07-22 · Resolves the "two engines" meta-finding in
`docs/conversion-gap-audit.md`.

## Context

Two adaptation engines exist, and — the root of the confusion — **both entry-point
headers claim to be "the customer snippet":**

- **`public/adaptive.js`** (`VERSION "0.1.0"`) + the server `src/adaptive/*` —
  **SERVER-DECIDES.** The snippet applies the ops the server Decision Engine returns via
  `/api/adaptive/decide` → `serveDecision`. **This is what customers actually load.** The
  architecture carries: a real goal model (`classifyGoalKind`, LLM `judgeSiteGoals`),
  device/mobile awareness (`classifyDevice`, `mobile_simplify`), trust at the point of
  decision (`inject_badge` beside the goal), secondary-CTA surfacing, cross-page lift
  (`insert_snippet`), per-variant owner approval, honest measurement, and consent gating.
  Its client applier does **real DOM moves** (`insertBefore`) — a11y-correct — but with
  **no safety self-check**.
- **`src/adaptive-lab/`** (`VERSION "0.16.0"`) → `public/adaptive-lab.js` —
  **CLIENT-AUTONOMOUS.** Decides *and* applies everything in the browser, no server.
  **Loaded only by scripts — no customer runs it.** Its value: a **self-checked reorder**
  (`tryOrderMove` — envelope/overlap/doc-height checks, rollback-on-drift), structural
  section typing + proof→section linking (added this session), the metric hierarchy, and
  clean TypeScript with tests. It lacks the goal model, device awareness, cross-page lift,
  and any serving/approval integration. (Its reorder is also visual-only CSS `order` — a
  WCAG Level A problem; see the gap audit.)

The gap audit found this split is the meta-blocker: recent investment went into the lab
(the engine customers don't run), and each engine has capabilities the other lacks.

## Decision

**The server-decides architecture is the go-forward product** — the customer snippet
`adaptive.js` applies ops the server Decision Engine returns. The client-autonomous lab
engine is **retired as a standalone product path** and demoted to a research/perception
sandbox whose *code is harvested into the product*.

### Rationale
- **Server-decides is load-bearing and expensive to rebuild.** The goal model, LLM
  goal-judging, cross-page lift, per-variant owner approval, and honest measurement all
  require the server to hold the full inventory + run an LLM + gate approval. The
  client-autonomous lab architecture structurally *cannot* do these.
- **`adaptive.js` is what actually runs for customers.**
- **The lab's value is its CODE, not its architecture** — port it in (below).

### Convergence plan (each step its own PR)
1. **Code truth (this ADR).** Reconcile the misleading headers + the stale `serve.ts`
   comment so the code states which engine is which. *(done alongside this doc.)*
2. **Port the reorder self-check into the customer applier.** ✅ **SHIPPED.** `adaptive.js`
   `move_up` is a real DOM move (a11y-correct) but had **no** self-check; the lab's
   `tryOrderMove` has the full self-check but uses CSS `order` (a11y-wrong). **Converged =
   DOM move + self-check = the correct reorder** — fixes the Tier-1 a11y violation *and* the
   customer engine's missing safety in one move. The applier now measures the section's top +
   the document height/width around each move and, if the section did not actually rise (DOM
   order ≠ visual order), grew/shrank the page, overflowed horizontally, or collapsed, puts
   it straight back. **Decision — the customer engine fails the WHOLE variant** (not
   skip-this-op like the lab): a verified + owner-approved variant is one atomic A/B
   treatment, so a visitor sees the exact variant or the clean baseline, never a half-variant.
   **Kept in sync with the server harness** (`scripts/redesign/measure.ts` +
   `render-gates.ts`): the harness now measures the same per-move "did it rise" and **fails
   verification** (unservable, same class as the LCP-touch gate) so it can never approve a
   move the client will fail-closed on — otherwise the A/B arm measures original vs original.
   Proven end-to-end on the plausible.io fixture (a 2nd `move_up` there sinks the proof
   983→1227px): `scripts/ci/serving-smoke.mjs` (client) + the render-gates tests (harness).
3. **Port structural section typing + proof→section linking into the server inventory.**
   ✅ **SHIPPED (live path).** A tracing pass established the decisive fact: the live customer
   endpoint (`/api/adaptive/decide`) serves **only** redesign variant `serveOps` via
   `serveDecision` — the `PageSection → ContentInventory → decide()` pattern engine is
   **retired from live serving** (`decide.ts:9-17`). So the section typing that actually
   reaches a visitor flows through `redesign/extract.ts` (`RedesignContentModel`), **not** the
   audit/`crawler-inventory.ts` path. The port therefore landed in `extract.ts` + `vocab.ts` +
   `context.ts`:
   - **Structural typing** (ported from the lab's `assembleInventory`, adapted from live-DOM
     `querySelector` to regex over each section's frozen HTML slice): a still-generic section
     is named from its own body — `<video>`/YouTube-Vimeo-Wistia-Loom → **video**, ≥2
     `<details>`/accordion → **faq**, `<table>` (≥3 rows) → **comparison**, ≥6 imgs +
     integration heading → **integrations**. A heading-assigned type is never clobbered.
   - **Proof→section linking**: a section whose *body* carries "trusted by …" → **logos** or a
     social-proof count ("500,000+ customers") → **stats**, and every proof-bearing section is
     flagged `containsTrustSignals` — the "which section holds the proof" signal, now surfaced
     to the designer LLM (`[proof]` in the prompt) and driving the offline before/after reorder
     demo (`EVIDENCE_SECTION_TYPES` gained `stats`). This is the lab's key win (0 → 3
     proof-linked sections on the plausible fixture; the flag didn't exist in the model before).
   - **Not ported** (deliberate): the card-grid / short-CTA structural heuristics (fragile to
     reconstruct from a string; headings cover CTA), and the **audit/golden path**
     (`sections.ts` + `enrichSections`) — it is version-gated by `EXTRACTOR_VERSION` + corpus
     goldens, the goldens are geo/build-sensitive, and it is **not the live serve path** anyway.
     Deferred to a golden-capable environment if the ContentInventory path is ever revived.
4. **Rebuild the runtime applier as clean, tested TS** (absorbing the lab's
   presentability + revert discipline) instead of hand-maintained JS; retire
   `public/adaptive-lab.js` as a runtime.
5. **Relabel the lab** to a perception/research sandbox that feeds the offline
   designer-brief only.

### Version note
`adaptive.js` reports `"0.1.0"` despite heavy development — reconcile to a real version
scheme in step 4 (not changed now, to avoid telemetry confusion mid-decision).

## Consequences
- Future adaptation + perception work targets the **customer engine** (`src/adaptive/*` +
  `adaptive.js`), not the lab.
- The gap audit's Tier-1 fixes (false-winner guard, a11y reorder, mobile validation) are
  sequenced against the customer engine.
- The lab stays useful as a fast research/inventory sandbox but is no longer "the product."
