# Datahygien — läs-tidsrensning av pilotdatan

Revision 2026-07-20 (5 oberoende granskare + skeptiker-verifiering av varje
fynd, 38 fynd överlevde, 0 fälldes) av ALL insamlad glutenforum-data.
Grundregel: **rådata raderas aldrig** — all rensning sker vid läsning så
besluten kan omprövas mot orörd data.

## Vad som exkluderas (och varför)

| Vad | Omfång | Fynd |
|---|---|---|
| Tre lasttest-burstar (exakta tidsfönster) | 652 events, 60 sessioner | BOT-1 (bekräftat: 0 oskyldiga i fönstren) |
| Ägar-/utvecklar-hashar (12 st) | ~390 events | OWNER-1/3/4/6 (admin-inloggning bevisar) |
| /admin-sidor | ~63 events | OWNER-4 (generell regel, alla sajter) |
| twitter/bing-källor (demo-simulatorn) | hela sessioner | OWNER-5 (100 % syntetiska) |
| paths med angel_-params | ~2 events | OWNER-5 (generell regel) |
| payload.simulated=true | framåt | ny snippet-flagga |
| conversion/cta_click före 2026-07-20 | 5+3 rader | OWNER-2 (bekräftat: 100 % ägare/test) |
| conversion-dubbletter (samma nyckel, ±5 s) | framåt | EI-1 (ett klick → två rader) |

Resultat på piloten: 3 757 råa events → ~2 700 rena; 271 rena sessioner;
0 organiska konverteringar (den enda "konverteringen" var ägarens egen
adapterade testsession — baslinjen är beteendedata, inte konverteringsgrad).

## Var reglerna bor (håll i synk!)

- **TS-läslagret:** `src/lib/dashboard/data-hygiene.ts` (`cleanEvents`) —
  appliceras i `getDashboard` (alla dashboard-ytor) och `loadPatternBoosts`
  (motorns feedback). Gör dessutom sessions-KASKADEN för simulatorkällor.
- **SQL-vyn:** `angel_events_clean` (migration
  `20260720100000_angel_events_clean.sql`) — samtliga rollup-RPC:er
  (`angel_segment_rollup`, `angel_variant_arms`, `angel_page_segment_rollup`,
  `angel_page_flow_rollup`) läser vyn, inte råtabellen. OBS NULL-säkringen:
  `coalesce(visitor_hash,'')` — utan den NULL-förgiftas OR-kedjan och hela
  pre-sessionId-eran försvinner tyst (hänt, fångat vid live-verifiering).

## Snippet-skydden framåt (samma revision)

- `?angel_ignore=1` → permanent localStorage-flagga, Angel helt av i den
  webbläsaren (ägarens opt-out; lagras medvetet utan consent-grind, som GPC).
- `/admin`-paths bootar aldrig trackern.
- Demo-overrides (`angel_source/device/returning/debug`) sätter
  `simulated:true` på alla events; `angel_`-params rapporteras aldrig i URL:er.
- isReturning-lagningen: besöksräknaren läses OM efter async-consent-
  uppgraderingen (den lästes förr bara vid boot, före lagringsrätt → alla
  besökare såg ut som nya). E2E-bevisad på attested-vägen.
- EN conversion per sidladdning (dubbelloggnings-vakten).

## Era-gränser för analys (inte exkludering — jämförbarhet)

- Före 2026-07-08 22:11 UTC: inget sessionId — oanvändbart för resor/sessioner.
- Före 2026-07-19 19:35 UTC: SPA-fixen saknas — sidor/session underskattas.
- Före 2026-07-19 22:20 UTC: gamla adaptationsmotorn var PÅ — beteendet är
  "behandlat", inte neutral baslinje. Helt ren baslinje växer från 07-19 22:20.
- scroll_depth med path finns från 2026-07-19 14:37; site_search/video_watch
  från 2026-07-19/20.

Fullständigt revisionsunderlag: workflow-körning wf_1da0becb (38 fynd med
SQL-bevis och skeptiker-domar per fynd).
