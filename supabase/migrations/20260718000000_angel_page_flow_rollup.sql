-- Per-segment SIDFLÖDE — korssid-lyftets detektorsignal (task #117 slice 1):
-- "andel av segment S som landar på P och SENARE besöker Q". Det är beviset
-- som låter designern föreslå att Q:s innehåll (t.ex. priser) lyfts fram på P
-- — datadrivet, inte gissat.
--
--   * landing_path = sessionens FÖRSTA pageview (samma första-pageview-idiom
--     som segmentdimensionerna); dest_path = varje ANNAN sida vars första
--     besök i sessionen ligger EFTER landningen — "senare" är ärligt tidsstyrt,
--     inte bara "förekom i sessionen".
--   * sessions = sessioner som landade på landing_path i dim-kombon
--     (nämnaren, upprepad per dest-rad för enkel konsumtion);
--     reached = de av dem som senare nådde dest_path (täljaren).
--   * Sidvägar query/hash-strippas (samma hygien som page-rollupen efter
--     2026-07-17 — ?fbclid är spårning, inte sididentitet).
--
-- Samma säkerhetsmodell som angel_page_segment_rollup: SECURITY INVOKER,
-- EXECUTE endast service_role, RLS på angel_events skyddar direktanrop.
create or replace function angel_page_flow_rollup(p_site text, p_since timestamptz default null)
returns table (
  landing_path text,
  dest_path text,
  channel text,
  device text,
  country text,
  is_returning boolean,
  sessions bigint,
  reached bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ev as (
    select type, created_at, payload
    from angel_events
    where site = p_site
      and payload ? 'sessionId'
      and (p_since is null or created_at >= p_since)
  ),
  sess as (
    select
      payload->>'sessionId' as sid,
      (array_agg(coalesce(nullif(split_part(split_part(payload->>'path', '#', 1), '?', 1), ''), '/') order by created_at)
        filter (where type = 'pageview'))[1] as landing_path,
      min(created_at) filter (where type = 'pageview') as landing_at,
      (array_agg(payload->>'trafficSource' order by created_at)
        filter (where type = 'pageview' and payload ? 'trafficSource'))[1] as channel,
      (array_agg(payload->>'device' order by created_at)
        filter (where type = 'pageview' and payload ? 'device'))[1] as device,
      (array_agg(payload->>'country' order by created_at)
        filter (where type = 'pageview' and payload ? 'country'))[1] as country,
      (array_agg(payload->>'isReturning' order by created_at)
        filter (where type = 'pageview' and payload ? 'isReturning'))[1] as returning_raw
    from ev
    group by 1
  ),
  visits as (
    select
      payload->>'sessionId' as sid,
      coalesce(nullif(split_part(split_part(payload->>'path', '#', 1), '?', 1), ''), '/') as path,
      min(created_at) as first_at
    from ev
    where type = 'pageview'
    group by 1, 2
  ),
  landings as (
    select
      sid,
      landing_path,
      landing_at,
      coalesce(nullif(channel, ''), 'okänd') as channel,
      coalesce(nullif(device, ''), 'okänd') as device,
      coalesce(nullif(country, ''), 'okänd') as country,
      (returning_raw = 'true') as is_returning
    from sess
    where landing_path is not null
  ),
  landing_totals as (
    select landing_path, channel, device, country, is_returning, count(*) as sessions
    from landings
    group by 1, 2, 3, 4, 5
  ),
  flows as (
    select
      l.landing_path,
      v.path as dest_path,
      l.channel,
      l.device,
      l.country,
      l.is_returning,
      count(*) as reached
    from landings l
    join visits v
      on v.sid = l.sid
     and v.path <> l.landing_path
     and v.first_at > l.landing_at
    group by 1, 2, 3, 4, 5, 6
  )
  select
    f.landing_path,
    f.dest_path,
    f.channel,
    f.device,
    f.country,
    f.is_returning,
    t.sessions,
    f.reached
  from flows f
  join landing_totals t
    on t.landing_path = f.landing_path
   and t.channel = f.channel
   and t.device = f.device
   and t.country = f.country
   and t.is_returning = f.is_returning
$$;

revoke all on function angel_page_flow_rollup(text, timestamptz) from public, anon, authenticated;
grant execute on function angel_page_flow_rollup(text, timestamptz) to service_role;
