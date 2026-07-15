-- Block 1b (lansering): domänverifiering + notiser.
--
-- Ingest-nyckeln står i kundens publika HTML — den identifierar, den bevisar
-- inget. Beviset på kontroll är att trafik faktiskt kommer från sajtens egen
-- domän: servern matchar Origin/Referer mot registrerad domän, och första
-- matchande signalen stämplar domain_verified_at (= installationskvittot).
-- Serving är stängd tills stämpeln finns.

alter table angel_sites add column if not exists domain_verified_at timestamptz;

-- En domän ↔ en sajt: två konton kan aldrig registrera samma domän.
-- (Appen normaliserar — gemener, utan www./protokoll — innan skrivning.)
create unique index if not exists angel_sites_domain_unique
  on angel_sites (lower(domain)) where domain is not null and domain <> '';

-- Notiser: dedupe-nyckeln gör varje (sajt, händelse, objekt) till EN notis,
-- oavsett hur många gånger triggern råkar köra. service_role-only (RLS på,
-- inga policies) — precis som rollup-tabellerna.
create table if not exists angel_notifications (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  kind text not null,
  dedupe_key text not null,
  email text not null,
  channel text not null default 'log',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (site, kind, dedupe_key, email)
);
alter table angel_notifications enable row level security;
