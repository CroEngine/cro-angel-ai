-- Fas 2 server-side segmentaggregering (docs/fas2-segment-grouping.md).
--
-- Dashboarden läste tidigare bara de senaste 5000 eventen (EVENT_LIMIT) och
-- rullade upp segment i JS. Det gör volymgrinden (1000 besök / 100 konv per
-- segment) opålitlig vid riktig trafik: ett segment med 1000 livstidsbesök syns
-- bara med en bråkdel i ett färskt 5000-fönster och blir aldrig "tillräckligt".
--
-- Den här funktionen aggregerar över HELA angel_events (indexet
-- angel_events_site_created_idx på (site, created_at DESC) bär filtret) och
-- returnerar finaste-grain-lövnoder (kanal·enhet·land·ny/återkommande) med
-- räknare. JS (expandSegmentLeaves) expanderar sedan löven till grov→fin-prefix.
--
-- En session = ett besök = ett utfall: dimensionerna tas från sessionens FÖRSTA
-- pageview; utfallet är om sessionen hade en conversion / form_start /
-- form_abandon / rage_click. p_since möjliggör tidsfönster (null = all historik).
--
-- SECURITY INVOKER: dashboarden anropar via service_role (kringgår RLS och läser
-- raderna); anon/authenticated körs under RLS på angel_events (påslaget, ingen
-- policy → noll rader) så funktionen läcker inget. EXECUTE är dessutom bara
-- service_role (inte en publik REST-yta).
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
    from angel_events
    where site = p_site
      and payload ? 'sessionId'
      and (p_since is null or created_at >= p_since)
  ),
  sess as (
    select
      payload->>'sessionId' as sid,
      -- dimensionerna från sessionens FÖRSTA pageview (minsta created_at)
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

-- Bara service-role (dashboardens serverfunktion) får anropa den.
revoke all on function angel_segment_rollup(text, timestamptz) from public, anon, authenticated;
grant execute on function angel_segment_rollup(text, timestamptz) to service_role;
