# Designer run 2026-07-21 — the first E3-lite loop, full audit trail

Eight refused sites through nine solve/validate rounds. `prompts/` holds the
exact designer prompts (identical for the api and file transports), `plans/`
the final plan per site, `results-round*.json` / `feedback-round*.json` every
round's live-page outcomes and the failure feedback that drove the next round.
Gallery before/after pairs were delivered in-session (full-page JPEGs, too
large for the repo); the validate script regenerates them on demand.

Outcome summary and the mechanism fixes this run forced: see
`docs/designer-loop.md`.
