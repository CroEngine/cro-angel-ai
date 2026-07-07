-- v1-produktdefinitionen (docs/v1-testdefinition.md): nivå 3-mönster (layout —
-- flytta/omstrukturera sektioner) är AV som standard och kräver uttrycklig
-- opt-in per sajt, efter pre-flight + ägargodkännande. Nivå 1–2 (emphasis +
-- guidance) är produkten; layout är ett senare, per-sajt-beslut.
ALTER TABLE angel_sites
  ADD COLUMN IF NOT EXISTS layout_patterns_enabled boolean NOT NULL DEFAULT false;
