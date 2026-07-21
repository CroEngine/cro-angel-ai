-- Framgångskontraktet (E4b): vad som räknas som vinst för JUST den här
-- varianten — primärt mått, guardrails, MDE (labbets SuccessSpec-format,
-- validerat i appen). Sätts med standardvärde när ägaren startar A/B:t
-- (setVariantStatus) om inget finns: ingen variant mäter utan definierad
-- vinst. NULL = äldre variant; UI faller till standardkontraktet.
alter table public.angel_variants
  add column if not exists success jsonb default null;
