# Drift Survey — Grind 0

**Status:** template. Populated by `bun run scripts/drift-survey.ts` over the
50-site breadth target list. Outputs land here as cumulative categorization;
the script does **not** overwrite, it appends so we can see the survey grow.

## Purpose

Map the categories of in-DOM non-determinism that exist in the wild **before**
Grind 1 locks the determinism whitelist. Without this, the whitelist becomes
hubspot-shaped and Grind 2 punctures it with ten new legitimate drift sources
that should have been in the whitelist from day one.

Grind 0 has **no pass/fail criterion**. The output is knowledge, not a gate.

## How drift is identified (heuristic, not perfect)

For each site, two captures are taken 60s apart (single session each, fresh
Browserbase session). The two MHTML bodies are diffed at the DOM level:

1. Parse both MHTMLs, extract the main HTML part.
2. Strip already-known transport drift (boundaries, Content-IDs, Date headers).
3. Tree-diff: enumerate added/removed/changed attribute values + text nodes.
4. Classify each diff by selector + value pattern (regex over framework
   signatures: `data-optimizely-*`, `[id^="dy-"]`, `[data-vwo-*]`, etc.).
5. Aggregate into the categories below.

The script does NOT try to determine "is this drift OK?" — that's Grind 1's
job. It just enumerates what exists.

## Categories (populated by script — placeholder structure)

### A/B / experimentation frameworks

_Filled by survey. Each row: framework name, selector signature, sites observed on, drift shape._

| Framework | Signature | Sites | Drift shape |
|---|---|---|---|
| _(empty until first survey run)_ | | | |

### Personalization / recommendations

| Framework | Signature | Sites | Drift shape |
|---|---|---|---|
| _(empty until first survey run)_ | | | |

### Ad injection

| Framework | Signature | Sites | Drift shape |
|---|---|---|---|
| _(empty until first survey run)_ | | | |

### Session / security tokens

| Field | Pattern | Sites |
|---|---|---|
| _(empty until first survey run)_ | | |

### CDN / build-hash artifacts

| Pattern | Example | Sites |
|---|---|---|
| _(empty until first survey run)_ | | |

### Unclassified drift

> **This is the important section.** Drift that doesn't fit any known category
> goes here, with the raw diff fragment. Reviewing this manually is what feeds
> back into Grind 1's whitelist (with a stated cause per entry).

| Site | Selector path | Diff fragment | Reviewer note |
|---|---|---|---|
| _(empty until first survey run)_ | | | |

## Baseline success rate

> Populated by survey: % of 50-site list that produced a non-empty MHTML
> within the 60s timeout. This is the "honest baseline" that the planning
> document admitted was a guess at 85%.

| Captured | Total | Rate |
|---|---|---|
| _(empty until first survey run)_ | _(50)_ | |
