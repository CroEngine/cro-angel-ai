# Journey intelligence — datamodell & integritet (blueprint)

> Vad snippeten samlar, hur det lagras i tre nivåer, och var integritets-
> gränserna går. Grundprincipen (ägaren, 2026-07-08): **anonym journey
> intelligence → segment insights → säkra adaptationer.** Inte "spara allt
> användaren gör" — spara en anonym beteenderesa som går att översätta till
> BESLUT. Byggt privacy-by-design (GDPR-grundprinciperna, ePrivacy/EDPB —
> reglerna gäller ALL lagring/åtkomst på enheten, inte bara cookies).

## Varför resan, inte sidvisningar

En sidvisning säger "någon var här". En resa säger vad de försöker förstå:

```
Pricing → FAQ → Security → Case study → Book demo   → hög intent, behöver trygghet
Hero CTA → Demo page → Form start → Drop-off         → CTA:n funkar, formuläret tappar dem
```

Klickordningen är kärnsignalen. Motorn ska kunna svara: *Vem är besökaren
sannolikt? Vad vill de? Var tvekar de? Vilken hjälp/CTA/trust borde visas?
Har det fungerat för liknande besökare förr?*

## Tre lagringsnivåer

| Nivå | Vad | Retention | Syfte |
|---|---|---|---|
| **1. Rå events** | page_view, element_click, scroll_depth, form_start/error/submit/abandon, page_leave, conversion, page_perf, page_structure | Kort (30–90 d) | Debugging + bygga nivå 2 |
| **2. Session summary** | Kanal, sidordning, klickordning, intent-signaler, drop-off, konvertering ja/nej, aktiv adaptation + utfall | Lång | **Viktigast för motorn** — en resa per anonym session |
| **3. Segment insights** | "Segment X → problem Y → möjlig åtgärd Z, confidence" | Lång, aggregat | Driver adaptionen |

Nivå 2+3 är ännu inte byggda (nästa faser). Nivå 1 + session-ryggraden
(anonymt `session_id` som binder samman resan) byggs nu.

## Vad snippeten SAMLAR (allt consent-gatat)

**Acquisition:** referrer-domän, utm_source/medium/campaign, landing page (path).
**Session:** anonymt `session_id` (per flik, rensas när fliken stängs),
tidsstämpel, device-typ, förenklad browser, ev. land/region — aldrig exakt plats.
**Behavior:** page views, CTA-klick, komponentklick (ordning!), scroll-djup,
tid på sida (aktiv), sidordning, klickordning, exit-sida.
**Conversion:** demo bokad, konto skapat, form startat/ifyllt/avbrutet.
**Experiment/adaptation:** vilken variant/adaptation besökaren såg + om den
ledde till bättre/sämre utfall (via `decisionId` + hold-out-armen).

## Vad snippeten ALDRIG SAMLAR

namn · e-post · telefon · fritext från formulärfält (bara att fältet
startades/avbröts, aldrig innehållet) · exakta musrörelser · tangenttryck ·
full IP · fullständig raw user-agent (bara förenklad device/browser) ·
skärminspelningar · känsliga URL-parametrar (email, token, order_id — se nedan).

## Integritetsgränser i koden (var det faktiskt hålls)

1. **Consent först.** `send()` släpper INGET utan samtycke; GPC/DNT och
   `data-consent="denied"` hoppar över hela rundturen. `session_id` och
   `visitor_hash` skrivs bara i consented läge.
2. **Anonyma id:n.** `session_id` (sessionStorage, per flik) och `visitor_hash`
   (localStorage) är slumpade UUID — aldrig namn/e-post/person-id. Ingen IP
   lagras (servern läser `cf-ipcountry` för land men sparar aldrig adressen).
3. **URL-minimering.** Både den skickade sid-URL:en och referrern rensas:
   query/hash strippas, och en allowlist (`utm_*`, `angel_*`) släpps igenom —
   allt annat (email/token/order_id) tas bort FÖRE sändning (klient) OCH i
   `sanitizeAudit`/href-scrubben (server). Dubbelt skydd.
4. **Komponent-referens, inte sidans text.** Ett klick sparas som elementets
   `id` / `data-angel-ref` / `aria-label` / kort etikett — inte hela DOM-texten,
   och PII-skrubbat.
5. **Ingen fält-data.** Formulär-lifecyclen (start/error/submit/abandon) bär
   bara formulärets art + en referens, aldrig fältvärden.
6. **Retention (att bygga):** rå events 30–90 d, session summaries längre.
   Kräver en schemalagd radering (Supabase pg_cron) — separat infra-steg.

## Consent-koppling (vad får samlas när)

| Läge | Samlas |
|---|---|
| Före samtycke / GPC/DNT / denied | Inget skickas, inga id:n skrivs |
| `anonymous` (default, ny sajt) | Inget beteende (ingen `visitor_hash` att attribuera till) |
| `attested` (ägaren bekräftat rättslig grund) | Full anonym journey enligt ovan |

Kunden ska enkelt kunna beskriva detta i sin cookie-/privacy-policy: "anonym
besöksresa, inga direkta personuppgifter, X dagars lagring, ingen tredjelands-
överföring". (IMY:s Google Analytics-beslut: bygg med dataminimering + EU-tänk.)

## Roadmap

- **Nu (nivå 1 + ryggrad):** session_id, klickordning (`element_click`),
  form-lifecycle, aktiv tid + exit (`page_leave`), URL-minimering.
- **Nästa (nivå 2):** server-rollup till en session summary per `session_id`.
- **Sedan (nivå 3):** segment insights som motorn läser för att FÖRESLÅ
  (aldrig direkt utföra) säkra nivå-1–2-adaptationer.
- **Infra:** retention-jobb (pg_cron) innan skarp drift på riktig trafik.
