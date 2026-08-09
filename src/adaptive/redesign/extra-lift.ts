// Kollisions-retryns EXTRA LYFT som ren funktion — den enda platsen där
// "det som grindades" översätts till "det som serveras".
//
// Bakgrund (granskningsfynd 2026-08-08, serverings-säkerhetsklassen): grind-
// loopen (runGatedAttempts) svarar på en vertikal kollision med ETT extra lyft
// per UNIK lokator och grindar om. Passerar andra försöket är det TVÅ lyft som
// är mätta, skärmdumpade och godkända — serve_ops MÅSTE då bära två lyft.
// Räknas lyftet bort någonstans på vägen servas exakt den layout som försök 1
// mätte som UNDERKÄND, medan bevisbilden ägaren tryckte på visar den andra.
//
// Dedup-nyckeln är den UPPLÖSTA LOKATORTEXTEN, inte targetId: grind-loopen
// dedupar på find-strängen, och två sektioner med samma rubrik ger EN unik
// find (kartläggningsfynd 2026-07-27). targetId-dedup hade servat fler lyft
// än det grindade.

import type { RedesignOp } from "./generate";

/** Unika lokatortexter för move_up-opsen, i planordning — grind-loopens och
 *  serve-vägens GEMENSAMMA dedup-regel (samma funktion räknar båda sidor). */
export function uniqueLiftTargets(
  ops: RedesignOp[],
  locatorTextFor: (targetId: string) => string | null,
): { targetId: string; text: string }[] {
  const seen = new Map<string, { targetId: string; text: string }>();
  for (const o of ops) {
    if (o.op !== "move_up") continue;
    const text = locatorTextFor(o.targetId) ?? o.targetId;
    if (!seen.has(text)) seen.set(text, { targetId: o.targetId, text });
  }
  return [...seen.values()];
}

/** Planens ops + retryns extra lyft när (och bara när) retryn faktiskt bar
 *  grindpasset. Identitet när inget extra lyft kördes. */
export function withExtraLift(
  ops: RedesignOp[],
  args: {
    extraLiftApplied: boolean;
    locatorTextFor: (targetId: string) => string | null;
    /** Grindtalen som motiverade lyftet — ordagrant i op:ens why (spårbarhet
     *  i ägarens bevispåse). */
    overlapAttempt1: number | null;
    overlapAttempt2: number | null;
  },
): RedesignOp[] {
  if (!args.extraLiftApplied) return ops;
  const targets = uniqueLiftTargets(ops, args.locatorTextFor);
  if (targets.length === 0) return ops;
  const proto = new Map(ops.filter((o) => o.op === "move_up").map((o) => [o.targetId, o]));
  return [
    ...ops,
    ...targets.map((t, i) => ({
      ...(proto.get(t.targetId) as RedesignOp),
      detail: `extra move ${i + 1}/${targets.length} — the collision gate's retry found a clean placement one step higher`,
      why: `attempt 1 introduced +${args.overlapAttempt1 ?? "?"}px overlap; attempt 2 +${args.overlapAttempt2 ?? "?"}px`,
    })),
  ];
}
