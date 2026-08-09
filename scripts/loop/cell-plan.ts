// Nattloopens SÖM som rena funktioner (granskningsfynd 2026-08-08: steg
// 11-konvergensen — den serverade vägens största ändring — hade noll test,
// och gränsen plans.json → verify är osynlig för tsc).
//
// Här bor de tre besluten som annars låg inbakade i loopens IO-kropp:
//   1. cellWorkDir  — kollisionsfri arbetskatalog per (path, key)
//   2. catalogEligible — vem äger cellen: katalogen eller fria designern
//   3. planRow      — RADEN som skrivs till plans.json och läses av verify
//
// planRow är producentsidan av ett kontrakt vars konsument bor i en ANNAN
// process (scripts/redesign/auto-generate.ts, `as PlanIn[]`). Gränsen testas
// på riktigt i scripts/redesign/__tests__/verify-plan-boundary.test.ts, som
// bygger sina planer med just den här funktionen.

import { createHash } from "node:crypto";
import { join } from "node:path";

import type { RedesignOp } from "../../src/adaptive/redesign/generate";

/** Arbetskatalog för en cell. Teckenvitlistan ensam är INTE injektiv —
 *  ("/a-b", "c") och ("/a", "b-c") viker till samma sträng — så en kort hash
 *  av det ORÅA paret binds på; läsbart namn kvar för den som felsöker. */
export function cellWorkDir(runDir: string, path: string, key: string): string {
  const safe =
    `${path}-${key}`
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "home";
  const hash = createHash("sha1").update(`${path}\n${key}`).digest("hex").slice(0, 8);
  return join(runDir, `cell-${safe}-${hash}`);
}

export type CatalogSkip = "template" | "cross-page";

/** Får katalogen äga cellen? Två carve-outs, båda medvetna:
 *
 *  - template: mall-celler grindas mot FLERA frysta exemplar och alt-stegen är
 *    avstängd för dem; katalog-proben går mot EN fil (v1-avgränsning).
 *  - cross-page: celler som förtjänats på pris-flödessignalen kan bara
 *    betjänas av den fria designern — katalogen genererar enbart drag på den
 *    egna sidan och kan aldrig citera en annan sida (och utan citatet finns
 *    inga evidence.dependencies, så drift-självläkningen tystnar också). */
export function catalogEligible(args: {
  isTemplate: boolean;
  crossPageSources: number;
}): { eligible: boolean; skip: CatalogSkip | null } {
  if (args.isTemplate) return { eligible: false, skip: "template" };
  if (args.crossPageSources > 0) return { eligible: false, skip: "cross-page" };
  return { eligible: true, skip: null };
}

export interface PlanRowInput {
  path: string;
  key: string;
  total: { visits: number; conversions: number };
  observations: string[];
  sourcePaths?: string[];
  cohorts?: string[];
  /** Mall-celler: exemplaren + representanten följer med till verify, som
   *  grindar opsen på VARJE fryst exemplar. path förblir mönstret. */
  templatePages?: string[];
  repPath?: string;
  ops: RedesignOp[];
  /** Katalogens rankade reserver — verify provar dem i ordning. Utelämnas ur
   *  raden när listan är tom (verify läser `plan.altOps ?? []`). */
  altOps?: RedesignOp[][];
  /** "katalog/selector" | "katalog/floor" | "designer" — ALLTID med, så en
   *  variant aldrig föds utan känd härkomst. */
  planSource: string;
}

/** Raden verify läser. Formen är kontraktet — fältnamnen här måste matcha
 *  PlanIn i auto-generate.ts exakt. */
export function planRow(input: PlanRowInput): Record<string, unknown> {
  const isTpl = Array.isArray(input.templatePages) && input.templatePages.length >= 2;
  return {
    path: input.path,
    key: input.key,
    total: input.total,
    observations: input.observations,
    sourcePaths: input.sourcePaths ?? [],
    ...(isTpl ? { templatePages: input.templatePages, repPath: input.repPath } : {}),
    ops: input.ops,
    ...(input.altOps && input.altOps.length > 0 ? { altOps: input.altOps } : {}),
    planSource: input.planSource,
    cohorts: input.cohorts,
  };
}
