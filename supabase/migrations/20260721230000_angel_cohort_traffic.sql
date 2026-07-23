-- Kohorttrafik för scope-planeraren (cohort-scopes.ts): exponeringarnas
-- loggade dims aggregerade per kombination — nycklarna härleds i appen med
-- SAMMA mappning som live-vägen (cohortKeysFromDims), aldrig i SQL.
create or replace function angel_cohort_traffic(p_site text, p_days int default 30)
returns table (
  traffic_source text, is_returning boolean, viewed_pricing boolean, visitors bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    payload->>'trafficSource' as traffic_source,
    coalesce((payload->>'isReturning')::boolean, false) as is_returning,
    coalesce((payload->>'viewedPricing')::boolean, false) as viewed_pricing,
    count(distinct visitor_hash) as visitors
  from angel_events_clean
  where site = p_site
    and type in ('adaptation_shown', 'adaptation_withheld')
    and visitor_hash is not null
    and created_at >= now() - make_interval(days => greatest(1, p_days))
  group by 1, 2, 3
$$;

revoke all on function angel_cohort_traffic(text, int) from public, anon, authenticated;
grant execute on function angel_cohort_traffic(text, int) to service_role;
