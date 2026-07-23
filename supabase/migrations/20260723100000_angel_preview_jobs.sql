-- Prospekt-förhandsvisningens jobbkö (trattens topp, ägarmodellen 2026-07-23):
-- klistra in URL → Actions-arbetaren (preview-jobs.yml, samma isolerade mönster
-- som day0-svepet) bygger exemplet på prospektets EGEN sida → rapport-URL i
-- raden → /try-sidan visar den → CTA in i signup + checkout ("free until your
-- first verified variant").
--
-- RLS på utan policies: BARA service-rollen (API-rutterna + arbetaren) rör
-- tabellen. requester_hash är en HASHAD avsändarnyckel (aldrig rå IP).

create table if not exists angel_preview_jobs (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  status text not null default 'queued', -- queued | running | ok | failed
  report_url text,
  findings jsonb,
  error text,
  requester_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table angel_preview_jobs enable row level security;

create index if not exists angel_preview_jobs_status_idx
  on angel_preview_jobs (status, created_at);
create index if not exists angel_preview_jobs_requester_idx
  on angel_preview_jobs (requester_hash, created_at);
-- Dedupe-uppslag: samma URL nyligen ⇒ återanvänd jobbet i stället för att
-- bygga om samma exempel.
create index if not exists angel_preview_jobs_url_idx
  on angel_preview_jobs (url, created_at);
