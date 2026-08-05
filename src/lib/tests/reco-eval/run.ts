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

import { runFacit, seedSweep } from "./facit";

const N = Number(process.argv[2] ?? 2000);
const BASE = Number(process.argv[3] ?? 1);
const pct = (x: number) => (x * 100).toFixed(1) + "%";

const r = runFacit(seedSweep(N, BASE));

console.log(`\n===== CRO RECOMMENDATION FACIT (syntetisk dold sanning + brus) =====`);
console.log(`världar: ${r.worlds}  (prim-strid-frön från bas ${BASE})`);
console.log(``);
console.log(`BASLINJE (dagens motor = typ-prior, ignorerar beteende)`);
console.log(`  träffgrad mot dold sanning : ${pct(r.baselineHitRate)}`);
console.log(`  slump-referens mean(1/k)   : ${pct(r.chanceRate)}   <- baslinjen bör ligga här`);
console.log(`  golv-pick == typ-prior     : ${r.baselineEqualsPrior}/${r.worlds}   <- måste vara alla`);
console.log(``);
console.log(`ORAKEL (bästa en beteende-motor KUNDE nå ur samma brusiga signal)`);
console.log(`  träffgrad mot dold sanning : ${pct(r.oracleHitRate)}   <- taket`);
console.log(``);
console.log(`HEADROOM (tak - golv)        : ${pct(r.headroom)}   <- mätt, icke-cirkulärt utrymme för steg 7`);
console.log(``);
console.log(
  `D1/D2 icke-fabricering      : ${r.fabricationViolations === 0 ? "PASS" : "FAIL"} (${r.fabricationViolations} brott över ${r.worlds} världar)`,
);
console.log(``);

// Samma bommar som testet grindar på — CLI:t exitar !=0 om facit:et brister,
// så det kan köras som en snabb sanity utan att läsa igenom raderna.
const ok =
  r.fabricationViolations === 0 &&
  r.baselineEqualsPrior === r.worlds &&
  r.headroom > 0.2 &&
  Math.abs(r.baselineHitRate - r.chanceRate) < 0.07;
console.log(
  `VERDICT: ${ok ? "FACIT HÅLLER — baslinjen på slump, riktigt headroom ovanför, noll fabricering" : "UTANFÖR BOMMARNA — se raderna ovan"}`,
);
process.exit(ok ? 0 : 1);
