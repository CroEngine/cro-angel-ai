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

import { templateOf } from "../../src/lib/page-template";
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

/** FRYS-PRIORITERINGEN (granskningsfynd 2026-08-16, needs_freeze-svälten).
 *
 *  Löv-toppen kapades förut till 10 i DATABASENS ordning — i praktiken
 *  alfabetisk, så "/restauranger/…" föll för "/blogg/…" varje natt trots att
 *  restaurang-MALLCELLEN bar sajtens näst största trafik (210 besök). Cellen
 *  stod i needs_freeze i veckor: detect kräver frysta sidor, frysningen
 *  prioriterade aldrig dem, och ingen körning kunde bryta cirkeln.
 *
 *  Två regler, båda ur detektorns faktiska behov:
 *   1. TRAFIK, inte bokstavsordning: sidor rankas på aggregerade besök.
 *   2. MALL-TOPP-UPP: malldetektorn kräver ≥ 2 frysta exemplar per mall —
 *      för topp-mallarna (på mallens SAMLADE trafik) garanteras de två
 *      största exemplaren plats, även när ingen av dem ensam når sidtoppen.
 *      Det är exakt long-tail-fallet mallar finns för: många små sidor som
 *      tillsammans bär volymen.
 *
 *  Ren och deterministisk (tiebreak på path) — nattloopen matar löven,
 *  testerna matar fixturer. */
export function freezePriority(
  leaves: { path?: string | null; visits?: number | null }[],
  opts: { topPages?: number; topTemplates?: number; perTemplate?: number } = {},
): string[] {
  const topPages = opts.topPages ?? 10;
  const topTemplates = opts.topTemplates ?? 3;
  const perTemplate = opts.perTemplate ?? 2;
  const visits = new Map<string, number>();
  for (const l of leaves) {
    const raw = typeof l.path === "string" && l.path ? l.path : "/";
    const p = raw.split("#")[0].split("?")[0] || "/";
    visits.set(p, (visits.get(p) ?? 0) + (typeof l.visits === "number" ? l.visits : 0));
  }
  const byTraffic = [...visits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const picked = byTraffic.slice(0, topPages).map(([p]) => p);
  // Mall-topp-upp: gruppera på mönster, ranka mallarna på samlad trafik och
  // säkra de två största exemplaren per topp-mall.
  const byTemplate = new Map<string, { total: number; pages: [string, number][] }>();
  for (const [p, v] of byTraffic) {
    const tpl = templateOf(p);
    if (!tpl) continue;
    const acc = byTemplate.get(tpl) ?? { total: 0, pages: [] };
    acc.total += v;
    acc.pages.push([p, v]);
    byTemplate.set(tpl, acc);
  }
  const templates = [...byTemplate.entries()]
    .filter(([, g]) => g.pages.length >= 2) // en ensam sida är ingen mall
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .slice(0, topTemplates);
  const out = [...picked];
  for (const [, g] of templates) {
    for (const [p] of g.pages.slice(0, perTemplate)) {
      if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

export type CatalogSkip = "cross-page";

/** Får katalogen äga cellen? EN carve-out kvar:
 *
 *  - cross-page: celler som förtjänats på pris-flödessignalen kan bara
 *    betjänas av den fria designern — katalogen genererar enbart drag på den
 *    egna sidan och kan aldrig citera en annan sida (och utan citatet finns
 *    inga evidence.dependencies, så drift-självläkningen tystnar också).
 *
 *  MALL-CARVE-OUTEN LYFT (2026-08-16). v1-skälet var att katalog-proben går
 *  mot EN fryst fil medan mall-celler grindas mot flera exemplar — men
 *  designervägen bygger och mäter mot exakt SAMMA enda representant, så
 *  proben är inte svagare än det som redan gällde. Kostnaden av carve-outen
 *  blev synlig när diagnostikraden landade (körningen 2026-08-16): ALLA tre
 *  återkommande döda celler på pilotsajten var designer-ägda — designern
 *  hittade på ett sektions-id på en, valde artikelrubriken (ingen ren
 *  sektionsnivå) på en annan — medan sajtens enda SERVANDE variant är ett
 *  katalogformat drag (FAQ-flytt) på samma sidmall. Menyn kan per
 *  konstruktion inte hitta på id:n, och proben sållar oupplösbara mål INNAN
 *  en design köps. Kvarvarande v1-rest: verify:s alt-stege vid GRINDFALL är
 *  fortsatt avstängd för mallar (validerings-reserverna gäller).
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
  crossPageSources: number;
  /** Tillåter vokabulären insert_snippet? Utelämnad ⇒ ja (bakåtkompatibel). */
  mayInsert?: boolean;
}): {
  eligible: boolean;
  skip: CatalogSkip | null;
} {
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
