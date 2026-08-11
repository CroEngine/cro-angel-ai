// Blockbiblioteket steg 2 (ägarbeslut 2026-08-11 "Kör!"): vinnarnas bevisade
// block erbjuds som ORDAGRANNA återanvändningskandidater på systersidor —
// genom exakt samma bevis-kedja som allt annat (katalog → DOM-probe →
// väljare → verify → ägarens knapp → ramp → guardrail-svep).
//
// VAD SOM ÄR ETT BEVISAT BLOCK: en vinnarvariants insert_snippet-text. Bara
// den. Ett A/B-vunnet citat är den enda blockform vars ordagranna text,
// källsida och driftkontrakt (evidence.dependencies) redan finns i systemet —
// och vars "bevis" är ett riktigt testutfall, inte attribution (positions-
// bias). move_up-vinnare och census-heta sektioner är MEDVETET utanför v1:
// deras överföringsform är en annan hypotesklass.
//
// ÖVERFÖRINGEN ÄR OBEVISAD TILLS DEN TESTAS: fröet är en hypotesgenerator med
// proveniens, aldrig ett facit. Menyraden säger det rakt ut, poängen läggs
// under varje beteende-ledd kandidat, och varje återanvändning föds som
// vanlig verified-variant som ägaren själv startar.
//
// MÄTTNADSTAKET (ägarens UX-varning 2026-08-10: "biblioteket bör straffa
// övermättnad"): samma block får spridas till högst REUSE_MAX_SPREAD andra
// sidor åt gången — ett block som redan testas/servar där är inte ett
// erbjudande till fler förrän någon plats frigörs (retired) eller beviset
// växer (framtida steg 3, transfer-lärandet).
//
// D2-INVARIANTEN ÄR ORÖRD: modulen ändrar INTE validateOps. Fröets källsida
// läggs i cellens sourcePaths, så exakt-likhets-kontrollen mot källsidans
// frysta whitelist och det nattliga driftsvepet följer med gratis — ett frö
// vars text inte längre finns i källsidans quotables är inte längre giltigt
// och sållas i nattloopens viabilitetskoll (samma dom som driftsvepet).

import { stripTags } from "./extract";
import { normQuote } from "./generate";

/** Den delmängd av en angel_variants-rad skörden behöver — nattloopens
 *  select täcker den (id,path,status,held_reason,ops,evidence). */
export interface ReuseVariantRow {
  id: string;
  path: string;
  status: string;
  held_reason?: string | null;
  ops?: unknown;
  /** Läses tolerant (samma stil som dependenciesOf): evidence.refreshedAt
   *  markerar en drift-uppdaterad vinnare — se harvestReuseSeeds. */
  evidence?: unknown;
}

/** Ett skördat frö: vinnarens ordagranna text + var citatet valideras
 *  (sourcePath) + var det VANN (provedOnPath — proveniensen ägaren ser). */
export interface ReuseSeed {
  variantId: string;
  provedOnPath: string;
  sourcePath: string;
  text: string;
}

/** Mättnadstaket: högst så här många ANDRA sidor får bära samma block
 *  samtidigt (icke-pensionerade varianter, distinkta paths). */
export const REUSE_MAX_SPREAD = 2;

/** Max frön som erbjuds EN cell — menyn ska bära beslut, inte brus. */
export const MAX_REUSE_OFFERS_PER_CELL = 2;

interface InsertOpLike {
  op?: unknown;
  detail?: unknown;
  sourcePath?: unknown;
}

const insertOps = (row: ReuseVariantRow): { detail: string; sourcePath: string | null }[] => {
  if (!Array.isArray(row.ops)) return [];
  const out: { detail: string; sourcePath: string | null }[] = [];
  for (const raw of row.ops as InsertOpLike[]) {
    if (!raw || raw.op !== "insert_snippet") continue;
    if (typeof raw.detail !== "string" || normQuote(raw.detail).length === 0) continue;
    out.push({
      detail: raw.detail,
      sourcePath:
        typeof raw.sourcePath === "string" && raw.sourcePath.length > 0 ? raw.sourcePath : null,
    });
  }
  return out;
};

/** Skörda återanvändningsfrön ur sajtens variantrader. Bara vinnare, aldrig
 *  hållna (en guardrail-hold är ett aktivt varningstecken — ett hållet
 *  "bevis" är inget bevis), aldrig drift-uppdaterade (granskningsfynd
 *  2026-08-11: refresh-svepet byter vinnartexten mot källsidans NYA lydelse
 *  utan nytt A/B — vinsten tillhör den GAMLA texten, och den nya får aldrig
 *  ärva [proven:]-etiketten), bara insert-ops med EXPLICIT sourcePath
 *  (granskningsfynd 2026-08-11: ett bevis-lyft från egna sidan validerades
 *  mot sidans KORPUS, inte quotables-whitelisten — ett sådant frö hade
 *  näst intill alltid sållats i viabilitetskollen med en vilseledande
 *  "drift"-logg; den klassen är en framtida fröform, inte en trasig v1),
 *  ett frö per vinnare (första insert-open), dedup på normaliserad text
 *  (två vinnare med samma citat är ETT block). */
export function harvestReuseSeeds(rows: ReuseVariantRow[]): ReuseSeed[] {
  const seeds: ReuseSeed[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status !== "winner") continue;
    if (row.held_reason) continue;
    if ((row.evidence as { refreshedAt?: unknown } | null | undefined)?.refreshedAt) continue;
    const ins = insertOps(row)[0];
    if (!ins?.sourcePath) continue;
    const key = normQuote(ins.detail).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({
      variantId: row.id,
      provedOnPath: row.path,
      sourcePath: ins.sourcePath,
      text: ins.detail,
    });
  }
  return seeds;
}

/** Viabilitetskollen som ren funktion (granskningsfynd 2026-08-11: låg förut
 *  obetestbar i nattloopens IO-kropp): ett frö är erbjudbart bara om texten
 *  fortfarande finns i källsidans NYFRYSTA quotables-whitelist — exakt samma
 *  likhet som validateOps sedan kräver. `quotablesFor` svarar null när
 *  källsidan inte kunde frysas. */
export function filterViableSeeds(
  seeds: ReuseSeed[],
  quotablesFor: (sourcePath: string) => string[] | null,
): { viable: ReuseSeed[]; dropped: { seed: ReuseSeed; reason: "unfrozen" | "text-gone" }[] } {
  const viable: ReuseSeed[] = [];
  const dropped: { seed: ReuseSeed; reason: "unfrozen" | "text-gone" }[] = [];
  for (const seed of seeds) {
    const snippets = quotablesFor(seed.sourcePath);
    if (snippets === null) {
      dropped.push({ seed, reason: "unfrozen" });
      continue;
    }
    if (!snippets.some((s) => normQuote(s) === normQuote(seed.text))) {
      dropped.push({ seed, reason: "text-gone" });
      continue;
    }
    viable.push(seed);
  }
  return { viable, dropped };
}

/** Är blocket redan mättat? Räknar DISTINKTA icke-pensionerade sidor (utöver
 *  vinnarens egen) som bär samma normaliserade text i en insert-op. */
export function seedSaturated(seed: ReuseSeed, rows: ReuseVariantRow[]): boolean {
  const key = normQuote(seed.text).toLowerCase();
  const paths = new Set<string>();
  for (const row of rows) {
    if (row.status === "retired") continue;
    if (row.path === seed.provedOnPath) continue;
    if (insertOps(row).some((o) => normQuote(o.detail).toLowerCase() === key)) {
      paths.add(row.path);
    }
  }
  return paths.size >= REUSE_MAX_SPREAD;
}

/** Platta ut fryst HTML till normaliserad gemen text — dubbelvisningsvaktens
 *  underlag. script/style/noscript strippas före taggarna så deras innehåll
 *  aldrig räknas som sidtext. */
export function flattenHtml(html: string): string {
  // script/style/noscript FÖRE stripTags — den tar taggar, inte innehåll.
  // stripTags avkodar dessutom HTML-entiteter med SAMMA regler som
  // whitelist-extraktionen (granskningsfynd 2026-08-11: "Fr&aring;n 299 kr"
  // smet annars förbi vakten — fröets text är avkodad, sidan jämfördes rå).
  return stripTags(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")).toLowerCase();
}

/** Bokstäver/siffror ensamma — inline-taggar lämnar mellanslag runt
 *  skiljetecken ("<b>månad</b>," → "månad ,") som en ren substräng-jämförelse
 *  snubblar på, och då hade vakten släppt igenom en text sidan redan visar.
 *  Riktningen är konservativ: en falsk träff kostar ett hoppat erbjudande,
 *  en miss kostar dubbelvisning för besökaren. */
const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Finns texten redan på sidan? Teckenklass-tålig, skiftlägesokänslig
 *  substräng — samma anda som flödessignalens dubbelvisningsvakt
 *  (2026-07-18): visa aldrig besökaren samma utsaga två gånger. */
export function textPresent(flatHtml: string, text: string): boolean {
  const needle = squash(text);
  return needle.length > 0 && squash(flatHtml).includes(needle);
}

/** Fröna EN cell faktiskt erbjuds. Vakterna, i ordning:
 *  1. aldrig sidan blocket vann på (varianten står redan där),
 *  2. aldrig källsidan själv (citera inte sidan till sig själv),
 *  3. aldrig en sida som redan VISAR texten (dubbelvisningsvakten),
 *  4. aldrig en sida som redan HAR en icke-pensionerad variant med texten
 *     (samma erbjudande två gånger är brus, inte evidens),
 *  5. aldrig över mättnadstaket (REUSE_MAX_SPREAD distinkta sidor),
 *  6. högst MAX_REUSE_OFFERS_PER_CELL frön per cell. */
export function offerSeedsForCell(args: {
  seeds: ReuseSeed[];
  cellPath: string;
  landingFlatHtml: string;
  rows: ReuseVariantRow[];
}): ReuseSeed[] {
  const out: ReuseSeed[] = [];
  for (const seed of args.seeds) {
    if (out.length >= MAX_REUSE_OFFERS_PER_CELL) break;
    if (seed.provedOnPath === args.cellPath) continue;
    if (seed.sourcePath === args.cellPath) continue;
    if (textPresent(args.landingFlatHtml, seed.text)) continue;
    const key = normQuote(seed.text).toLowerCase();
    const alreadyHere = args.rows.some(
      (row) =>
        row.status !== "retired" &&
        row.path === args.cellPath &&
        insertOps(row).some((o) => normQuote(o.detail).toLowerCase() === key),
    );
    if (alreadyHere) continue;
    if (seedSaturated(seed, args.rows)) continue;
    out.push(seed);
  }
  return out;
}

/** Överlevde återanvändningen hela verify-stegen? Fallback-stegen (alt-
 *  reserver, bevis-lyftet) kan byta ut opsen — proveniensen får BARA skrivas
 *  i evidence när den slutliga varianten faktiskt bär det bevisade blocket
 *  (annars hade en proof-insert-fallback fått en falsk "vann på X"-etikett). */
export function reuseSurvived(
  finalOps: { op: string; detail?: string; sourcePath?: string }[],
  reuse: { sourcePath: string; text: string },
): boolean {
  return finalOps.some(
    (o) =>
      o.op === "insert_snippet" &&
      o.sourcePath === reuse.sourcePath &&
      normQuote(o.detail ?? "") === normQuote(reuse.text),
  );
}
