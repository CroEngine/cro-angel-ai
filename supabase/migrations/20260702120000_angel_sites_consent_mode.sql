-- Owner-attestation consent mode for a customer site.
--
-- Angel runs ANONYMOUS by default (no persistent id, no behavioural events —
-- see docs/consent-gate.md). The site owner is the data controller: from the
-- dashboard they can ATTEST that they have a lawful basis / visitor consent to
-- run Angel in full (persistent id + measurement). This column is that switch.
--
--   'anonymous' — default. Snippet runs storage-free until an on-page CMP grant.
--   'attested'  — owner confirmed lawful basis; snippet treats visitors as
--                 consented at baseline. GPC/DNT remain a hard per-visitor
--                 opt-out even when attested (resolved client-side).
--
-- The value is served (read-only, cached) to the snippet by
-- GET /api/adaptive/consent-config?site=SLUG. Best-effort: a missing column /
-- unreachable store degrades to anonymous.

alter table public.angel_sites
  add column if not exists consent_mode text not null default 'anonymous'
    check (consent_mode in ('anonymous', 'attested'));
