-- Datahygien (revisionen 2026-07-20, 38 skeptiker-verifierade fynd):
-- läs-tidsrensning av känd förorening — lasttest-burstar, ägar-/utvecklar-
-- trafik, demo-simulatorkörningar och /admin-ytor. RADERAR ALDRIG: rådatan i
-- angel_events är orörd; vyn är ett filter som alltid kan omprövas.
--
-- Håll listorna i SYNK med TS-läslagret: src/lib/dashboard/data-hygiene.ts
-- (samma fönster, hashar, sessioner och källor — två konsumtionsvägar, en
-- sanning). Skillnad mot TS-lagret: sessions-KASKADEN för simulatorkällor
-- (hela sessionen ryker när entrén är twitter/bing) går inte att uttrycka
-- radvis i en vy — här faller bara pageviewen bort, så simulatorsessioner
-- kan dyka upp som 'okänd'-kanal med enstaka events i rollups. Ofarligt för
-- volymgrindarna; TS-lagret gör hela kaskaden för dashboarden.
--
-- security_invoker: vyn ärver RLS-skyddet på angel_events i stället för att
-- smyga förbi det med ägarens rättigheter — samma säkerhetsmodell som
-- rollup-funktionerna (SECURITY INVOKER + EXECUTE endast service_role).

create or replace view angel_events_clean
with (security_invoker = true) as
select e.*
from angel_events e
where
  -- Generella regler (alla sajter):
  coalesce(e.payload->>'path', '') not like '/admin%'
  and position('angel_' in coalesce(e.payload->>'path', '')) = 0
  and coalesce((e.payload->>'simulated')::boolean, false) = false
  -- Pilotens revisionslistor (glutenforum.se):
  and not (
    e.site = 'glutenforum.se' and (
      -- BOT-1: tre lasttest-burstar, skeptiker-verifierat exakta fönster
      -- (652 events, 0 oskyldiga innanför, burst-hasharna finns aldrig utanför)
      (e.created_at >= '2026-07-07T20:45:00Z' and e.created_at <= '2026-07-07T20:46:30Z')
      or (e.created_at >= '2026-07-10T06:24:00Z' and e.created_at <= '2026-07-10T06:26:30Z')
      or (e.created_at >= '2026-07-11T12:56:00Z' and e.created_at <= '2026-07-11T12:58:30Z')
      -- OWNER-1/3/4/6: ägar-/utvecklar-hashar (bevisade + hög sannolikhet).
      -- OBS coalesce: visitor_hash är NULL för hela pre-sessionId-eran — utan
      -- den blir IN-testet NULL, NOT(NULL) filtrerar bort raden tyst och vyn
      -- åt upp 1 200 oskyldiga legacy-events (upptäckt vid live-verifiering).
      or coalesce(e.visitor_hash, '') in (
        'ed3badd9-c7fe-40c2-aa4d-b0efd6048121',
        'bdc609d4-566e-45ee-bee6-85d173793649',
        '8d0fcc03-fbac-4541-8a33-aa92c7cc428d',
        '8c9da99e-d861-4b0d-9f41-03ea5744f0a9',
        '993269b5-034d-41c6-a158-d1debac8bdf2',
        'c5657fa3-ab60-4ca3-b808-206d6e72c046',
        '018fd2d1-7d43-4cb8-ac1b-083eb6ff06a6',
        '8caf653f-88b3-487e-8197-d1e1a9054bbf',
        '3d34e125-11b4-4ef5-b44d-f24fd244c4d9',
        'ccb6e017-cc26-401f-8e4e-bc424124bc87',
        '3aa6b231-5a3e-4733-a931-a5e32c901e64',
        'b41f477b-c549-4782-8255-4ed654c3bf7f'
      )
      -- OWNER-1: den kända ägarsessionen (bälte till hash-hängslena)
      or coalesce(e.payload->>'sessionId', '') = '4f5da1d5-3d83-4e21-9c77-08fcda495706'
      -- OWNER-5: källor som ENBART demo-simulatorn kan ha skapat
      or (e.type = 'pageview' and coalesce(e.payload->>'trafficSource', '') in ('twitter', 'bing'))
      -- OWNER-2 (bekräftat: 5 av 5 conversions + 3 av 3 cta_clicks var
      -- ägare/test): nollställ konverteringssignalen för hela pilotperioden
      -- före 2026-07-20 — de sessionslösa legacy-raderna kan inte fångas via
      -- hash-listan men är lika förorenade. Riktiga konverteringar framåt
      -- passerar orörda.
      or (e.type in ('conversion', 'cta_click') and e.created_at < '2026-07-20T00:00:00Z')
    )
  );

revoke all on angel_events_clean from public, anon, authenticated;
grant select on angel_events_clean to service_role;

-- ── Peka om samtliga rollup-funktioner till den rena vyn ─────────────────────
-- Funktionskropparna är oförändrade förutom angel_events → angel_events_clean.

create or replace function angel_segment_rollup(p_site text, p_since timestamptz default null)
returns table (
  channel text,
  device text,
  country text,
  is_returning boolean,
  visits bigint,
  conversions bigint,
  form_starts bigint,
  form_abandons bigint,
  rage_sessions bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ev as (
    select type, created_at, payload
    from angel_events_clean
    where site = p_site
      and payload ? 'sessionId'
      and (p_since is null or created_at >= p_since)
  ),
  sess as (
    select
      payload->>'sessionId' as sid,
      (array_agg(payload->>'trafficSource' order by created_at)
        filter (where type = 'pageview' and payload ? 'trafficSource'))[1] as channel,
      (array_agg(payload->>'device' order by created_at)
        filter (where type = 'pageview' and payload ? 'device'))[1] as device,
      (array_agg(payload->>'country' order by created_at)
        filter (where type = 'pageview' and payload ? 'country'))[1] as country,
      (array_agg(payload->>'isReturning' order by created_at)
        filter (where type = 'pageview' and payload ? 'isReturning'))[1] as returning_raw,
      bool_or(type = 'conversion') as converted,
      bool_or(type = 'form_start') as form_started,
      bool_or(type = 'form_abandon') as abandoned,
      bool_or(type = 'rage_click') as raged
    from ev
    group by 1
  )
  select
    coalesce(nullif(channel, ''), 'okänd') as channel,
    coalesce(nullif(device, ''), 'okänd') as device,
    coalesce(nullif(country, ''), 'okänd') as country,
    (returning_raw = 'true') as is_returning,
    count(*) as visits,
    count(*) filter (where converted) as conversions,
    count(*) filter (where form_started) as form_starts,
    count(*) filter (where abandoned) as form_abandons,
    count(*) filter (where raged) as rage_sessions
  from sess
  group by 1, 2, 3, 4
$$;

create or replace function angel_variant_arms(p_site text, p_variant text)
returns table (arm text, visits bigint, conversions bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with exp as (
    select
      visitor_hash,
      min(created_at) as first_seen,
      (array_agg(type order by created_at))[1] as first_type
    from angel_events_clean
    where site = p_site
      and type in ('adaptation_shown', 'adaptation_withheld')
      and visitor_hash is not null
      and payload->'patterns' ? ('variant:' || p_variant)
    group by visitor_hash
  ),
  conv as (
    select distinct e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site
      and e.type = 'conversion'
      and e.created_at >= exp.first_seen
  )
  select
    case when exp.first_type = 'adaptation_shown' then 'variant' else 'control' end as arm,
    count(*) as visits,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from conv)) as conversions
  from exp
  group by 1
$$;

create or replace function angel_page_segment_rollup(p_site text, p_since timestamptz default null)
returns table (
  path text,
  channel text,
  device text,
  country text,
  is_returning boolean,
  visits bigint,
  conversions bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with ev as (
    select type, created_at, payload
    from angel_events_clean
    where site = p_site
      and payload ? 'sessionId'
      and (p_since is null or created_at >= p_since)
  ),
  sess as (
    select
      payload->>'sessionId' as sid,
      (array_agg(payload->>'trafficSource' order by created_at)
        filter (where type = 'pageview' and payload ? 'trafficSource'))[1] as channel,
      (array_agg(payload->>'device' order by created_at)
        filter (where type = 'pageview' and payload ? 'device'))[1] as device,
      (array_agg(payload->>'country' order by created_at)
        filter (where type = 'pageview' and payload ? 'country'))[1] as country,
      (array_agg(payload->>'isReturning' order by created_at)
        filter (where type = 'pageview' and payload ? 'isReturning'))[1] as returning_raw,
      bool_or(type = 'conversion') as converted
    from ev
    group by 1
  ),
  page_visits as (
    select distinct
      payload->>'sessionId' as sid,
      coalesce(nullif(payload->>'path', ''), '/') as path
    from ev
    where type = 'pageview'
  )
  select
    pv.path,
    coalesce(nullif(s.channel, ''), 'okänd') as channel,
    coalesce(nullif(s.device, ''), 'okänd') as device,
    coalesce(nullif(s.country, ''), 'okänd') as country,
    (s.returning_raw = 'true') as is_returning,
    count(*) as visits,
    count(*) filter (where s.converted) as conversions
  from page_visits pv
  join sess s on s.sid = pv.sid
  group by 1, 2, 3, 4, 5
$$;

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
    from angel_events_clean
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
