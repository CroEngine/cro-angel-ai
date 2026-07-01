-- Per-page content inventory: scope inventory rows to a page path so different
-- pages under one domain don't overwrite each other. Existing rows default to
-- the homepage ('/'). The unique key moves from (site_slug, item_id) to
-- (site_slug, path, item_id).

alter table public.angel_content_inventory
  add column if not exists path text not null default '/';

alter table public.angel_content_inventory
  drop constraint if exists angel_content_inventory_site_slug_item_id_key;

create unique index if not exists angel_content_inventory_site_path_item_key
  on public.angel_content_inventory (site_slug, path, item_id);

create index if not exists angel_content_inventory_site_path_slot_idx
  on public.angel_content_inventory (site_slug, path, slot);
