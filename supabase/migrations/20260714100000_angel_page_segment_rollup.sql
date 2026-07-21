-- Per-SIDA-segmentaggregering — detektorns fråga växer från "vilka besökar-
-- grupper har förtjänat en design?" till "vilka grupper × på vilken SIDA?".
--
-- Serveringen är redan sid-medveten (angel_variants nycklar på site+path+segment;
-- decide matchar per den sida besökaren står på) men detektorn räknade sajt-brett.
-- Den här funktionen är angel_segment_rollup plus en path-dimension:
--
--   * En session bidrar till VARJE distinkt sida den besökte (sid-exponering).
--   * Dimensionerna tas från sessionens FÖRSTA pageview (samma som förr).
--   * "converted" är sessionens utfall var som helst — frågan per sida är
--     "konverterade sessioner som såg den här sidan?", inte "konverterade PÅ
--     den här sidan" (mål-klicket sker ofta på en annan sida än den som
--     övertygade).
--
-- Samma säkerhetsmodell som angel_segment_rollup: SECURITY INVOKER, EXECUTE
-- endast service_role, RLS på angel_events skyddar direktanrop.
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
    from angel_events
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
    -- Distinkta (session, sida) — äldre events utan path räknas som startsidan.
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

revoke all on function angel_page_segment_rollup(text, timestamptz) from public, anon, authenticated;
grant execute on function angel_page_segment_rollup(text, timestamptz) to service_role;
