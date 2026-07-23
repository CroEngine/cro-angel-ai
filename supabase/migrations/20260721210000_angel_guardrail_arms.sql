-- Guardrail-armar (E4b-mätkopplingen): angel_variant_arms räknar nu också
-- skyddsmåtten per arm, så framgångskontraktets guardrails kan fällas på
-- riktiga besökare (evaluateRuleWithSpec i appen — matten är kalibrerad på
-- 200 simulerade världar, docs/metric-hierarchy.md):
--   cta_clicks    besökare med cta_click efter första exponeringen
--   form_submits  besökare med form_submit efter första exponeringen
--   engaged       besökare med scroll_depth ≥ 60 % efter första exponeringen
--                 (page_leave-aktiv-tid-halvan är en senare förfining)
--   bounce        härleds i appen som visits − continuations (gick aldrig
--                 vidare) — ingen egen kolumn behövs.
-- Returtypen ändras ⇒ drop + create (grants återställs nedan).
drop function if exists angel_variant_arms(text, text);

create function angel_variant_arms(p_site text, p_variant text)
returns table (
  arm text, visits bigint, conversions bigint, continuations bigint,
  cta_clicks bigint, form_submits bigint, engaged bigint
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
    where e.site = p_site and e.type = 'scroll_depth'
      and e.created_at >= exp.first_seen
      and coalesce((e.payload->>'depth')::numeric, 0) >= 60
  )
  select
    case when exp.first_type = 'adaptation_shown' then 'variant' else 'control' end as arm,
    count(*) as visits,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from conv)) as conversions,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from cont)) as continuations,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from clk)) as cta_clicks,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from fsub)) as form_submits,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from eng)) as engaged
  from exp
  group by 1
$$;

revoke all on function angel_variant_arms(text, text) from public, anon, authenticated;
grant execute on function angel_variant_arms(text, text) to service_role;
