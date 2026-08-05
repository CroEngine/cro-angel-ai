// reco-eval/run.ts — CLI facit-rapport (ägarbeslut: "vi måste mäta mot facit!").
// Ren + deterministisk: ingen webbläsare, inget nät, inga credits. Skriver ut
// baslinjens (typ-priorns) träffgrad, orakel-på-observerat-taket, headroom:et
// mellan dem och D1/D2-icke-fabricerings-räkningen, över N seedade syntetiska
// världar.
//
//   bun run src/lib/tests/reco-eval/run.ts            (2000 världar, default)
//   bun run src/lib/tests/reco-eval/run.ts 5000       (fler världar)
//   bun run src/lib/tests/reco-eval/run.ts 2000 500   (världar, frö-bas)
//
// Speglar structure-eval/run.ts: samma ren-funktion (runFacit) driver både
// CLI:t här och CI-regressionstestet (reco-eval.test.ts).

import { BEHAVIOR_GAIN } from "../../../adaptive/redesign/candidates";

import { gainSweep, runFacit, runRollupFacit, seedSweep } from "./facit";

const N = Number(process.argv[2] ?? 2000);
const BASE = Number(process.argv[3] ?? 1);
const pct = (x: number) => (x * 100).toFixed(1) + "%";

const seeds = seedSweep(N, BASE);
const r = runFacit(seeds);

console.log(`\n===== CRO RECOMMENDATION FACIT (syntetisk dold sanning + brus) =====`);
console.log(`världar: ${r.worlds}  (prim-strid-frön från bas ${BASE})`);
console.log(``);
console.log(`BASLINJE (dagens motor = typ-prior, ignorerar beteende)`);
console.log(`  träffgrad mot dold sanning : ${pct(r.baselineHitRate)}`);
console.log(`  slump-referens mean(1/k)   : ${pct(r.chanceRate)}   <- baslinjen bör ligga här`);
console.log(`  golv-pick == typ-prior     : ${r.baselineEqualsPrior}/${r.worlds}   <- måste vara alla`);
console.log(``);
console.log(`ORAKEL (argmax på observerat — referens-taket; ± tie-brus vid mättade/nära-lika)`);
console.log(`  träffgrad mot dold sanning : ${pct(r.oracleHitRate)}   <- referens-taket`);
console.log(``);
console.log(`BETEENDE-SÄTET (steg 7 RÖR-TEST: perfekt signal in, gain ${BEHAVIOR_GAIN} — bevisar att`);
console.log(`kedjan bär signalen förlustfritt, INTE att riktig rollup-data förutsäger konvertering)`);
console.log(`  träffgrad mot dold sanning : ${pct(r.behaviorHitRate)}   <- ska nå referens-taket`);
console.log(`  headroom stängt            : ${pct(r.headroomClosed)}  (av tak-golv ${pct(r.headroom)}; kan överstiga 100% av tie-brus)`);
console.log(`  katalog-drift              : ${r.catalogDrift}   <- sätet får bara omranka, aldrig ändra menyn`);
console.log(`  term-förankring (mv+ins)   : ${r.anchorViolationCount === 0 ? "PASS" : "FAIL"} (${r.anchorViolationCount} avvikelser; bunden trust-rad bär sin sektions term, "body"-raden neutral)`);
console.log(``);
console.log(
  `D1/D2 icke-fabricering      : ${r.fabricationViolations === 0 ? "PASS" : "FAIL"} (${r.fabricationViolations} brott över ${r.worlds} världar)`,
);
console.log(``);
const ru = runRollupFacit(seeds);
console.log(`ROLLUPEN (steg 8: rubrik-keyade events → rollup → säte, ofullkomlig input)`);
console.log(`  ren input förlustfri        : ${ru.cleanAgrees}/${ru.worlds}   <- rollup-medierad pick == direkta sätets`);
console.log(`  garblad census räddas       : ${ru.garbleAgrees}/${ru.worlds}   <- prefix-passet (rotator-klassen)`);
console.log(`  tunn data ⇒ null            : ${ru.thinNull}/${ru.worlds}`);
console.log(`  hög miss-massa ⇒ null       : ${ru.missNull}/${ru.worlds}  (null-vägen ⇒ baslinjens pick: ${ru.nullFallsBackToBaseline}/${ru.worlds})`);
console.log(``);
console.log(`GAIN-SVEP (facit väljer styrkan — stiger till mättnad; platån ovanför är frö-brus ±1 pp)`);
for (const { gain, hitRate } of gainSweep(seeds, [0, 5, 10, 20, 40, 100])) {
  const mark = gain === BEHAVIOR_GAIN ? "  <- vald (BEHAVIOR_GAIN: nära mättnad med marginal)" : "";
  console.log(`  gain ${String(gain).padStart(3)} : ${pct(hitRate)}${mark}`);
}
console.log(``);

// Samma bommar som testet grindar på — CLI:t exitar !=0 om facit:et brister,
// så det kan köras som en snabb sanity utan att läsa igenom raderna.
const ok =
  r.fabricationViolations === 0 &&
  r.baselineEqualsPrior === r.worlds &&
  r.catalogDrift === 0 &&
  r.anchorViolationCount === 0 &&
  r.headroom > 0.2 &&
  Math.abs(r.baselineHitRate - r.chanceRate) < 0.07 &&
  r.behaviorHitRate >= r.oracleHitRate - 0.05 &&
  r.behaviorHitRate >= r.baselineHitRate + 0.3 &&
  ru.cleanAgrees === ru.worlds &&
  ru.garbleAgrees === ru.worlds &&
  ru.thinNull === ru.worlds &&
  ru.missNull === ru.worlds &&
  ru.nullFallsBackToBaseline === ru.worlds;
console.log(
  `VERDICT: ${ok ? "FACIT HÅLLER — baslinjen på slump, rör-testet vid referens-taket, förankring + noll fabricering" : "UTANFÖR BOMMARNA — se raderna ovan"}`,
);
process.exit(ok ? 0 : 1);
