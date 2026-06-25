-- M2 — Content Inventory: crawl_runs + content_inventory.
--
-- The ground truth of what content already exists on a site — the spine of
-- Principle 2 ("Angel never invents content"). Populated by the crawler
-- (freezeSite + collect/pageAudit per URL). RLS scopes everything to the site
-- owner; the crawler (triggered by the owner) writes its own rows.
-- Applied to project upvthvbhqzqqimsyjpxw via the Supabase MCP. Additive only.

-- ─────────────────────────────────────────────────────────────────────────────
-- crawl_runs — one row per crawl of a site.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.crawl_runs (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.sites (id) on delete cascade,
  status            text not null default 'queued'
                      check (status in ('queued', 'running', 'done', 'failed')),
  pages_crawled     int not null default 0,
  extractor_version text,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz
);

create index crawl_runs_site_started_idx on public.crawl_runs (site_id, started_at desc);

alter table public.crawl_runs enable row level security;

create policy "crawl_runs_select_own" on public.crawl_runs
  for select using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );
create policy "crawl_runs_insert_own" on public.crawl_runs
  for insert with check (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );
create policy "crawl_runs_update_own" on public.crawl_runs
  for update using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- content_inventory — one row per extracted item, per page. `category` is plain
-- text (kept flexible as the extractor taxonomy evolves): trust-signal types ∪
-- section types ∪ {cta, image, headline, microcopy, nav_item, case_study}.
-- `selector` is the stable, single-match selector from buildSelector().
-- ─────────────────────────────────────────────────────────────────────────────
create table public.content_inventory (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.sites (id) on delete cascade,
  crawl_run_id      uuid references public.crawl_runs (id) on delete set null,
  url               text not null,
  category          text not null,
  selector          text not null,
  text              text,
  attrs             jsonb,
  rect              jsonb,
  section_kind      text,
  above_fold        boolean,
  visual_weight     int,
  extractor_version text,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  unique (site_id, url, selector, category)
);

create index content_inventory_site_category_idx on public.content_inventory (site_id, category);
create index content_inventory_crawl_run_idx on public.content_inventory (crawl_run_id);

alter table public.content_inventory enable row level security;

create policy "content_inventory_select_own" on public.content_inventory
  for select using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );
create policy "content_inventory_insert_own" on public.content_inventory
  for insert with check (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );
create policy "content_inventory_update_own" on public.content_inventory
  for update using (
    site_id in (select id from public.sites where owner_user_id = (select auth.uid()))
  );
