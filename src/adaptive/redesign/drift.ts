// Korssid-lyftet slice 3 — drift-svepets RENA planerare (ägarbeslut 2026-07-18).
//
// Ett insatt citat deklarerar sin källa i evidence.dependencies
// ({path, textSnapshot}). Varje natt fryses källsidorna om, och den här
// modulen avgör per variant vad som ska hända — utan att röra ägarens
// status (policyn 2026-07-12): allt maskinellt går via den separata
// hold-flaggan (held_reason).
//
//   * Källtexten finns kvar ordagrant  → keep (eller release om vi själva
//     höll varianten — källan har läkt).
//   * Källtexten borta, ny prisutsaga finns → refresh: kandidaten ska genom
//     EXAKT samma grindkedja som första gången innan den serveras (det gör
//     nattloopen — planeraren pekar bara ut den).
//   * Källtexten borta, inget att ersätta med → hold: hellre ingen insättning
//     än ett inaktuellt pris.
//   * Ingen färsk fryst kopia (nätfel, WAF) → keep: frånvaro av bevis är
//     inte drift — vi agerar bara på en LYCKAD omfrysning som saknar texten.
//
// Pure + deterministisk (ingen slump, ingen klocka) så den är enhetstestbar.

export interface VariantDependency {
  path: string;
  textSnapshot: string;
}

export interface SweepVariant {
  id: string;
  heldReason: string | null;
  dependencies: VariantDependency[];
}

/** Prefix på maskinella hold-skäl som DETTA svep äger — bara sådana släpps
 *  automatiskt. Ett framtida annat maskinellt stopp rörs aldrig härifrån. */
export const DRIFT_HOLD_PREFIX = "källdrift: ";

export type SweepAction =
  | { id: string; action: "keep" }
  | { id: string; action: "release" }
  | { id: string; action: "refresh"; path: string; oldText: string; newText: string }
  | { id: string; action: "hold"; reason: string };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Deterministiskt val av ersättningsutsaga: störst ordöverlapp med den gamla
 *  texten (priser byter oftast bara siffran — resten av frasen känns igen);
 *  vid lika vinner den FÖRSTA i sidordning (extraktorn levererar dokumentordning). */
export function pickReplacementSnippet(oldText: string, candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const tokens = (s: string) => new Set(norm(s).toLowerCase().split(" ").filter(Boolean));
  const old = tokens(oldText);
  let best: string | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const ct = tokens(c);
    let overlap = 0;
    for (const t of ct) if (old.has(t)) overlap++;
    const score = overlap / Math.max(1, Math.max(old.size, ct.size));
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/**
 * Planera nattens drift-åtgärder. `freshSnippets` mappar källsidans path till
 * nattens NYFRYSTA prisutsagor — `null`/saknad nyckel betyder "ingen lyckad
 * omfrysning i natt" (⇒ keep, aldrig hold på frånvaro av bevis).
 * Varianter utan dependencies berörs aldrig (ingen action alls).
 */
export function planDependencySweep(
  variants: SweepVariant[],
  freshSnippets: Record<string, string[] | null>,
): SweepAction[] {
  const actions: SweepAction[] = [];
  for (const v of variants) {
    if (v.dependencies.length === 0) continue;
    let verdict: SweepAction = { id: v.id, action: "keep" };
    for (const dep of v.dependencies) {
      const fresh = freshSnippets[dep.path];
      if (fresh == null) continue; // ingen färsk kopia — inget bevis, ingen åtgärd
      const intact = fresh.some((t) => norm(t) === norm(dep.textSnapshot));
      if (intact) continue;
      const replacement = pickReplacementSnippet(dep.textSnapshot, fresh);
      if (replacement) {
        verdict = {
          id: v.id,
          action: "refresh",
          path: dep.path,
          oldText: dep.textSnapshot,
          newText: replacement,
        };
      } else {
        verdict = {
          id: v.id,
          action: "hold",
          reason: `${DRIFT_HOLD_PREFIX}"${norm(dep.textSnapshot).slice(0, 80)}" finns inte längre på ${dep.path}`,
        };
        break; // hold slår refresh — hellre paus än fel pris
      }
    }
    // Alla beroenden intakta (eller obevisade) — släpp vårt EGET drift-hold,
    // andra maskinella stopp lämnas orörda.
    if (
      verdict.action === "keep" &&
      v.heldReason !== null &&
      v.heldReason.startsWith(DRIFT_HOLD_PREFIX)
    ) {
      verdict = { id: v.id, action: "release" };
    }
    actions.push(verdict);
  }
  return actions;
}

/** evidence.dependencies → SweepVariant-form, tolerant mot äldre evidens utan
 *  fältet. Exporterad så nattloopen och tester delar exakt samma läsning. */
export function dependenciesOf(evidence: unknown): VariantDependency[] {
  const deps = (evidence as { dependencies?: unknown } | null)?.dependencies;
  if (!Array.isArray(deps)) return [];
  return deps.filter(
    (d): d is VariantDependency =>
      !!d &&
      typeof (d as VariantDependency).path === "string" &&
      typeof (d as VariantDependency).textSnapshot === "string",
  );
}
