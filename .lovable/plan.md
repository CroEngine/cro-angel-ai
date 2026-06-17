
# Grind 0 closeout — execution plan

Framing locked from prior rounds. This plan is the build sequence with the two text-worthy refinements from the latest round folded in (Step 4.5 gate, promotion-criteria relocation). #2 and #4 are binding-as-articulated and land at file-authoring time.

## Sequence (~100–115 min)

### Step 1 — Fix `classifyFailure` (~10 min)
`src/lib/tests/snapshot/freeze.server.ts`: lowercase error messages, add `mhtml-capture-failed` class for CDP `-32000` / `"failed to generate mhtml"`. No root-cause speculation in the comment — just the classification.

### Step 2 — Inspect Medium + StackOverflow MHTMLs (~15 min)
Manual read. Likely `auth-gate` (login interstitials), routed to a new failure class, not bolted onto `CONSENT_HEADING_PATTERNS`. `captured-wrong-page` stays a transient triage label.

### Step 3 — Reclassify font-embed-failed (~5 min)
Site froze, MHTML produced, fonts 403'd. Score is render-free → unaffected. Note in SUMMARY.md as `valid-score, no-canary` on the fidelity axis. Not excluded.

### Step 4 — `mechanism-inventory.ts` (~45–60 min)
New script, regex pattern-match per category over all `page.mhtml`. Output: tables per category, no auto-filled "unclassified" — manual fill. Corrected categories (e.g. `_uxa/usabilla` → neutral session-recording, not A/B). Timing realistic; 30 min was optimistic.

### Step 4.5 — Verify diff readability (gate before Step 5)
`scripts/freeze-determinism-check.ts` MUST emit field-level diff: named drifting fields with before/after fragments — not "drift detected: N fields". The "read diff first" rule in Step 6 verdict logic is inert without it; default behavior falls back to N=5 retry. If the script only prints a count, fix output before Step 5 runs.

### Step 5 — Author SUMMARY.md + WHITELIST.md (~15 min)
- **SUMMARY.md** retitled **"Mechanism Inventory — Non-Determinism Mechanisms Observed Present (Not Drift Evidence)"**. Two separate metrics, never collapsed: capture-fidelity 37/45 = 82%, score-validity 40/45 = 89%. Per-row columns: `scoreValid` (bool), `canaryValid` (bool), `failureClass` (disambiguates F,F rows).
- **WHITELIST.md** rows: `mechanism | presence-evidence | score-impact ∈ {neutral, sample-defining} | confidence ∈ {potential-presence, confirmed-drift, present-no-observed-impact}`. Qualifier on sample-defining defaults: "conservative overestimate of variance; actual hero impact unconfirmed until determinism-check observes drift there." Pre-list OneTrust CMP session-ID (`optanon-*`, `data-domain-script`) for hubspot.

### Step 6 — Determinism-check on hubspot (`--n=3`)
- `GREEN` → Grind 0 closed.
- `AMBER` → read diff first. Field in whitelisted mechanism → widen whitelist row, confidence stays/promotes to `confirmed-drift`. New field → RED.
- `RED` → axis not seen; new whitelist row or genuine non-determinism.
- N=3 with zero drift on a present mechanism → downgrade that row to `present-no-observed-impact`. Determinism-check is the oracle in both directions.
- No N=5 retry before diff read.

### Step 7 — Promotion criteria relocation
`corpus/README.md` (or new `corpus/PROMOTION.md`) gets the "Promotion criteria" section. Capture-determinism (N≥3 consecutive freezes, 0 unexpected-drift) is a promotion invariant for ALL sites, not a property of `mhtml-capture-failed`. The failure-class comment cross-references ("may be intermittent; see promotion criteria") rather than housing the invariant.

## Deliberately not doing

- Not fixing font-embed-failed (reclassified, not fixed).
- Not fixing techcrunch-timeout.
- Not guessing -32000 root cause — only classifying.
- Not promoting any `mhtml-capture-failed` site to corpus without a separate capture-determinism test.

## Done when

Grind 0 closed with mechanism-inventory framing intact, WHITELIST.md carrying score-impact + tri-state confidence, two success-rate metrics reported separately, promotion-criteria invariant housed in corpus docs, hubspot verdict data-driven.
