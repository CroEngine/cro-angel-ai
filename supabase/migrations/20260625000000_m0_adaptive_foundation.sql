-- M0 — Angel Adaptive: schema + tenancy foundation
--
-- Foundation subset for the Learn-Mode ingestion path (M1): sites, visitors,
-- sessions, events, events_rollup. Content/intelligence tables (content_inventory,
-- segments, adaptations, adaptation_results) arrive in later migrations (M2/M3).
--
-- Columns mirror docs/ARCHITECTURE.md §5. RLS is enabled on EVERY table:
--   * owners read/write their own `sites`;
--   * owners SELECT child rows scoped by site ownership;
--   * writes to child tables go through the service-role admin client (bypasses RLS);
--   * raw `events` are service-role-only — the dashboard reads `events_rollup`.
--
-- Applied by Lovable Cloud on sync (remote project hmhuqqgckuujxwrtdrkj); this file
-- is the source of truth. Additive only — no drops.

-- ─────────────────────────────────────────────────────────────────────────────
-- sites — tenancy. One row per customer site; `public_site_key` is the value in
-- the snippet's data-site-id attribute.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.sites (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  domain           text not null,
  public_site_key  text not null unique,
  phase            text not null default 'learn'
                     check (phase in ('learn', 'intelligence', 'adaptive')),
  consent_mode     text not null default 'anonymous_default'
                     check (consent_mode in ('tcf', 'site_signal', 'anonymous_default')),
  consent_config   jsonb not null default '{}'::jsonb,
  allowed_origins  text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index sites_owner_user_id_idx on public.sites (owner_user_id);

alter table public.sites enable row level security;

create policy "sites_select_own" on public.sites
  for select using (owner_user_id = (select auth.uid()));
create policy "sites_insert_own" on public.sites
  for insert with check (owner_user_id = (select auth.uid()));
create policy "sites_update_own" on public.sites
  for update using (owner_user_id = (select auth.uid()))
             with check (owner_user_id = (select auth.uid()));
create policy "sites_delete_own" on public.sites
  for delete using (owner_user_id = (select auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- visitors — pseudonymous, one row per visitor id (hashed first-party key).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.visitors (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites (id) on delete cascade,
  visitor_key    text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  first_referrer text,
  first_utm      jsonb,
  is_returning   boolean not null default false,
  unique (site_id, visitor_key)
);

create index visitors_site_id_idx on public.visitors (site_id);

alter table public.visitors enable row level security;

create policy "visitors_select_own_site" on public.visitors
  for select using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- sessions — one row per session (NOT per event). `segment_id` FK arrives in M3.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.sessions (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites (id) on delete cascade,
  visitor_id     uuid not null references public.visitors (id) on delete cascade,
  started_at     timestamptz not null default now(),
  ended_at       timestamptz,
  entry_url      text,
  exit_url       text,
  device         jsonb,
  geo            jsonb,
  language       text,
  utm            jsonb,
  source         text,
  bounced        boolean,
  max_scroll_pct int,
  duration_ms    int
);

create index sessions_site_started_idx on public.sessions (site_id, started_at);
create index sessions_visitor_id_idx on public.sessions (visitor_id);

alter table public.sessions enable row level security;

create policy "sessions_select_own_site" on public.sessions
  for select using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- events — the firehose. Plain indexed table for v1 (SupabaseEventSink); the
-- EventSink seam relocates this to Cloudflare Analytics Engine at M6, and monthly
-- partitioning is deferred as an optimization. RLS-on with NO policies → the
-- service-role admin client is the only reader/writer; the dashboard reads rollups.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.events (
  id          bigint generated always as identity primary key,
  site_id     uuid not null references public.sites (id) on delete cascade,
  visitor_id  uuid references public.visitors (id) on delete cascade,
  session_id  uuid references public.sessions (id) on delete cascade,
  type        text not null,
  url         text,
  selector    text,
  value       numeric,
  client_ts   timestamptz,
  received_at timestamptz not null default now(),
  ctx         jsonb
);

create index events_site_received_idx on public.events (site_id, received_at);
create index events_session_id_idx on public.events (session_id);

alter table public.events enable row level security;
-- intentionally no policies: events are service-role-only.

-- ─────────────────────────────────────────────────────────────────────────────
-- events_rollup — per site/segment/day aggregates. The dashboard reads ONLY this,
-- never raw events. `segment_id` is nullable (no FK until `segments` exists in M3);
-- the unique index coalesces NULL so per-site/day rows stay unique pre-segmentation.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.events_rollup (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites (id) on delete cascade,
  segment_id      uuid,
  day             date not null,
  source          text not null default '',
  section_kind    text not null default '',
  views           int not null default 0,
  cta_clicks      int not null default 0,
  reached_section int not null default 0,
  exits_before    int not null default 0,
  avg_scroll_pct  numeric not null default 0,
  conversions     int not null default 0
);

create unique index events_rollup_unique_idx on public.events_rollup (
  site_id,
  coalesce(segment_id, '00000000-0000-0000-0000-000000000000'::uuid),
  day,
  source,
  section_kind
);
create index events_rollup_site_day_idx on public.events_rollup (site_id, day);

alter table public.events_rollup enable row level security;

create policy "events_rollup_select_own_site" on public.events_rollup
  for select using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );
