// EN FNV-1a — den deterministiska 32-bitars hash som all besökar-bucketing
// och alla decision-ids bygger på. Löv-modul utan imports (serve.ts ska inte
// dra in hela decide-motorn för en hash). Konstanterna är FNV-1a:s
// offset-basis/prime; ändras de re-bucketas besökare mitt i mätningen —
// därför bor primitiven på ETT ställe.
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
