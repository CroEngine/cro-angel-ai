// Deterministisk seedad PRNG (mulberry32). Facit-simulatorn MÅSTE vara
// reproducerbar — samma seed → samma värld → samma tal — annars kan den inte
// vara ett committat, grindande test. Math.random() är förbjuden här (och i
// resten av eval:en) av exakt det skälet.
//
// mulberry32 speglar scripts/sim-rng.ts (winner-calibration/guardrail-sim) —
// medvetet lokal kopia: facit:ens frön ska vara låsta OBEROENDE av vad den
// script-sidiga RNG:n gör, och src/-tester ska inte importera ur scripts/
// (skild tsconfig). gaussian + shuffle finns bara här.

/** mulberry32: liten, snabb, väl fördelad 32-bitars PRNG. Returnerar en
 *  funktion som ger uniforma tal i [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller: en standardnormal (medel 0, sd 1) ur två uniforma. */
export function gaussian(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd(); // undvik log(0)
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Fisher–Yates med den seedade generatorn (in-place på en kopia). */
export function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
