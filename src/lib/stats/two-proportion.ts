// EN poolad tvåproportions-z — signifikansmatten bakom BÅDE motorns beslut och
// dashboardens visade domslut. Löv-modul utan imports (samma skäl som
// adaptive/hash.ts: en konsument ska inte behöva dra in ett helt lager för en
// primitiv).
//
// VARFÖR EN MODUL (städsvepet 2026-08-14): formeln stod ordagrant på två
// ställen — aggregate.ts:s twoProportionZ (mönsterattribution + vinnar-
// utvärderaren) och adaptive-lab/measure.ts:s twoProportionTest (dashboardens
// ArmVerdict, guardrail- och loop-simmarna). De var byte-lika i dag, men
// ingenting band ihop dem: aggregate.ts:s kommentar sa redan "one definition,
// no drift" — measure.ts hade bara aldrig pekats dit. Driftade de isär skulle
// dashboarden VISA en siffra och motorn BESLUTA på en annan.
//
// ANROPARNAS EGNA GRINDAR ÄR MEDVETET KVAR HOS DEM: aggregate svarar null vid
// tom arm/nolldivision, measure svarar { z: 0, p: 1 }. Det är två olika
// kontrakt mot två olika konsumenter, och en gemensam RETURFORM hade varit en
// beteendeändring. Kärnan här räknar bara — den dömer inte.

/** Poolad tvåproportions-z. null när någon arm är tom eller nämnaren är noll
 *  (identiska proportioner vid 0 % eller 100 % — ingen skillnad att mäta).
 *  Operandordningen är låst: den är den som bägge anroparna alltid haft, så
 *  utfallet är bit-identiskt med före sammanslagningen, inte bara matematiskt
 *  lika. */
export function pooledTwoProportionZ(
  c1: number,
  n1: number,
  c2: number,
  n2: number,
): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pooled = (c1 + c2) / (n1 + n2);
  const denom = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (denom === 0) return null;
  return (p1 - p2) / denom;
}
