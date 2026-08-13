-- Atomisk winner→retired-transition MED jsonb-merge av wasWinner-markören
-- (granskningsfynd 2026-08-13). Dashboardens winnerWithdrawal läste hela
-- evidence-objektet och skrev tillbaka det med wasWinner tillagt; det
-- optimistiska låset (.eq status) skyddade bara status, inte evidence — så en
-- SAMTIDIG nattloop-skrivning av evidence.comparison/screenshots (mellan
-- läsning och skrivning) klobbrades tyst med en inaktuell kopia. Denna RPC gör
-- statusövergången och markör-mergen i EN sats: `||` slår ihop wasWinner in i
-- vad evidence än är JUST NU, så samtidiga evidence-fält överlever.
--
-- Låset: `where status = 'winner'` — en samtidig/redan utförd övergång ger
-- noll rader och rpc:n returnerar false (dashboarden tolkar som no-op, precis
-- som det gamla optimistiska låset).
create or replace function public.angel_retire_winner(p_site text, p_variant uuid)
returns boolean
language plpgsql
as $$
declare
  touched int;
begin
  update public.angel_variants
     set status     = 'retired',
         updated_at = now(),
         evidence   = coalesce(evidence, '{}'::jsonb) || '{"wasWinner": true}'::jsonb
   where id = p_variant
     and site = p_site
     and status = 'winner';
  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;
