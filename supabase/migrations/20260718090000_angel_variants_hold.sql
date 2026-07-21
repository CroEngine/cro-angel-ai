-- Självläkningens hold-flagga (korssid-lyftet slice 3, ägarbeslut 2026-07-18:
-- "Varianten ska autopausas, tills vi crawlat om den sidan. Så använder vi det
-- nya. Kunden ska inte behöva göra något.")
--
-- MEDVETET en SEPARAT maskinell flagga — INTE en status: statusövergångar är
-- ägarens knappar och bara ägarens (policybeslut 2026-07-12). held_reason sätts
-- och släpps av nattloopens drift-svep när ett insatt citats källtext försvinner
-- respektive när den nya texten passerat samma grindar som första gången.
-- Serving-vägen vägrar hållna varianter (loadServableVariants); ägarens
-- förhandsvisning ser dem fortfarande.
alter table angel_variants
  add column if not exists held_reason text,
  add column if not exists held_at timestamptz;

comment on column angel_variants.held_reason is
  'Maskinellt serveringsstopp (t.ex. källdrift för insatt citat) — INTE en status; null = serverbar enligt status.';
comment on column angel_variants.held_at is
  'När det maskinella stoppet sattes.';
