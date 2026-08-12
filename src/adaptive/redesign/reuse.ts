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
  /** Transfer-lärandet (steg 3): ANDRA sidor där samma block också vunnit
   *  sitt A/B — meritlistan menyn visar. Fylls av decorateSeedsWithTransfer,
   *  sorterad för determinism. */
  alsoWonOn?: string[];
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

/** DEN delade textnyckeln (granskningsfynd 2026-08-11: fyra inline-kopior av
 *  normQuote+lowercase kunde drifta var för sig — då hade skördens dedup,
 *  vakterna och meritlistan tyst keyat på olika strängar). */
const recordKey = (text: string): string => normQuote(text).toLowerCase();

/** EN definition av "bevisad vinnarrad" — delad av skörden och transfer-
 *  meriträkningen så en vinst aldrig räknas i den ena men inte den andra:
 *  vinnare, ohållen, aldrig drift-uppdaterad. */
export function isProvenWinnerRow(row: ReuseVariantRow): boolean {
  if (row.status !== "winner") return false;
  if (row.held_reason) return false;
  if ((row.evidence as { refreshedAt?: unknown } | null | undefined)?.refreshedAt) return false;
  return true;
}

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
    if (!isProvenWinnerRow(row)) continue;
    const ins = insertOps(row)[0];
    if (!ins?.sourcePath) continue;
    const key = recordKey(ins.detail);
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

// ── Transfer-lärandet (steg 3, ägarbeslut 2026-08-11 "Kör") ──────────────────
// Biblioteket lär sig VILKA block som faktiskt reser mellan sidor. Meriterna
// härleds ur variantraderna själva — ingen ny tabell: en vinst är en bevisad
// vinnarrad som bär texten, ett misslyckande är en PENSIONERAD återbruks-
// variant (evidence.reuse — den föddes som återbruk och togs bort). ÄRLIG
// GRÄNS: pensionering skiljer inte "testad och förlorade" från "ägaren
// städade" — vi läser bägge som negativ signal för DEN sidan (att föreslå om
// något ägaren tagit bort är brus), och kräver TVÅ distinkta sidor innan
// blocket falsifieras sajtvitt.

/** Ett blocks meritlista, keyad på normaliserad text. */
export interface BlockTransferRecord {
  /** Distinkta sidor där blocket VUNNIT sitt A/B (bevisade vinnarrader). */
  wonOnPaths: string[];
  /** Distinkta sidor där en ÅTERBRUKS-variant av blocket pensionerats. */
  failedOnPaths: string[];
}

/** Falsifieringströskeln: fallit på så här många DISTINKTA sidor ⇒ blocket
 *  lämnar biblioteket — överföringshypotesen är prövad och motbevisad. Ett
 *  enda fall kan vara sidbundet (fel kontext); två är ett mönster. */
export const REUSE_FALSIFIED_AT = 2;

/** Bygg meritlistorna ur variantrader. Skicka BÅDE de levande raderna och de
 *  pensionerade återbruksraderna (nattloopens huvudläsning exkluderar
 *  retired — misslyckandena hämtas separat). Ordningen bevaras: wonOnPaths
 *  listar äldsta vinsten först (samma attribution som skörden). */
export function blockTransferRecords(rows: ReuseVariantRow[]): Map<string, BlockTransferRecord> {
  const records = new Map<string, BlockTransferRecord>();
  const rec = (key: string): BlockTransferRecord => {
    const r = records.get(key) ?? { wonOnPaths: [], failedOnPaths: [] };
    records.set(key, r);
    return r;
  };
  for (const row of rows) {
    const ins = insertOps(row)[0];
    if (!ins) continue;
    const key = recordKey(ins.detail);
    const ev = row.evidence as { reuse?: unknown; wasWinner?: unknown } | null | undefined;
    if (isProvenWinnerRow(row)) {
      const r = rec(key);
      if (!r.wonOnPaths.includes(row.path)) r.wonOnPaths.push(row.path);
    } else if (row.status === "retired" && ev?.reuse) {
      // VUNNEN-och-tillbakadragen är INTE ett misslyckande (granskningsfynd
      // 2026-08-11): winner→retired är en legal ägartransition, och utan
      // wasWinner-markören (skriven av setVariantStatus) hade två sådana
      // avvecklingar falsifierat ett block som vann varje test det körde.
      // Neutral: vinsten försvann med raden, misslyckandet fanns aldrig.
      if (ev?.wasWinner) continue;
      const r = rec(key);
      if (!r.failedOnPaths.includes(row.path)) r.failedOnPaths.push(row.path);
    }
  }
  return records;
}

/** Dekorera fröna med meritlistan (alsoWonOn, sorterad) och ranka: flest
 *  ANDRA vunna sidor först — ett block som bevisat reser erbjuds före ett
 *  enkelvinst-block. Stabil sortering: lika meriter behåller skördeordningen
 *  (äldsta vinnaren först). */
export function decorateSeedsWithTransfer(
  seeds: ReuseSeed[],
  records: Map<string, BlockTransferRecord>,
): ReuseSeed[] {
  const decorated = seeds.map((seed) => {
    const r = records.get(recordKey(seed.text));
    const alsoWonOn = (r?.wonOnPaths ?? []).filter((p) => p !== seed.provedOnPath).sort();
    return alsoWonOn.length > 0 ? { ...seed, alsoWonOn } : { ...seed };
  });
  return decorated
    .map((seed, i) => ({ seed, i, wins: seed.alsoWonOn?.length ?? 0 }))
    .sort((a, b) => b.wins - a.wins || a.i - b.i)
    .map((x) => x.seed);
}

/** Dela fröna i behållna och falsifierade (≥ REUSE_FALSIFIED_AT distinkta
 *  fallna sidor) — anroparen loggar de falsifierade, aldrig tyst. */
export function partitionFalsified(
  seeds: ReuseSeed[],
  records: Map<string, BlockTransferRecord>,
): { kept: ReuseSeed[]; falsified: ReuseSeed[] } {
  const kept: ReuseSeed[] = [];
  const falsified: ReuseSeed[] = [];
  for (const seed of seeds) {
    const r = records.get(recordKey(seed.text));
    if ((r?.failedOnPaths.length ?? 0) >= REUSE_FALSIFIED_AT) falsified.push(seed);
    else kept.push(seed);
  }
  return { kept, falsified };
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
  const key = recordKey(seed.text);
  const paths = new Set<string>();
  for (const row of rows) {
    if (row.status === "retired") continue;
    if (row.path === seed.provedOnPath) continue;
    if (insertOps(row).some((o) => recordKey(o.detail) === key)) {
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
 *  3. aldrig en sida där blocket redan PRÖVATS och pensionerats (transfer-
 *     lärandet: hypotesen är prövad DÄR — att föreslå om den är anti-lärande),
 *  4. aldrig en sida som redan VISAR texten (dubbelvisningsvakten),
 *  5. aldrig en sida som redan HAR en icke-pensionerad variant med texten
 *     (samma erbjudande två gånger är brus, inte evidens),
 *  6. aldrig över mättnadstaket (REUSE_MAX_SPREAD distinkta sidor),
 *  7. högst MAX_REUSE_OFFERS_PER_CELL frön per cell. */
export function offerSeedsForCell(args: {
  seeds: ReuseSeed[];
  cellPath: string;
  landingFlatHtml: string;
  rows: ReuseVariantRow[];
  /** Transfer-meriterna (steg 3) — utelämnad ⇒ vakt 3 vilar (bakåtkompatibelt). */
  records?: Map<string, BlockTransferRecord>;
}): ReuseSeed[] {
  const out: ReuseSeed[] = [];
  for (const seed of args.seeds) {
    if (out.length >= MAX_REUSE_OFFERS_PER_CELL) break;
    if (seed.provedOnPath === args.cellPath) continue;
    if (seed.sourcePath === args.cellPath) continue;
    // Transfer-lärandet (vakt 3): blocket har redan prövats och pensionerats
    // på den här sidan — hypotesen är prövad HÄR, om-erbjudande är anti-
    // lärande (och att föreslå om något ägaren tagit bort är brus).
    if (args.records?.get(recordKey(seed.text))?.failedOnPaths.includes(args.cellPath)) continue;
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
