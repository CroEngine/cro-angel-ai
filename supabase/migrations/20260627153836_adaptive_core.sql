-- Angel Adaptive — core schema.
--
-- Three tables back the adaptive runtime:
--   angel_sites             — one row per customer site (the install).
--   angel_content_inventory — published content the crawler extracted (Step 2).
--   angel_events            — analytics + decision/adaptation log (Step 8).
--
-- RLS is enabled and locked down: all runtime access goes through the server
-- using the service-role key (which bypasses RLS). No anon/authenticated
-- policies are granted here; dashboard read policies are added in a later
-- migration once auth/tenancy is wired.
--
-- Apply directly against Supabase with `supabase db push` (or paste into the
-- SQL editor). Until applied, the app degrades gracefully (writes are
-- best-effort). See supabase/README.md.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
create table if not exists public.angel_sites (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,          -- the data-site value, e.g. "demo"
  domain      text,
  name        text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
create table if not exists public.angel_content_inventory (
  id          uuid primary key default gen_random_uuid(),
  site_slug   text not null,
  slot        text not null,                 -- InventorySlot
  item_id     text not null,
  text        text,
  selector    text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (site_slug, item_id)
);

create index if not exists angel_content_inventory_site_idx
  on public.angel_content_inventory (site_slug, slot);

-- ---------------------------------------------------------------------------
create table if not exists public.angel_events (
  id            bigint generated always as identity primary key,
  site          text not null,
  type          text not null,               -- pageview | adaptation_shown | cta_click | scroll_depth | conversion
  decision_id   text,
  visitor_hash  text,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists angel_events_site_created_idx
  on public.angel_events (site, created_at desc);
create index if not exists angel_events_type_idx
  on public.angel_events (site, type);
create index if not exists angel_events_decision_idx
  on public.angel_events (decision_id);

-- ---------------------------------------------------------------------------
alter table public.angel_sites             enable row level security;
alter table public.angel_content_inventory enable row level security;
alter table public.angel_events            enable row level security;
