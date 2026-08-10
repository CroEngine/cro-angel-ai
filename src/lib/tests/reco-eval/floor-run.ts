// CLI för floor-svepet (dynamiska golvet) — se floor.ts för policyer och
// ärliga gränser. Deterministiskt, ingen webbläsare, inga credits.
//
//   bun run reco-eval:floor              (2000 världar, default)
//   bun run reco-eval:floor 4000         (fler världar — 2026-08-09-talen)
//   bun run reco-eval:floor 2000 500     (världar, frö-bas)

import { BEHAVIOR_SHRINK_N0 } from "../../../adaptive/redesign/candidates";
import { MIN_SECTION_VISITS } from "../../../adaptive/redesign/engagement-rollup";

import { FLOOR_POLICIES, runFloorSweep } from "./floor";

const WORLDS = Number(process.argv[2] ?? 2000);
const BASE = Number(process.argv[3] ?? 1);
const LADDER = [10, 30, 50, 100, 300, 1000];
const pct = (x: number) => (100 * x).toFixed(1);

console.log(`\n===== DYNAMISKA GOLVET (floor-svep, ${WORLDS} världar, frö-bas ${BASE}) =====`);
console.log(
  `vald = deployade regeln: golv MIN_SECTION_VISITS=${MIN_SECTION_VISITS} + krympning n/(n+${BEHAVIOR_SHRINK_N0})`,
);
console.log(`(importerad ur produktionskoden — ändras konstanterna följer svepet med)\n`);

for (const family of ["spridda", "täta"] as const) {
  const compress = family === "spridda" ? 1 : 0.2;
  const rows = runFloorSweep({ worlds: WORLDS, ladder: LADDER, compress, seedBase: BASE });
  console.log(`### ${family}${family === "täta" ? " (syntetisk svår-sida — sanningen ihoptryckt mot 0,5)" : ""}`);
  console.log(
    ["n", "prior", "orakel", ...FLOOR_POLICIES, ...FLOOR_POLICIES.map((p) => `${p}:sönder`)].join(
      "\t",
    ),
  );
  for (const r of rows) {
    console.log(
      [
        String(r.n),
        pct(r.priorHit),
        pct(r.oracleHit),
        ...FLOOR_POLICIES.map((p) => pct(r.hit[p])),
        ...FLOOR_POLICIES.map((p) => pct(r.brokeCorrectPrior[p])),
      ].join("\t"),
    );
  }
  console.log("");
}
console.log(`"sönder" = andel världar där policyn bytte bort en prior som redan hade rätt.`);
console.log(`Ärlig gräns: "täta" är en syntetisk gissning, ingen mätning av verkliga sidor —`);
console.log(`kör om beslutet mot riktig spridning när censusen samlat några veckor.`);
