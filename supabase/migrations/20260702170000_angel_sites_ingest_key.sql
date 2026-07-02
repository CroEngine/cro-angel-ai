-- Per-site write key for the public ingest endpoints.
--
-- decide / events / inventory are CORS-open (the snippet calls them cross-origin
-- from the customer's page), so without a per-site secret anyone could POST
-- fake conversions or spoof inventory for any slug. This adds an opt-in write
-- key: the snippet carries it as data-key, and the endpoints reject a keyed
-- site's writes that don't present the matching key.
--
-- Nullable + no default ON PURPOSE:
--   * A site with a NULL key is treated as unkeyed → writes are allowed. This
--     keeps organic auto-registration (a brand-new snippet whose site row does
--     not exist yet) working, and never breaks a site that predates keys.
--   * Once a key is set (dashboard / rotate), that site's writes require it.
--
-- The key is public in the customer's page source (it ships in the snippet), so
-- it is NOT a true secret — it raises the bar against arbitrary-slug abuse and
-- is rotatable, but is not a substitute for rate limiting / origin checks.

alter table public.angel_sites
  add column if not exists ingest_key text;
