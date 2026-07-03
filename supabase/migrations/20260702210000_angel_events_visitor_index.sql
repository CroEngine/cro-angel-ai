-- Per-visitor drilldown: the dashboard replays one visitor's history with
-- WHERE site = ? AND visitor_hash = ? ORDER BY created_at. Existing indexes
-- (site+created_at, site+type, decision_id) don't cover that shape.
create index if not exists angel_events_site_visitor_idx
  on public.angel_events (site, visitor_hash, created_at);
