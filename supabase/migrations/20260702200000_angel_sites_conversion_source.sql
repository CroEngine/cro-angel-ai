-- Zero-config measurement: track WHO set the conversion goal.
--
--   'auto'  — Angel picked it from the harvested inventory (best goal-intent
--             CTA). Shown as "auto-detected" in the dashboard; may be filled
--             in automatically whenever the stored selector is empty.
--   'owner' — the owner saved it explicitly in the dashboard. Never
--             auto-overwritten.
--   NULL    — legacy/unset.

alter table public.angel_sites
  add column if not exists conversion_source text
    check (conversion_source in ('auto', 'owner'));
