-- Bounce som primärmått (ägarbeslut 2026-08-15) ------------------------------
--
-- VARFÖR: glutenforum har 24 konverteringar på 45 dagar och NOLL i den enda
-- live-cellen. Konvertering kan aldrig avgöra ett A/B på den trafiken. Bounce
-- kan — men bara med rätt definition, och den fanns inte i systemet.
--
-- DEFINITIONEN ÄR MÄTT VALD, INTE TYCKT. Tre kandidater mot 1 503 riktiga
-- besökare på glutenforum, på exakt den här funktionens grain (besökare, från
-- första exponeringen):
--     "gick aldrig vidare"                      92,4 %  <- oduglig
--     + inga klick                              85,0 %  <- svag
--     + inte engagerad (denna)                  56,8 %  <- nära 50/50
-- Variansen p(1-p) maximeras vid 50 %, så den tredje ger flest domslut per
-- besökare. Den första — GA:s standarddefinition, och den som koden HITTILLS
-- härledde som `visits - continuations` — hade bytt ett omätbart mått mot ett
-- nästan lika omätbart: komplementet är 7,6 %.
--
-- En bounce är alltså en besökare som från sin första exponering gjorde
-- INGENTING: stannade på en sida, klickade aldrig, och nådde varken 60 %
-- scroll eller 30 sekunders engagerad tid. Termerna är exakt desamma som
-- cont/clk/eng nedan redan definierar, negerade — ingen ny tröskel införs, så
-- måtten kan aldrig säga emot varandra.
--
-- KLICK RÄKNAS BREDARE ÄN cta_clicks-kolumnen: element_click ingår. På
-- glutenforum finns 1 155 element_click mot 22 cta_click, så en bounce-
-- definition som bara såg CTA:er hade kallat nästan varje interaktion tyst.
--
-- Kolumnen ADDERAS sist: befintliga anropare läser på namn och rörs inte.

create or replace function public.angel_variant_arms(p_site text, p_variant text)
returns table(
  arm text, visits bigint, conversions bigint, continuations bigint,
  cta_clicks bigint, form_submits bigint, engaged bigint, deep_scrolls bigint,
  bounces bigint
)
language sql
stable
set search_path to 'public'
as $function$
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
  -- Bounce-vaktens klickmängd: ALLA interaktionsklick, inte bara CTA:er.
  anyclk as (
    select distinct e.visitor_hash
    from angel_events_clean e
    join exp on exp.visitor_hash = e.visitor_hash
    where e.site = p_site and e.type in ('cta_click', 'element_click')
      and e.created_at >= exp.first_seen
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
    count(*) filter (where exp.visitor_hash in (select visitor_hash from dscr)) as deep_scrolls,
    count(*) filter (
      where exp.visitor_hash not in (select visitor_hash from cont)
        and exp.visitor_hash not in (select visitor_hash from anyclk)
        and exp.visitor_hash not in (select visitor_hash from eng)
    ) as bounces
  from exp
  group by 1
$function$;

-- test_metric får ett tredje läge. Villkoret räknade tidigare bara upp
-- conversion/continuation, så en bounce-sajt hade avvisats av databasen.
alter table public.angel_sites drop constraint if exists angel_sites_test_metric_check;
alter table public.angel_sites add constraint angel_sites_test_metric_check
  check (test_metric = any (array['conversion'::text, 'continuation'::text, 'bounce'::text]));
