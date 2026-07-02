-- Dashboard-driven measurement config per site.
--
-- The install tag should be pasted ONCE and never edited again. Everything
-- tunable lives on the site row and is served to the snippet by
-- GET /api/adaptive/consent-config (fetched on every load, edge-cached), so
-- the owner changes holdout % or the conversion goal from the dashboard —
-- no code changes on their site. Tag attributes (data-holdout,
-- data-conversion-*) still win when present, as explicit overrides.
--
--   holdout_pct         — % of consented visitors held out as control (0 = off)
--   conversion_url      — substring of a URL that counts as a conversion
--   conversion_selector — CSS selector whose click counts as a conversion

alter table public.angel_sites
  add column if not exists holdout_pct integer not null default 0
    check (holdout_pct between 0 and 100),
  add column if not exists conversion_url text,
  add column if not exists conversion_selector text;
