-- Evidens-skärmdumpar (FÖRE/EFTER) för varianter — publik läsning (bilderna
-- visas i ägarens dashboard och innehåller bara kundens egen publika sida),
-- skrivning endast via service-rollen (nattloopen). Applicerad i prod
-- 2026-07-15.
insert into storage.buckets (id, name, public)
values ('angel-evidence', 'angel-evidence', true)
on conflict (id) do nothing;
