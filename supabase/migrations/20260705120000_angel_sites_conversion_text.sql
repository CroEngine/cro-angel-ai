-- Conversion-click resilience: the goal's visible label rides along with the
-- selector so the snippet can fall back to matching by text when the CSS
-- selector (e.g. "a:nth-of-type(2) > button") doesn't resolve on a page.
alter table public.angel_sites add column if not exists conversion_text text;
