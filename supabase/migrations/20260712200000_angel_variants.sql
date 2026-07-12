-- Fas 4 steg 2 (docs/fas4-per-segment-serving.md): variant-lagret + master-switchen.
--
-- En verifierad redesign-variant = en kort lista reversibla ops (samma vokabulär
-- snippeten redan applicerar) knuten till ett segment-PREFIX (samma grov→fin-nyckel
-- som dashboard-rollupen: "google" | "google·mobile" | "google·mobile·se"). Livscykel:
-- candidate → verified (alla Fas 3-grindar PASS) → serving (ägaren slog på) →
-- winner | retired. Bara serving/winner får någonsin nå en besökare
-- (redesign/serve.ts matchVariant), och INGET serveras alls förrän både
-- angel_sites.serving_enabled (master, default AV) och variantens status säger det.
-- evidence bär spårbarheten: grind-verdikt, skärmdumps-referenser, claims-diff.
--
-- Åtkomst som angel_site_members: service-role-server, RLS låst utan
-- anon/auth-policyer — ägarskap upprätthålls i dashboardens serverfunktioner.

create table if not exists public.angel_variants (
  id          uuid primary key default gen_random_uuid(),
  site        text not null,
  path        text not null default '/',
  segment_key text not null,
  status      text not null default 'candidate'
              check (status in ('candidate','verified','serving','winner','retired')),
  ops         jsonb not null default '[]',
  evidence    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists angel_variants_site_path_idx
  on public.angel_variants (site, path, status);

-- Högst EN aktivt serverad variant per (site, path, segment) — två varianter som
-- slåss om samma segment vore ett odefinierat A/B.
create unique index if not exists angel_variants_one_serving_idx
  on public.angel_variants (site, path, segment_key)
  where status in ('serving','winner');

alter table public.angel_variants enable row level security;

-- Master-switchen för servering: AV som standard (ägarbeslut 2026-07-12 —
-- aktivering är en manuell dashboard-toggle, aldrig implicit). decide-vägen
-- läser den inte ännu; kolumnen landar före inkopplingen så att default=false
-- är på plats innan någon kod kan servera.
ALTER TABLE angel_sites
  ADD COLUMN IF NOT EXISTS serving_enabled boolean NOT NULL DEFAULT false;
