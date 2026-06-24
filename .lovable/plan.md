## B0 v4 — konsoliderat direktiv, build-redo

v4 = v3 plus fyra hårda rättningar och två format-klargöranden. Steg-0-grinden, hypotes-formuleringen (B0.3) och D1-landad-detaljen oförändrade.

### Premiss (oförändrad, bekräftad i kod)

Två determinism-lager med disjunkta kollapsregler:

| Lager | Driver | Indata | Kollaps-källa | Diff-form |
|---|---|---|---|---|
| MHTML/capture | `scripts/freeze-determinism-check.ts` | rå `page.mhtml` (QP-encoded) | `mhtml-normalize.ts` | rad-för-rad text |
| Golden/score | `src/lib/tests/snapshot/__tests__/snapshot.test.ts` | `replayCorpus(name)` → `{collect, pageAudit}` | `normalize.ts` (`normalizeCollect`/`normalizePageAudit`/`COOKIE_BANNER_RX`/`normElement`/`normTrustDebug`) | `diffNormalized` på JSON |

`replayCorpus` är broen, även konsumerad av `scripts/render-canary.ts`, `scripts/breadth-replay.ts`, `scripts/breadth-smoke.ts`.

---

### Rättning 1 (huvudfynd) — återinför skydd mot boundary-straddle

v3 dokumenterade kvant-grans-flippen som blindfläck men tog bort båda operativa vakter mot dess farliga halva. Den synliga flippen (diff ≠ ∅ → ingen commit, konservativt safe) är inte hotet. Hotet är **lucky-consistent-rounding**: tre körningar råkar runda likadant precis under en gräns → byte-identisk tmp → falsk-GREEN → committad golden som inte är deterministisk över större N.

**Default write-gate i B-CONTRACT.md = två oberoende tripplar (2×N=3, olika dagar/processer), inte singular trippel.** Singular trippel tillåts endast som villkorad opt-in: explicit deklaration att varje rad i `REPLAY-NONDETERMINISM-SURFACE.md` har status `handled` med levande pin-implementation, OCH att pin-kompletthet är gransknings­granskad i B-CONTRACT.md. Eftersom B0.3 ritar kartan och B implementerar pinningen, är pin-kompletthet vid write-gate-tillfället per konstruktion under fråga → default är 2×N=3, opt-in dokumenteras som framtida förbättring efter mätning.

C-fasens N≥3-per-gren (forward-constraint mot samma falsk-GREEN-mekanism) ska refereras i B-CONTRACT.md som "konsument av samma vakt", även om implementationen ligger i C — så vakten inte tappas mellan dokumenten.

### Rättning 2 — B0.2:s kvant-(b)-rad ska beskriva dold flip

Två blindfläck-rader per kvantiseringsregel:

- **(a) sub-kvant-drift osynlig** — mekanism som rör scoren under stegets storlek göms, ingen diff oavsett.
- **(b) dold boundary-straddle (lucky-consistent-rounding → falsk-GREEN)** — verkligt värde ligger nära gräns; N=3 råkar runda lika; tmp byte-identisk; golden committad som flippar senare körningar. Skyddas av två-trippel-gaten (rättning 1) på write-tidpunkten och N≥3-per-gren i C.

Den synliga halvan (kvant-grans-flip som ger non-empty diff) är inte en blindfläck — det är normal diff-detektering — och tas bort som separat rad. En rad per kollapsregel; kvantregler får TVÅ tabellrader (en (a), en (b)) — se format-klargörande nedan.

### Rättning 3 — generalisera konsument-impact till B0.3

`NORMALIZE-COLLAPSE-SET.md`-kolumnen "Konsument-impact" betyder **vilka golden-fält påverkas av kollapsregeln** (oförändrat). B0.3:s pin-hypotes "om pinning ändrar output, då invaliderar den breadth-sha256/canary-receipt" har inget datafält i v3. Lägg det i `REPLAY-NONDETERMINISM-SURFACE.md` — generalisera nuvarande "Delad med Block D capture-sida?"-kolumn till **fyra konsument-impact-kolumner** (en per `replayCorpus`-konsument):

| Källa | Hanterad idag? | Manifestation i golden-fält | Pin-strategi om nej | Impact: snapshot.test | Impact: render-canary | Impact: breadth-replay | Impact: breadth-smoke | Delad med Block D capture-sida? |

Per impact-cell: `invariant` (pin ändrar inte output), `invalidates: <artefakt>` (t.ex. `breadth-corpus sha256`, `canary-receipt Gate N`), eller `unknown — needs measurement`. Detta är datat som faktiskt resolvar pin-hypotesen.

### Rättning 4 — viewport-pin som egen rad i B0.3

Scroll-position-raderna (IntersectionObserver, lazy-load) täcker inte viewport-bredd/höjd. `area` mäts i px → opinnad viewport skalar area → `score` (kvant 10) → straddle. Egen rad i `REPLAY-NONDETERMINISM-SURFACE.md`:

| Viewport-dimensioner (width × height × DPR) | … | påverkar `score`, `area`, `bgContrast`, `aboveFold` via px-baserad geometri | Fixed viewport i Chromium launch-options, dokumentera värde i B-CONTRACT.md | … |

### Rättning 5 — font-settle-via-canary som delad impl

Lägg explicit instruktion på font-load-raden i `REPLAY-NONDETERMINISM-SURFACE.md` pin-strategi-cellen: **settle-signalen ÄR canary Gate 1** (`src/lib/tests/snapshot/canary-constants.ts` + `render-canary.server.ts`). B återanvänder samma `await`-punkt; växer inte parallell `fonts.ready`-notion. Notering i B-CONTRACT.md att font-settle = canary-delad, inte ny impl.

---

### Format-klargöranden

**a) Diagnos-header i `NORMALIZE-COLLAPSE-SET.md` — restaurera.** Filen inleds med kort prolog (4–6 rader) som etablerar den enande linsen — *"grönt golden-diff kan komma från (i) sann determinism, (ii) kollapsregel som raderar signalen, (iii) kvant som råkar runda lika över N=3"* — och den stående granskningsfrågan vid varje framtida kollapsregel: *"vilken mekanism i `MECHANISM-INVENTORY.md` blir osynlig av denna regel, och är det avsiktligt?"* Det är raden som fångar nästa felaktiga kollaps.

**b) Tabellgranularitet.** En rad per kollapsregel **för raderingsregler**; kvantiseringsregler får **två fysiska tabellrader** (sufix `(a)` och `(b)` i Regel-kolumnen), inte en rad med tvådelad cell. Skäl: enklare grep/diff, varje blindfläck får egen inventerings-referens-cell.

---

### B0.1 — Driver-binär (oförändrat utöver write-gate-default)

Headless Chromium via `replayCorpus`. `pageAudit` läser render-fält → jsdom uteslutet. `extract-golden.ts` anropar `replayCorpus` direkt + samma `normalizeCollect`/`normalizePageAudit`/`diffNormalized` som `snapshot.test.ts`. Enda delta: write-gate + CLI-entry. B-DOM/B-render-uppdelning struken ur `.lovable/plan.md`.

**Exit (uppdaterad):** `B-CONTRACT.md` ≤1 sida, innehåller: driver = headless via `replayCorpus`, golden-shape, **write-gate = 2×N=3 default** (singular-trippel som villkorad opt-in med explicit pin-kompletthets­deklaration), referens till C:s N≥3-per-gren, viewport-värde, font-settle = canary-delad, de tre render-fälten som binder driver-valet.

### B0.2 — Enumerera `normalize.ts`-kollapsuppsättning (grindas av D1)

**Steg 0 (hård grind):** kvittera varje förväntad regel + konstant mot `src/lib/tests/snapshot/normalize.ts` (`yBand=200`, `score=10`, `salience=0.2`, `area=sig1`, `bgContrast=1`, `hostOnly`, `COOKIE_BANNER_RX`-ordlista, `normTrustDebug` default `entries:false`, `normalizePageAudit` drops). Avvikelse → stopp, rapportera, vänta.

Sedan `fixtures/determinism/NORMALIZE-COLLAPSE-SET.md` med prolog (format-klargörande a) + tabell:

| Regel (kod-symbol) | Vad raderas/kvantas | Typ | Blindfläck för B | Blindfläck för C | Konsument-impact (golden-fält) | Inventerings-referens |

Krav: radering = EN blindfläck-rad (fältet finns inte → osynlig mekanism). Kvantisering = TVÅ tabellrader: `(a)` sub-kvant-drift, `(b)` **dold boundary-straddle → falsk-GREEN** (rättning 2). Animation-rad kräver `animation:mid-frame-transform` i `MECHANISM-INVENTORY.md` — D1 redan landad, verifiera vid skrivning. Förväntade regler: `COOKIE_BANNER_RX`, `normElement` (drop selector/attributes/computedStyles/rect; `yBand`; `score`; `salience`; `bgContrast`; `area`; `href`→hostOnly), `elementKey`-sort, `normTrustDebug` default, `normalizePageAudit` drops (`auditedAt`, `httpHeaders`, section-rects, `description`→`hasDescription`), title/h1/hero trim. Ingen explicit animation-transform-kollaps idag → verifiera under skrivning vad `normElement` faktiskt behåller av transform-state.

### B0.3 — Kartlägg `replayCorpus` nondeterminism-yta

`fixtures/determinism/REPLAY-NONDETERMINISM-SURFACE.md` med generaliserad konsument-impact (rättning 3) + viewport-rad (rättning 4) + font-settle-via-canary-instruktion (rättning 5):

| Källa | Hanterad idag? | Manifestation i golden-fält | Pin-strategi om nej | Impact: snapshot.test | Impact: render-canary | Impact: breadth-replay | Impact: breadth-smoke | Delad med Block D capture-sida? |

Källor: CSS-animationer (mid-frame transform), `document.fonts.ready` (pin = canary Gate 1, delad impl), `Date.now()`/`Math.random()`, `requestAnimationFrame`, IntersectionObserver-thresholds, font-load-race (canary-bredder), lazy-load på viewport-events, **viewport-dimensioner (egen rad)**. Pin-hypotes formuleras villkorat: "om pinning ändrar output, då invaliderar den X" — verifieras genom impact-kolumnerna, inte påstås. Impact-celler fylls med `invariant` / `invalidates: <artefakt>` / `unknown — needs measurement`.

---

### Sekvenslås

```text
   D1 (animation:mid-frame-transform — landad)
       │
       ▼
   B0.2 steg 0 (kvittera mot normalize.ts)
       │  └── diff → stopp, rapportera
       ▼
   B0.2 fil   ──┐
   B0.1        ─┼── parallella
   B0.3        ─┘
       │
       ▼
   B-CONTRACT.md committat (2×N=3 default) → B kan börja
```

### Vad denna omgång INTE gör

- Implementerar inte `extract-golden.ts` (B).
- Implementerar inte pinning (B, mot B0.3-kartan).
- Ändrar inte `normalize.ts`/`harness.server.ts`/`mhtml-normalize.ts`.
- Ändrar inte `WHITELIST.md`/`MECHANISM-INVENTORY.md`/`GOLDEN-FIELD-CLASSIFICATION.md`.
- Tar inget C1/C2-beslut.
- Avgör inte empiriskt om hubspots värden straddlar — N≥3-mätningen i B är instrumentet.

### Leverabler (4 filer)

1. `fixtures/determinism/B-CONTRACT.md` — driver, golden-shape, **write-gate = 2×N=3 default + singular-trippel-opt-in-villkor**, C:s N≥3-per-gren-referens, viewport-värde, font-settle = canary-delad.
2. `fixtures/determinism/NORMALIZE-COLLAPSE-SET.md` — diagnos-header (prolog + stående granskningsfråga), tabell efter steg 0; kvantregler = 2 tabellrader, (b) = dold straddle → falsk-GREEN.
3. `fixtures/determinism/REPLAY-NONDETERMINISM-SURFACE.md` — 4 konsument-impact-kolumner, viewport-rad, font-settle-pin = canary Gate 1 delad impl, villkorad hypotes-formulering.
4. `.lovable/plan.md` — stryk B-DOM/B-render-uppdelning, ersätt med "B = ett block, headless via replayCorpus, kontrakt i B-CONTRACT.md, write-gate 2×N=3"; uppdatera leveransstatus med B0 v4-utfall.

Steg-0-grinden hård. Två-trippel-gate default. Dold-flip-rad obligatorisk i B0.2. Per-konsument impact-kolumner i B0.3. Viewport-pin egen rad. Font-settle delad med canary.

---

## Leveransstatus B0 v4 — 2026-06-24

- B-DOM / B-render-uppdelningen är död. B = ett block, headless via `replayCorpus`. Kontrakt i `fixtures/determinism/B-CONTRACT.md`. Write-gate default = 2×N=3.
- **B0.2 steg 0 — kvitterad mot `src/lib/tests/snapshot/normalize.ts`.** Alla förväntade konstanter och regler matchar källan exakt (yBand=200, score=10, salience=0.2, bgContrast=1, area=sig1, hostOnly, COOKIE_BANNER_RX 8-fras-lista, normTrustDebug default entries:false, normalizePageAudit drops auditedAt/httpHeaders/section-rects, description→hasDescription, title/h1/hero trim, elementKey-sort). Inga oväntade extra regler. Inga avvikelser att rapportera.
- **B0.2 fil skriven:** `fixtures/determinism/NORMALIZE-COLLAPSE-SET.md` med granskningslins + steg-0-kvitterings­tabell + regeluppsättning. Kvantregler = två tabellrader vardera ((a) sub-kvant osynlig, (b) dold boundary-straddle → falsk-GREEN). Animation-transform-anmärkning hänvisar till `animation:mid-frame-transform` i `MECHANISM-INVENTORY` (D1 verifierad landad i `scripts/mechanism-inventory.ts:132`).
- **B0.3 fil skriven:** `fixtures/determinism/REPLAY-NONDETERMINISM-SURFACE.md` med fyra konsument-impact-kolumner (snapshot.test, render-canary, breadth-replay, breadth-smoke) + viewport-pin som egen rad + font-settle-pin = canary Gate 1 delad impl. Hypotes-formulering villkorad. Impact-celler markerade `invariant` / `invalidates: <artefakt>` / `unknown — needs measurement`.
- **B0.1:** Konsoliderad i `B-CONTRACT.md` (driver, golden-shape, write-gate, delade pin-punkter, vad kontraktet inte binder).
- **Block B är build-redo** mot detta kontrakt. Pinningen implementeras mot B0.3-kartan; varje pin uppdaterar "Hanterad idag?"-kolumnen och flyttar impact-celler från `unknown` till `invariant` / `invalidates: …`.

