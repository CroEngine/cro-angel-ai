-- Guardrail-armar v2: engaged får sin aktiv-tid-halva (page_leave.engagedMs
-- ≥ 30 s — katalogdefinitionen "≥60 % scroll ELLER ≥30 s") och deep_scrolls
-- (scroll_depth ≥ 80 %) räknas. Returtypen ändras ⇒ drop + create.
drop function if exists angel_variant_arms(text, text);

create function angel_variant_arms(p_site text, p_variant text)
returns table (
  arm text, visits bigint, conversions bigint, continuations bigint,
  cta_clicks bigint, form_submits bigint, engaged bigint, deep_scrolls bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with exp as (
    select visitor_hash, min(created_at) as first_seen,
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
    where e.site = p_site and e.type = 'conversion' and e.created_at >= exp.first_seen
  ),
  cont as (
    select e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site and e.type = 'pageview' and e.created_at >= exp.first_seen
    group by e.visitor_hash
    having count(distinct coalesce(
      nullif(split_part(split_part(e.payload->>'path', '#', 1), '?', 1), ''), '/')) >= 2
  ),
  clk as (
    select distinct e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site and e.type = 'cta_click' and e.created_at >= exp.first_seen
  ),
  fsub as (
    select distinct e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site and e.type = 'form_submit' and e.created_at >= exp.first_seen
  ),
  eng as (
    select distinct e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site and e.created_at >= exp.first_seen
      and (
        (e.type = 'scroll_depth' and coalesce((e.payload->>'depth')::numeric, 0) >= 60)
        or (e.type = 'page_leave' and coalesce((e.payload->>'engagedMs')::numeric, 0) >= 30000)
      )
  ),
  dscr as (
    select distinct e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site and e.type = 'scroll_depth'
      and e.created_at >= exp.first_seen
      and coalesce((e.payload->>'depth')::numeric, 0) >= 80
  )
  select
    case when exp.first_type = 'adaptation_shown' then 'variant' else 'control' end as arm,
    count(*) as visits,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from conv)) as conversions,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from cont)) as continuations,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from clk)) as cta_clicks,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from fsub)) as form_submits,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from eng)) as engaged,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from dscr)) as deep_scrolls
  from exp
  group by 1
$$;

revoke all on function angel_variant_arms(text, text) from public, anon, authenticated;
grant execute on function angel_variant_arms(text, text) to service_role;
