-- Fas 4 steg 3 (docs/fas4-per-segment-serving.md): serveringens config + mätning.
--
-- 1) ramp_pct — ägarbeslut 2 (2026-07-12): trafikandelen till variant-armen
--    börjar på 5 % och rampas manuellt (5 → 10 → 25 → 50). Aldrig 50/50 från
--    start; skadan begränsas om en variant är tekniskt OK men dålig för
--    konvertering/UX. Gäller bara när serving_enabled=true (master, default AV).
alter table public.angel_sites
  add column if not exists ramp_pct integer not null default 5
  check (ramp_pct between 1 and 50);

-- 2) serve_ops — variantens MASKINELLT applicerbara ops, upplösta vid
--    verifieringen. `ops` är designplanen (targetId = sektions-id i innehålls-
--    modellen, prosa-detail) och räcker inte i en besökares webbläsare; en
--    serve-op bär i stället en DOM-lokator (rubriktext + tagg) och det faktiska
--    nya textvärdet. En variant utan giltiga serve_ops kan aldrig serveras
--    (decide-vägen väljer bort den — fail closed).
--    Form: [{ "op": "move_up"|"set_text", "locator": {"tag"?: "h1", "text": "..."},
--            "value"?: "...", "why"?: "..." }]
alter table public.angel_variants
  add column if not exists serve_ops jsonb not null default '[]';

-- 3) angel_variant_arms — A/B-armarna för EN variant, aggregerat i databasen
--    (samma skäl som angel_segment_rollup: JS-fönstret på 5000 events gör
--    volymgrindarna opålitliga). Exponeringar loggas av decide-vägen som
--    adaptation_shown (variant-arm) / adaptation_withheld (kontroll) med
--    "variant:<id>" i payload.patterns. En besökare räknas EN gång, i den arm
--    hens FÖRSTA exponering satte (deterministisk bucketing gör armbyte till
--    ett ramp-ändrings-undantag, inte regel). Konvertering räknas när samma
--    visitor_hash har ett conversion-event EFTER första exponeringen.
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
    from angel_events
    where site = p_site
      and type in ('adaptation_shown', 'adaptation_withheld')
      and visitor_hash is not null
      and payload->'patterns' ? ('variant:' || p_variant)
    group by visitor_hash
  ),
  conv as (
    select distinct e.visitor_hash
    from angel_events e
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

-- Bara service-role (dashboardens serverfunktion) får anropa den.
revoke all on function angel_variant_arms(text, text) from public, anon, authenticated;
grant execute on function angel_variant_arms(text, text) to service_role;
