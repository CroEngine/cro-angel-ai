-- Multi-tenant ownership: which user owns which site.
--
-- Self-service signup means a customer creates an account and adds their site;
-- from then on they may only see/configure their OWN sites. This membership
-- table is that link. A site can exist without a member (auto-registered when a
-- snippet first runs); "adding" such a slug in the dashboard claims it.
--
-- Access is via the service-role server (RLS locked, no anon/auth policies) —
-- ownership is enforced in the dashboard server functions, not by RLS. Admins
-- (ANGEL_ADMIN_EMAILS) bypass the filter in code and see every site.

create table if not exists public.angel_site_members (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  site_slug  text not null,
  role       text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (user_id, site_slug)
);

create index if not exists angel_site_members_slug_idx on public.angel_site_members (site_slug);
create index if not exists angel_site_members_user_idx on public.angel_site_members (user_id);

alter table public.angel_site_members enable row level security;
