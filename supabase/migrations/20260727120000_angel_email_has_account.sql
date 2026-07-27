-- Enhetlig inloggning/registrering (ägarbeslut 2026-07-27, ChatGPT-mönstret):
-- ETT formulär — e-post först, sedan visar systemet rätt steg 2 (lösenord för
-- befintligt konto, lösenord + visitor-info-intyget för nytt). Det kräver att
-- servern kan svara "finns ett konto för den här adressen?" utan sidoeffekter.
--
-- SECURITY DEFINER mot auth.users, EXECUTE enbart för service_role: bara
-- appens serverfunktion (som kan rate-limita och normalisera fel) får fråga —
-- aldrig anon/authenticated direkt, så enumeration går alltid via vår kod.

create or replace function angel_email_has_account(p_email text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
      and deleted_at is null
  );
$$;

revoke all on function angel_email_has_account(text) from public, anon, authenticated;
grant execute on function angel_email_has_account(text) to service_role;
