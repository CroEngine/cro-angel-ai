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
 *    inga evidence.dependencies, så drift-självläkningen tystnar också).
 *
 *  KORSSID-CARVE-OUTEN GÄLLER BARA NÄR CITATET ÄR LAGLIGT (ägarbeslut
 *  2026-08-15, "endast flytta sektioner"): med move-only vokabulär kan
 *  designern inte producera det insert_snippet carve-outen finns för. Att ändå
 *  lämna cellen till designern hade bytt katalogens beteende-rankade flyttar
 *  mot en fri designer som får göra exakt samma flyttar utan menyn — sämre val
 *  på samma vokabulär. Flaggan kommer från vokabulären, inte från en egen
 *  inställning, så de två aldrig kan glida isär.
 *
 *  I DAG ÄR DEN HÄNGSLEN, inte livrem: detect bygger earned.json:s sourcePaths
 *  ur kontextens sourcePages, som move-only redan tömmer, så crossPageSources
 *  är noll även utan flaggan. Den står kvar för att villkoret ska vara SANT
 *  och inte råka-vara-sant — carve-outens mening är "designern äger citatet",
 *  och det påståendet ska falla med citatet, inte överleva som en tom gren. */
export function catalogEligible(args: {
  isTemplate: boolean;
  crossPageSources: number;
  /** Tillåter vokabulären insert_snippet? Utelämnad ⇒ ja (bakåtkompatibel). */
  mayInsert?: boolean;
}): {
  eligible: boolean;
  skip: CatalogSkip | null;
} {
  if (args.isTemplate) return { eligible: false, skip: "template" };
  if (args.crossPageSources > 0 && (args.mayInsert ?? true))
    return { eligible: false, skip: "cross-page" };
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
  /** Blockbiblioteket steg 2: cellens ERBJUDNA återbruksfrön (inte bara det
   *  valda — verify:s alt-stege kan adoptera en återbruksreserv, och även
   *  den ska bära sin proveniens). Verify matchar finalOps mot listan
   *  (reuseSurvived) och skriver evidence.reuse för det block som faktiskt
   *  överlevde — aldrig en etikett på något som föll i fallback-stegen.
   *  planRow äger gate-beslutet: erbjudandena (och deras källsidors union in
   *  i sourcePaths — verify:s whitelist byggs ur den) följer bara med när
   *  KATALOGEN körde (planSource "katalog/…"). En designer-plan föreslog
   *  aldrig återbruk, och en union där hade bara vidgat whitelisten i onödan. */
  reuseOffers?: { variantId: string; provedOnPath: string; sourcePath: string; text: string }[];
  /** Transferformen steg 4: cellens ERBJUDNA flytt-frön. Verify matchar
   *  finalOps mot listan (moveReuseSurvived) och skriver evidence.reuse
   *  (kind "move") för typklassen som faktiskt överlevde. Samma katalog-gate
   *  som reuseOffers — men ingen sourcePaths-union: en flytt citerar ingen
   *  källsida, så whitelisten ska inte vidgas. */
  moveReuseOffers?: { variantId: string; provedOnPath: string; sectionType: string }[];
}

/** Raden verify läser. Formen är kontraktet — fältnamnen här måste matcha
 *  PlanIn i auto-generate.ts exakt. */
export function planRow(input: PlanRowInput): Record<string, unknown> {
  const isTpl = Array.isArray(input.templatePages) && input.templatePages.length >= 2;
  // Återbruks-gaten (se PlanRowInput.reuseOffers): bara katalog-planer bär
  // erbjudanden, och deras källsidor unionas in i sourcePaths så verify:s
  // contextFor bygger whitelisten som validerar dem.
  const reuse =
    input.planSource.startsWith("katalog") && input.reuseOffers && input.reuseOffers.length > 0
      ? input.reuseOffers
      : null;
  // Flytt-erbjudandena (transferformen steg 4) går genom SAMMA katalog-gate,
  // men UTAN sourcePaths-union: en flytt citerar ingen källsida, så verify:s
  // whitelist ska inte vidgas av dem (en onödigt vid whitelist är en tyst
  // uppmjukning av D2-kontrollen).
  const moveReuse =
    input.planSource.startsWith("katalog") &&
    input.moveReuseOffers &&
    input.moveReuseOffers.length > 0
      ? input.moveReuseOffers
      : null;
  return {
    path: input.path,
    key: input.key,
    total: input.total,
    observations: input.observations,
    sourcePaths: reuse
      ? [...new Set([...(input.sourcePaths ?? []), ...reuse.map((r) => r.sourcePath)])]
      : (input.sourcePaths ?? []),
    ...(isTpl ? { templatePages: input.templatePages, repPath: input.repPath } : {}),
    ops: input.ops,
    ...(input.altOps && input.altOps.length > 0 ? { altOps: input.altOps } : {}),
    planSource: input.planSource,
    ...(reuse ? { reuseOffers: reuse } : {}),
    ...(moveReuse ? { moveReuseOffers: moveReuse } : {}),
    cohorts: input.cohorts,
  };
}
