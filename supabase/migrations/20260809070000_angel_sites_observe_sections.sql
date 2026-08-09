-- Sektionsobservationen (CRO-planens steg 9–11) som SAJT-KONFIG i stället för
-- enbart en tagg-attribut.
--
-- Bakgrund: snippeten läste bara `data-observe-sections="1"` från script-taggen,
-- så observationen kunde bara slås på genom att redigera kundens HTML och
-- deploya om deras sajt. Det gör både påslag och — viktigare — AVSTÄNGNING
-- beroende av kundens release-cykel. Beteendemätningen är dessutom precis den
-- sortens sak som ska gå att stänga av på sekunden om något ser fel ut.
--
-- Default false: ingen befintlig sajt börjar mäta av att kolumnen finns.
-- Taggattributet fortsätter gälla och VINNER (explicit per-install-override,
-- samma kontrakt som data-holdout och data-conversion-*).

alter table angel_sites
  add column if not exists observe_sections boolean not null default false;

comment on column angel_sites.observe_sections is
  'Per-sektion-synlighet (section_engagement) på/av för sajten. Levereras till snippeten via /api/adaptive/consent-config. Taggens data-observe-sections vinner.';
