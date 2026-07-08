-- Observe-first-pivoten (docs/croengine-vision.md, 2026-07-08): Angel är
-- OSYNLIGT som standard. När adaptations_enabled är false returnerar decide
-- inga adaptationer och loggar ingen exponering — snippeten observerar bara
-- (journey, struktur, prestanda). Opt-in per sajt aktiverar apply-vägen
-- (nivå 1-2, och med layout_patterns_enabled även nivå 3). Ringen/emfasen
-- syns alltså inte förrän en sajt uttryckligen slår på det.
ALTER TABLE angel_sites
  ADD COLUMN IF NOT EXISTS adaptations_enabled boolean NOT NULL DEFAULT false;
