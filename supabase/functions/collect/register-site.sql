-- Register a customer site for the Angel Adaptive collector.
--
-- Paste into the Supabase SQL editor for the collector project
-- (upvthvbhqzqqimsyjpxw). Idempotent — safe to run more than once.
--
-- Why a script and not a one-line INSERT: sites.owner_user_id is NOT NULL and
-- references auth.users, but auth.uid() is NULL in the SQL editor (it runs as the
-- service role, not a signed-in user). Rather than hand-copy a uuid, this resolves
-- the owner from auth.users by email, then upserts the site. The collector writes
-- via the service-role client (bypasses RLS), so the owner is just the FK anchor —
-- any existing user works.
--
-- Edit the four values at the top, then run.

do $$
declare
  -- ── edit these ─────────────────────────────────────────────────────────────
  v_owner_email text   := 'hello@gustafschiller.com';     -- who owns the site
  v_domain      text   := 'glutenforum.se';
  v_site_key    text   := 'glutenforum';                  -- goes in data-site-id
  v_origins     text[] := array['https://glutenforum.se'];-- who may POST (lock down)
  -- ───────────────────────────────────────────────────────────────────────────
  v_owner uuid;
begin
  -- Resolve the owner: preferred email first, else the oldest user in the project.
  select id into v_owner from auth.users where email = v_owner_email order by created_at limit 1;
  if v_owner is null then
    select id into v_owner from auth.users order by created_at limit 1;
  end if;
  if v_owner is null then
    raise exception
      'No users on this project yet — create one in Dashboard -> Authentication -> Users, then re-run.';
  end if;

  insert into public.sites (owner_user_id, domain, public_site_key, allowed_origins)
  values (v_owner, v_domain, v_site_key, v_origins)
  on conflict (public_site_key) do update
     set domain          = excluded.domain,
         allowed_origins = excluded.allowed_origins,
         updated_at      = now();

  raise notice 'collector: site "%" (%) registered to owner %', v_site_key, v_domain, v_owner;
end $$;

-- Verify:
--   select public_site_key, domain, allowed_origins, owner_user_id from public.sites;
