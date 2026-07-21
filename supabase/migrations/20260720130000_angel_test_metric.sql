-- Engagemangsmålet (ägarbeslut 2026-07-20): sajter med sällsynta konverteringar
-- mäter A/B-testet på CONTINUATION — "gick besökaren vidare till en andra
-- sida?" — i stället för konvertering. Nordstjärnemålet (conversion_text)
-- ändras inte; designen siktar fortfarande dit. Piloten: ~91 % ärligt mätt
-- bounce och 0 organiska konton — continuation är både den verkliga första
-- trattbristen och ett utfall som finns i varje session (mätbart på veckor,
-- inte år).

alter table angel_sites
  add column if not exists test_metric text not null default 'conversion'
  check (test_metric in ('conversion', 'continuation'));

update angel_sites set test_metric = 'continuation' where slug = 'glutenforum.se';

-- angel_variant_arms får en continuations-kolumn: besökare i armen som sett
-- ≥2 distinkta sidor (query/hash-strippade) EFTER första exponeringen.
-- Returtypen ändras ⇒ drop + create (grants återställs nedan).
drop function if exists angel_variant_arms(text, text);

create function angel_variant_arms(p_site text, p_variant text)
returns table (arm text, visits bigint, conversions bigint, continuations bigint)
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
  )
  select
    case when exp.first_type = 'adaptation_shown' then 'variant' else 'control' end as arm,
    count(*) as visits,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from conv)) as conversions,
    count(*) filter (where exp.visitor_hash in (select visitor_hash from cont)) as continuations
  from exp
  group by 1
$$;

revoke all on function angel_variant_arms(text, text) from public, anon, authenticated;
grant execute on function angel_variant_arms(text, text) to service_role;
