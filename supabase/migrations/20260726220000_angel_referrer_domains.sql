-- Referrer-domäner för "other websites"-hinken (ägarbeslut 2026-07-26:
-- "samla nu, visa senare"). Klassificeraren har en igenkänningslista
-- (google/socialt/sök/UTM) — allt ANNAT med en referrer blir kanalen "other",
-- och den här tabellen svarar på vilka sajter det faktiskt är: föreningar,
-- forum, matbloggar, AI-assistenter… Datat går inte att backfilla, därför
-- börjar räkningen nu även om dashboardlistan väcks först vid volym.
--
-- INTEGRITET: bara domänen (bare host), aldrig full URL, aldrig besökar-
-- koppling — en (sajt × domän × dag)-räknare är aggregat, inte beteendedata.
-- Skrivs ändå bara för samtyckta besök (samma hållning som events-vägen).
--
-- RLS på utan policies: BARA service-rollen (decide-vägen + dashboardens
-- serverfunktioner) rör tabellen.

create table if not exists angel_referrer_domains (
  site text not null,
  domain text not null,
  day date not null default (now() at time zone 'utc')::date,
  visits integer not null default 0,
  primary key (site, domain, day)
);

alter table angel_referrer_domains enable row level security;

create index if not exists angel_referrer_domains_site_idx
  on angel_referrer_domains (site, day);

-- Atomisk räknar-bump — decide-vägen anropar denna (en indexerad upsert,
-- bara på "other"-klassade besök, aldrig i den heta vägen för kända kanaler).
create or replace function angel_bump_referrer_domain(p_site text, p_domain text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into angel_referrer_domains (site, domain, day, visits)
  values (p_site, p_domain, (now() at time zone 'utc')::date, 1)
  on conflict (site, domain, day)
  do update set visits = angel_referrer_domains.visits + 1;
$$;

-- Topplistan (all tid, summerad per domän). Dashboardens serverfunktion
-- tröskelgrindar själv (visa inget under volymen) — RPC:n är rå läsning.
create or replace function angel_referrer_domains_top(p_site text, p_limit integer default 8)
returns table(domain text, visits bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select domain, sum(visits)::bigint as visits
  from angel_referrer_domains
  where site = p_site
  group by domain
  order by visits desc, domain
  limit greatest(1, least(coalesce(p_limit, 8), 25));
$$;
