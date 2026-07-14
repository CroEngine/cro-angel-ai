# Språktäckning för CTA-förståelsen (2026-07-14)

**Ägarens beslut:** "svenska + engelska på alla möjliga språk som finns i
världen — inte bara engelska och svenska."

**Ärlig arkitektur:** ordlistor kan aldrig täcka alla språk — och behöver
inte. Täckningen är tre lager, där listorna är GOLVET och aldrig taket:

| Lager | Var | Täcker | Kostnad |
|---|---|---|---|
| 0. Ägarens mål (`conversion_text`/`selector`/`url`) | snippet + grindar | **alla språk** — exakt sträng/selektor | 0 |
| 1. Strukturregler (form-submit, tel:/mailto:, social-värdar, positions-fallback, flik-ankare) | delade klassificeraren | **alla språk** — språklösa signaler | 0 |
| 2. Deterministisk vokabulär | `shared/intent.ts` (inlinas i browser-skripten) | **~30 storspråk**: en, sv, de, fr, es, pt, it, nl, da, no, fi, pl, cs, ru, uk, el, tr, ar, he, hi, ja, zh (förenklad+traditionell), ko, vi, th, id/ms | 0 — offline, även i webbläsaren |
| 3. LLM-etiketteraren (`labeler.server.ts` via `cta-llm.server.ts`) | server-sidan (redesign-kedjan, crawler-inventoriet) | **alla språk** — bara kandidater golvet dömde "unknown", konfidensgolv `LLM_CONFIDENCE_FLOOR` (0.7), cachad | liten; kräver `ANTHROPIC_API_KEY`, fail-open till golvet utan |

## Var lagren verkar

- **Serve-tid (besökarens sida):** ingen intent-klassificering alls —
  konverteringar räknas mot ägarens mål (lager 0). Redan språk-universellt.
- **Harvest/audit i webbläsaren:** lager 1+2 (browser-JS kan inte anropa
  LLM per element). Servern förfinar sedan med lager 3 (`llmRole` +
  `resolveRole`) — inventoriet blir språk-universellt när nyckeln finns.
- **Redesign-kedjan (brief + CTA-hit-test):** lager 2 via
  `extractCtaCandidates` → lager 3 via `addLlmCtas` (acquisition ⇒
  conversion) → lager 0 unionas alltid in i hit-testet. Utan nyckel står
  golvet ensamt och **vakuum-varningen** i render-gates säger till när det
  inte räckte — aldrig tyst.

## Regex-säkerhetsregler (för framtida ord — läs innan du rör listan)

- `\b` är ASCII-bundet i JS: använd BARA runt helt ASCII-rena ord
  (`\bkaufen\b` så "verkaufen" aldrig träffar). Ord vars första/sista tecken
  är icke-ASCII får ALDRIG `\b`-ankras (`/\bкупить\b/` kan aldrig matcha).
- Icke-latinska skript matchas som rena substrängar (som svenskan alltid
  gjorts).
- Login-tvetydiga ord hör hemma i NAVIGATION, aldrig conversion: de
  "anmelden", ar "تسجيل الدخول", ja "ログイン" osv. Konservativ exkludering
  slår att felkalla en login-knapp för money action.
- Kända fällor med test: "verkaufen"/"Einkaufen" (de), "Onze boeken" (nl,
  böcker), "İndirim" (tr, rea — turkiskt İ case-foldar inte till i),
  "Daftar Isi" (id, innehållsförteckning), "Employee handbook" (en).

**Verifierat vid införandet:** 514 enhetstester (positiva per språkfamilj +
negativa substrängtester), snapshot-sviterna oförändrade, breddtestets 13
EN/SV-sajter byte-identiska före/efter (noll falska positiver från de nya
språken), LLM-lagret DI-testat (batch-urval, konfidensgolv, fail-open).
Live-test av lager 3 kräver API-nyckel (finns i prod/CI, inte i denna
sandlåda) — logiken är enhetstestad, etiketteraren har egna tester sedan
tidigare.
