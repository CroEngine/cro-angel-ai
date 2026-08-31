-- Väntans ärlighet på /try (ägarfynd 2026-08-31: "man vet inte vart man är i
-- väntandet"): sidan visade en pulserande låtsas-stapel medan jobbet byggde.
-- Arbetaren stämplar nu grovfasen här — freeze → analyze → verify — och /try
-- ritar riktiga steg i stället för teater. null = köad, eller rad från före
-- kolumnen (klienten visar då första bygg-steget som aktivt, ärlig degradering).

alter table angel_preview_jobs
  add column if not exists stage text; -- freeze | analyze | verify
