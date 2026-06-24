# B-CONTRACT.md

Kontrakt för Block B (golden-extraktion). Detta dokument fastställer driver, golden-shape, write-gate och delade pin-punkter med andra block. Allt annat (implementation av `extract-golden.ts`, faktisk pinning) ligger utanför detta dokument.

> **Granskningslins (gäller alla framtida ändringar av kontraktet):**
> Grönt resultat (byte-identiska tmp över N=3) kan komma från (i) sann determinism, (ii) kollapsregel i `normalize.ts` som raderar variationen, eller (iii) kvantiseringssteg som råkar runda lika under en gräns. Innan en regel relaxas, identifiera vilken av (i)/(ii)/(iii) som producerade grönt.

## 1. Driver

**Headless Chromium via `replayCorpus(name)`** — samma kodväg som `src/lib/tests/snapshot/__tests__/snapshot.test.ts`, `scripts/render-canary.ts`, `scripts/breadth-replay.ts`, `scripts/breadth-smoke.ts`.

**Pre-determinerande fält** (gör jsdom omöjlig som alternativ):
- `visualWeight.area` — kräver layout-engine (px-baserad geometri).
- `bgContrast` — kräver beräknad bakgrundsfärg (komposition + CSS-cascade).
- font-canary-bredder (`render-canary.server.ts`) — kräver verklig font-metrik.

`extract-golden.ts` ska anropa `replayCorpus` **direkt** och samma `normalizeCollect`/`normalizePageAudit`/`diffNormalized` från `src/lib/tests/snapshot/normalize.ts` som `snapshot.test.ts`. Noll driver-divergens by construction. Enda deltat mot test-banan är write-gate (sektion 3) och CLI-entry.

B-DOM / B-render-uppdelningen från tidigare planer är död — B är ett block, headless.

## 2. Golden-shape

JSON-objektet returnerat av:

```ts
{
  collect: normalizeCollect(collect),
  pageAudit: normalizePageAudit(pageAudit),
}
```

Form-stabilitet ägs av `normalize.ts`. Vilka fält som faktiskt finns och vilka som raderas/kvantas listas i `NORMALIZE-COLLAPSE-SET.md`.

## 3. Write-gate

**Default: 2×N=3 (två oberoende tripplar).**

| Steg | Krav |
|---|---|
| Trippel A | N=3 körningar samma process, alla tre normalize-outputs byte-identiska, skrivs till tmp |
| Trippel B | N=3 körningar, **separat process, separat dag (eller minst separat tidszon-jitter / kall fontcache)**, byte-identiska, byte-identiska MED trippel A |
| Commit | Endast om A==B. Annars stopp, rapportera. |

**Motivation:** den synliga halvan av kvant-grans-flippen (diff ≠ ∅) fångas av enkel diff. Den dolda halvan — *lucky-consistent-rounding* — är när alla N=3 i en trippel råkar runda lika strax under en gräns och producerar byte-identisk tmp som **inte är deterministisk över större N**. Två oberoende tripplar reducerar sannolikheten för samma rundnings-sammanträffande dramatiskt utan att skala N på dyrt sätt. Se `NORMALIZE-COLLAPSE-SET.md` rad-(b)-för-varje-kvantregel.

**Villkorad opt-in: singular trippel (N=3, en omgång).** Tillåts endast om båda gäller:
1. Varje rad i `REPLAY-NONDETERMINISM-SURFACE.md` har kolumn "Hanterad idag?" = `handled` med levande pin-implementation refererad.
2. Pin-kompletthet är explicit granskad och dokumenterad här (datum + granskare).

Vid kontraktets första commit är (1) per konstruktion ej uppfylld (B0.3 ritar kartan, B implementerar pinningen). Default är därmed 2×N=3. Opt-in görs som framtida revision av detta dokument när data finns.

**Konsument av samma vakt:** C-fasen kör N≥3-per-gren (forward-constraint mot samma falsk-GREEN-mekanism). Vakten implementeras i C; refereras här så att den inte tappas mellan dokumenten.

## 4. Delade pin-punkter (med andra block)

| Pin | Delat med | Impl-punkt |
|---|---|---|
| Font-settle | `render-canary` (Gate 1) | `src/lib/tests/snapshot/canary-constants.ts` + `render-canary.server.ts` await på `document.fonts.ready`. **B återanvänder samma await-punkt**; växer inte parallell `fonts.ready`-notion. |
| Viewport | Block D (capture-sida) | Chromium launch-options. Värde: **1280×800, devicePixelRatio=1** (att bekräftas mot `harness.server.ts` under B-implementation; uppdatera detta värde om koden visar annat). Dokumenteras här så att golden-extraktion och capture aldrig divergerar på viewport. |

Fullständig nondeterminism-yta och pin-strategi per källa: se `REPLAY-NONDETERMINISM-SURFACE.md`.

## 5. Vad detta kontrakt INTE binder

- Implementation av `extract-golden.ts` (Block B).
- Implementation av pin-strategier (Block B mot B0.3-kartan).
- Ändringar i `normalize.ts`, `harness.server.ts`, `mhtml-normalize.ts`.
- C1/C2-beslut.
- Empirisk avgörande av om hubspots värden straddlar gränser — 2×N=3-mätningen i B är instrumentet.

## 6. Referenser

- `fixtures/determinism/NORMALIZE-COLLAPSE-SET.md` — vilka mekanismer normalize-lagret gör osynliga.
- `fixtures/determinism/REPLAY-NONDETERMINISM-SURFACE.md` — vilka nondeterminism-källor pinning måste täcka.
- `fixtures/determinism/WHITELIST.md` — MHTML-lagrets motsvarande kollaps-uppsättning.
- `fixtures/determinism/MECHANISM-INVENTORY.md` (`scripts/mechanism-inventory.ts`) — mekanism-katalog som kollapsregler refererar till.
- `src/lib/tests/snapshot/normalize.ts` — källa för all golden-lager-kollaps.
- `src/lib/tests/snapshot/__tests__/snapshot.test.ts` — referens-driver.
