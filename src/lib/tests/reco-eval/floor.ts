// Floor-svepet — verktyget som VALDE dynamiska golvet (ägarbeslut 2026-08-10:
// "Kan vi göra den dynamisk? Efter ex 100 tests och om vi kan skapa en tydlig
// syfte?"). Mäter fem golv-policyer mot samma dolda sanning som reco-eval:en,
// på en stege av stickprovsstorlekar n (laddningar per sektion):
//
//   idag1000       den GAMLA regeln: hård grind vid 1000 laddningar, sedan
//                  fullt gain — under grinden står motorn kvar på priorn.
//   tröskel100     ägarens föreslagna "efter ex 100": hård grind vid 100.
//   vald           den DEPLOYADE regeln (2026-08-09): rollupens golv vid
//                  MIN_SECTION_VISITS + sätets krympning n/(n+N0) via
//                  sectionVisits — importerad ur produktionskoden, så svepet
//                  följer konstanterna om de ändras.
//   volymUtanGolv  krympningen UTAN golv — visar varför golvet behövs: vid
//                  n=10 på täta sidor sönderdelar den korrekta priors.
//   tilltro        gain = GAIN·min(1, z/1,28) där z är tvåproportionstestet
//                  mellan bäst och näst bäst observerad sektion ("kan vi
//                  skilja etta från tvåa?"). Giltighetsregeln (≥5 utfall åt
//                  bägge håll) svälter tilltron vid små n — det är därför
//                  den förlorade svepet, inte z-tröskelvalet (1,00–1,96
//                  skiljer ~2 pp).
//
// TVÅ VÄRLDSFAMILJER (compress-parametern), för att pröva exakt den svaghet
// volymkrympningen har:
//   spridda (1,0)  sanningen likformig på [0,1] — sektioner typiskt olika.
//   täta   (0,2)   samma världar, sanningen komprimerad mot 0,5 (monoton
//                  avbildning ⇒ SAMMA facit, bara svårare att se). Låga n är
//                  rent brus här — en volymregel vet inte det.
// ÄRLIG GRÄNS: "täta" är en syntetisk gissning på hur en svår sida ser ut,
// ingen mätning av verkliga sidor; familjerna modellerar brus, inte skevhet.
// Kör om beslutet mot riktig spridning när censusen samlat några veckor.
//
// Mätt 2026-08-10 (4000 världar, prim-strid-frön): spridda n=30 ger vald
// 84,9 % mot priorns 29,4 (orakel 85,8) och tilltrons 54,7; täta n=10 ger
// volymUtanGolv 9,6 % sönderdelade korrekta priors — vald 0 (golvet tystar).
// (Scratchpad-svepen 2026-08-09 med löpande frön: 83,8/27,8/86,3/53,3/9,1 —
// samma bild inom ±1,6 pp.) Ett felval är inte en trasig sida: varianten ska
// fortfarande genom proben, verify, ägarens knapp, rampen och skyddssvepet —
// kostnaden är en bortslösad testplats.
//
// Rent + deterministiskt (samma frön ⇒ samma rader): ingen webbläsare, inget
// nät. CLI: `bun run reco-eval:floor` — CI-regressionstestet i
// reco-eval.test.ts grindar samma funktion med färre världar.

import {
  BEHAVIOR_GAIN,
  generateCandidates,
  type BehaviorInput,
} from "../../../adaptive/redesign/candidates";
import { MIN_SECTION_VISITS, MIN_VISITS } from "../../../adaptive/redesign/engagement-rollup";

import { floorMovePick, seedSweep } from "./facit";
import { mulberry32 } from "./prng";
import { makeWorld } from "./simulator";

export const FLOOR_POLICIES = [
  "idag1000",
  "tröskel100",
  "vald",
  "volymUtanGolv",
  "tilltro",
] as const;
export type FloorPolicy = (typeof FLOOR_POLICIES)[number];

/** En stegpunkt: träffgrad mot dold sanning per policy, plus andelen världar
 *  där policyn SÖNDERDELADE en prior som redan hade rätt (risksidan). */
export interface FloorRow {
  n: number;
  priorHit: number;
  oracleHit: number;
  hit: Record<FloorPolicy, number>;
  brokeCorrectPrior: Record<FloorPolicy, number>;
}

export interface FloorSweepOptions {
  worlds: number;
  ladder: number[];
  /** Sanningens komprimering mot 0,5: 1 = spridda (default), 0,2 = täta. */
  compress?: number;
  seedBase?: number;
}

/** Motorns golv-pick genom den RIKTIGA katalog→golv-kedjan — DELAD med
 *  facit:et (floorMovePick), aldrig en egen kopia som kan divergera. */
function enginePick(
  content: Parameters<typeof generateCandidates>[0],
  behavior?: BehaviorInput,
): string | null {
  return floorMovePick(generateCandidates(content, behavior));
}

function binom(n: number, p: number, rnd: () => number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rnd() < p) k++;
  return k;
}

/** Tvåproportions-z mellan bäst och näst bäst observerad sektion.
 *  Giltighetsregeln (≥5 lyckade och ≥5 misslyckade i bägge) binder vid små
 *  n — utan den ljuger z som mest. Ogiltig ⇒ 0 tilltro. */
export function topZ(counts: { k: number }[], n: number): number {
  if (counts.length < 2) return 0;
  const s = [...counts].sort((a, b) => b.k - a.k);
  const [a, b] = s;
  if (Math.min(a.k, n - a.k, b.k, n - b.k) < 5) return 0;
  const p = (a.k + b.k) / (2 * n);
  const se = Math.sqrt(p * (1 - p) * (2 / n));
  if (!(se > 0)) return 0;
  return Math.abs(a.k / n - b.k / n) / se;
}

/** Komprimera sanningen mot 0,5 — monotont, så facit är oförändrat. */
export const compressTruth = (p: number, c: number): number => 0.5 + (p - 0.5) * c;

export function runFloorSweep(opts: FloorSweepOptions): FloorRow[] {
  const c = opts.compress ?? 1;
  // Världsfrön genom seedSweep (prim-striden): löpande heltalsfrön kan
  // korrelera hash-PRNG:ns första utdata mellan grannvärldar — samma skäl
  // som run.ts/winner-calibration (granskningsfynd 2026-08-10; scratchpad-
  // svepen 2026-08-09 körde löpande frön, talen flyttade < 1 pp).
  const seeds = seedSweep(opts.worlds, opts.seedBase ?? 1);
  // Världarna byggs EN gång och delas av alla stegpunkter — paren ("samma
  // världar för varje n") är strukturella, inte bara deterministiska.
  const worlds = seeds.map((s) => makeWorld(s));
  // Produktionens tystnadsvillkor: sidgolvet (MIN_VISITS, laddnings-proxyn)
  // OCH sektionsgolvet — i svepets uniforma n sammanfaller proxy och
  // sektions-n, så "vald" är tyst under det största av golven. Bägge
  // importerade: ändras konstanterna följer svepet med.
  const VALD_FLOOR = Math.max(MIN_SECTION_VISITS, MIN_VISITS);
  const rows: FloorRow[] = [];

  for (const n of opts.ladder) {
    let priorHit = 0;
    let oracleHit = 0;
    const hit = {} as Record<FloorPolicy, number>;
    const broke = {} as Record<FloorPolicy, number>;
    for (const p of FLOOR_POLICIES) {
      hit[p] = 0;
      broke[p] = 0;
    }

    for (const w of worlds) {
      // Brus-strömmen dekorreleras per (värld, n) med prim-striden — samma
      // idiom som seedSweep/winner-calibration.
      const rnd = mulberry32(w.seed * 7919 + n);
      const ids = Object.keys(w.hiddenValue).sort();
      const counts = ids.map((id) => ({
        id,
        k: binom(n, compressTruth(w.hiddenValue[id], c), rnd),
      }));
      const observed: Record<string, number> = {};
      const visits: Record<string, number> = {};
      for (const cc of counts) {
        observed[cc.id] = cc.k / n;
        visits[cc.id] = n;
      }

      const priorRight = w.priorSectionId === w.goldSectionId;
      if (priorRight) priorHit++;
      const obsTop = [...counts].sort((a, b) => b.k - a.k || a.id.localeCompare(b.id))[0];
      if (obsTop.id === w.goldSectionId) oracleHit++;

      const z = topZ(counts, n);
      // Policy → sätets input (undefined = tyst ⇒ priorns pick, utan att
      // motorn ens anropas — grindarna ÄR frånvaron av säte).
      const inputs: Record<FloorPolicy, BehaviorInput | undefined> = {
        idag1000: n >= 1000 ? { sectionWeight: observed } : undefined,
        "tröskel100": n >= 100 ? { sectionWeight: observed } : undefined,
        vald:
          n >= VALD_FLOOR ? { sectionWeight: observed, sectionVisits: visits } : undefined,
        volymUtanGolv: { sectionWeight: observed, sectionVisits: visits },
        tilltro:
          z > 0
            ? { sectionWeight: observed, gain: BEHAVIOR_GAIN * Math.min(1, z / 1.28) }
            : undefined,
      };

      for (const p of FLOOR_POLICIES) {
        const input = inputs[p];
        const pick = input ? enginePick(w.content, input) : w.priorSectionId;
        const right = pick === w.goldSectionId;
        if (right) hit[p]++;
        if (priorRight && !right) broke[p]++;
      }
    }

    const rate = (x: number) => x / opts.worlds;
    rows.push({
      n,
      priorHit: rate(priorHit),
      oracleHit: rate(oracleHit),
      hit: Object.fromEntries(FLOOR_POLICIES.map((p) => [p, rate(hit[p])])) as Record<
        FloorPolicy,
        number
      >,
      brokeCorrectPrior: Object.fromEntries(
        FLOOR_POLICIES.map((p) => [p, rate(broke[p])]),
      ) as Record<FloorPolicy, number>,
    });
  }
  return rows;
}
