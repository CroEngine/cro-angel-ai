-- Goal judgment: instead of auto-committing a single conversion goal, harvest
-- now proposes a RANKED list of candidate goals (primary + secondaries), each
-- mapped to a real harvested CTA, with a detected "kind" (signup, purchase,
-- outbound/affiliate, lead, start_flow, ...). The owner confirms one as the
-- active goal in the dashboard (conversion_selector + conversion_source='owner');
-- until then nothing is highlighted or measured. Stored as jsonb:
--   { businessType, version, goals: [{selector,text,href,kind,rank,confidence,source}] }
alter table public.angel_sites add column if not exists goal_candidates jsonb;
