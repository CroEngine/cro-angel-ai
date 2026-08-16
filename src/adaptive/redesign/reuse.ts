// Blockbiblioteket steg 2 (ägarbeslut 2026-08-11 "Kör!"): vinnarnas bevisade
// block erbjuds som ORDAGRANNA återanvändningskandidater på systersidor —
// genom exakt samma bevis-kedja som allt annat (katalog → DOM-probe →
// väljare → verify → ägarens knapp → ramp → guardrail-svep).
//
// VAD SOM ÄR ETT BEVISAT BLOCK: en vinnarvariants insert_snippet-text. Bara
// den. Ett A/B-vunnet citat är den enda blockform vars ordagranna text,
// källsida och driftkontrakt (evidence.dependencies) redan finns i systemet —
// och vars "bevis" är ett riktigt testutfall, inte attribution (positions-
// bias). Census-heta sektioner är MEDVETET utanför: deras "bevis" är
// attribution, inte testutfall.
//
// FLYTT-VINNARNAS TRANSFERFORM (steg 4, ägarbeslut 2026-08-14 "Flytta!"):
// en move_up-vinnares överföringsform är TYPKLASSEN, inte innehållet — "att
// lyfta en testimonials-sektion över folden vann sitt A/B på /X". Fröet bär
// bara sektionstypen (ur targetId:ts sec-N-typ-form); på målsidan annoteras
// målsidans EGEN move_up-kandidat av samma typ med proveniensen och ett
// poänggolv. Inget importeras — kandidaten fanns redan i målsidans katalog,
// så D2 (aldrig fabricera) håller by construction, och hela grindkedjan
// (probe → verify → ägarens knapp → ramp → guardrail-svep) är oförändrad.
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

import { templateMatches } from "../../lib/page-template";
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
    const ev = row.evidence as
      { reuse?: { kind?: unknown }; wasWinner?: unknown } | null | undefined;
    if (isProvenWinnerRow(row)) {
      const r = rec(key);
      if (!r.wonOnPaths.includes(row.path)) r.wonOnPaths.push(row.path);
      // Flytt-återbrukets pensioneringar hör till FLYTT-meritlistan
      // (transferformen steg 4) — en rad född som typklass-överföring får
      // aldrig döma ett textblock, ens om den råkar bära en insert-op.
      // Frånvarande kind = textblock (raderna som fanns före steg 4).
    } else if (row.status === "retired" && ev?.reuse && ev.reuse.kind !== "move") {
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
    // Mönster-medvetna vakter (samma pathsCover som flytt-fröna): cellPath
    // kan vara "/blogg/*" efter mall-carve-out-lyftet 2026-08-16 — strikt
    // likhet hade missat varje sida inuti mönstret. Vilande under move-only
    // (inga textfrön erbjuds) men lagas nu, inte när vokabulären öppnas igen.
    if (pathsCover(seed.provedOnPath, args.cellPath)) continue;
    if (pathsCover(seed.sourcePath, args.cellPath)) continue;
    // Transfer-lärandet (vakt 3): blocket har redan prövats och pensionerats
    // på den här sidan — hypotesen är prövad HÄR, om-erbjudande är anti-
    // lärande (och att föreslå om något ägaren tagit bort är brus).
    if (
      args.records
        ?.get(recordKey(seed.text))
        ?.failedOnPaths.some((p) => pathsCover(p, args.cellPath))
    )
      continue;
    if (textPresent(args.landingFlatHtml, seed.text)) continue;
    const key = normQuote(seed.text).toLowerCase();
    const alreadyHere = args.rows.some(
      (row) =>
        row.status !== "retired" &&
        pathsCover(row.path, args.cellPath) &&
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

// ── Flytt-vinnares transferform (steg 4, ägarbeslut 2026-08-14 "Flytta!") ────
// Spegeln av textblocks-maskineriet ovan, keyad på SEKTIONSTYP i stället för
// normaliserad text. Delarna är medvetet parallella småfunktioner (inte en
// generisk abstraktion): nycklarna, vakterna och ärlighetsgränserna skiljer
// sig i detaljer som en delad kärna hade tvingat ihop.

/** Ett skördat flytt-frö: typklassen som vann + var den vann. */
export interface MoveSeed {
  variantId: string;
  provedOnPath: string;
  /** Sektionstypen ur vinnar-opens targetId (sec-N-typ) — den ENDA delen av
   *  vinnaren som reser. Målsidans kandidat är målsidans egen sektion. */
  sectionType: string;
  /** Transfer-meriterna: ANDRA sidor där samma typklass också vunnit. */
  alsoWonOn?: string[];
}

/** Typer vars flytt-vinst INTE är en meningsfull hypotesklass: "section"/
 *  "content" är rubrik-klassificeringens ärliga "vet inte" — två otypade
 *  sektioner på olika sidor delar ingenting semantiskt, så "otypade flyttar
 *  vinner" reser inte. hero är aldrig ett flyttmål alls. */
const NON_TRANSFERABLE_MOVE_TYPES = new Set(["section", "content", "hero"]);

/** Sektionstypen ur ett move_up-targetId ("sec-3-testimonials" →
 *  "testimonials"). Null för allt som inte bär extract.ts sec-N-typ-form —
 *  hellre inget frö än ett gissat. */
export function moveSectionType(targetId: unknown): string | null {
  if (typeof targetId !== "string") return null;
  const m = /^sec-\d+-(.+)$/.exec(targetId);
  return m ? m[1] : null;
}

interface MoveOpLike {
  op?: unknown;
  targetId?: unknown;
}

/** Radens move_up-ops som sektionstyper (oparsbara targetId sållas). */
const moveTypes = (row: ReuseVariantRow): string[] => {
  if (!Array.isArray(row.ops)) return [];
  const out: string[] = [];
  for (const raw of row.ops as MoveOpLike[]) {
    if (!raw || raw.op !== "move_up") continue;
    const t = moveSectionType(raw.targetId);
    if (t) out.push(t);
  }
  return out;
};

/** Skörda flytt-frön ur sajtens variantrader. Samma vinnardefinition som
 *  textskörden (isProvenWinnerRow — vinnare, ohållen, aldrig drift-
 *  uppdaterad), aldrig otypade klasser (NON_TRANSFERABLE_MOVE_TYPES), dedup
 *  på typ (två vinnare av samma typklass är ETT bevis — äldsta vinnaren äger
 *  det, samma attribution som textskörden).
 *
 *  BARA RADENS PRIMÄRA FLYTT (första transferbara move-open), spegel av
 *  textskördens "första insert-open" — och av samma skäl: en variant med två
 *  flyttar vann som HELHET, så ingen av opsen är bevisad var för sig. Att
 *  skörda bägge hade gjort ett kombinationsbevis till två enskilda. */
export function harvestMoveSeeds(rows: ReuseVariantRow[]): MoveSeed[] {
  const seeds: MoveSeed[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isProvenWinnerRow(row)) continue;
    const type = moveTypes(row).find((t) => !NON_TRANSFERABLE_MOVE_TYPES.has(t));
    if (!type || seen.has(type)) continue;
    seen.add(type);
    seeds.push({ variantId: row.id, provedOnPath: row.path, sectionType: type });
  }
  return seeds;
}

/** Flytt-meriterna, keyade på sektionstyp. Vinster: bevisade vinnarrader vars
 *  PRIMÄRA flytt är av typen (även organiska — en vinst är en vinst, precis
 *  som textsidan räknar varje vinnare som bär texten; samma primär-regel som
 *  skörden, så meritlistan och fröna aldrig dömer olika). Misslyckanden: BARA
 *  pensionerade rader födda som återbruk (evidence.reuse) vars op är en
 *  flytt — samma ärliga gräns och samma wasWinner-neutralitet som
 *  blockTransferRecords. Text- och flytt-raderna kontaminerar aldrig
 *  varandra: textrecorden keyar på insert-ops, den här på move-ops. */
export function moveTransferRecords(rows: ReuseVariantRow[]): Map<string, BlockTransferRecord> {
  const records = new Map<string, BlockTransferRecord>();
  const rec = (key: string): BlockTransferRecord => {
    const r = records.get(key) ?? { wonOnPaths: [], failedOnPaths: [] };
    records.set(key, r);
    return r;
  };
  for (const row of rows) {
    const type = moveTypes(row).find((t) => !NON_TRANSFERABLE_MOVE_TYPES.has(t));
    if (!type) continue;
    const ev = row.evidence as
      { reuse?: { kind?: unknown }; wasWinner?: unknown } | null | undefined;
    if (isProvenWinnerRow(row)) {
      const r = rec(type);
      if (!r.wonOnPaths.includes(row.path)) r.wonOnPaths.push(row.path);
      // BARA rader födda som FLYTT-återbruk är flytt-misslyckanden: en
      // pensionerad textblocks-variant som råkar bära en move-op säger
      // ingenting om typklassens överförbarhet.
    } else if (
      row.status === "retired" &&
      (ev?.reuse as { kind?: unknown } | undefined)?.kind === "move"
    ) {
      // Vunnen-och-tillbakadragen är neutral — samma dom som textsidan.
      if (ev?.wasWinner) continue;
      const r = rec(type);
      if (!r.failedOnPaths.includes(row.path)) r.failedOnPaths.push(row.path);
    }
  }
  return records;
}

/** Dekorera flytt-fröna med meritlistan och ranka: flest ANDRA vunna sidor
 *  först, stabil ordning vid lika — spegeln av decorateSeedsWithTransfer. */
export function decorateMoveSeedsWithTransfer(
  seeds: MoveSeed[],
  records: Map<string, BlockTransferRecord>,
): MoveSeed[] {
  const decorated = seeds.map((seed) => {
    const r = records.get(seed.sectionType);
    const alsoWonOn = (r?.wonOnPaths ?? []).filter((p) => p !== seed.provedOnPath).sort();
    return alsoWonOn.length > 0 ? { ...seed, alsoWonOn } : { ...seed };
  });
  return decorated
    .map((seed, i) => ({ seed, i, wins: seed.alsoWonOn?.length ?? 0 }))
    .sort((a, b) => b.wins - a.wins || a.i - b.i)
    .map((x) => x.seed);
}

/** Falsifierings-delningen för flyttar — samma tröskel (REUSE_FALSIFIED_AT
 *  distinkta fallna sidor) och samma kontrakt: anroparen loggar, aldrig tyst. */
export function partitionFalsifiedMoves(
  seeds: MoveSeed[],
  records: Map<string, BlockTransferRecord>,
): { kept: MoveSeed[]; falsified: MoveSeed[] } {
  const kept: MoveSeed[] = [];
  const falsified: MoveSeed[] = [];
  for (const seed of seeds) {
    const r = records.get(seed.sectionType);
    if ((r?.failedOnPaths.length ?? 0) >= REUSE_FALSIFIED_AT) falsified.push(seed);
    else kept.push(seed);
  }
  return { kept, falsified };
}

/** Är typklassen redan mättad? Distinkta icke-pensionerade ANDRA sidor (utöver
 *  vinnarens egen) där BIBLIOTEKET spritt typklassen — samma tak
 *  (REUSE_MAX_SPREAD) som textblocken.
 *
 *  BARA ÅTERBRUKSFÖDDA RADER RÄKNAS (granskningsfynd 2026-08-14). Taket mäter
 *  hur långt bibliotekets hypotes redan spridits, inte hur många sidor som
 *  råkar testa en flytt. På textsidan är de sakerna nästan samma sak (en
 *  ordagrann rad bärs i praktiken bara av återbruket), men move_up är
 *  katalogens VANLIGASTE drag: räknades organiska flyttar hade två sidor med
 *  en testimonials-flytt permanent tystat typklassen — och just på sajterna
 *  med mest bevis. Ingen visar heller besökaren något dubbelt: varje sida
 *  flyttar sin EGEN sektion. (Att sidan redan testar typklassen fångas
 *  separat av redan-här-vakten, som med flit räknar ALLA flyttar.) */
export function moveSeedSaturated(seed: MoveSeed, rows: ReuseVariantRow[]): boolean {
  const paths = new Set<string>();
  for (const row of rows) {
    if (row.status === "retired") continue;
    if (row.path === seed.provedOnPath) continue;
    if ((row.evidence as { reuse?: { kind?: unknown } } | null | undefined)?.reuse?.kind !== "move")
      continue;
    if (moveTypes(row).includes(seed.sectionType)) paths.add(row.path);
  }
  return paths.size >= REUSE_MAX_SPREAD;
}

/** Flytt-fröna EN cell faktiskt erbjuds. Vakterna, i ordning:
 *  1. aldrig sidan flytten vann på (varianten står redan där),
 *  2. viabiliteten: målsidans EGEN katalog måste bära en move-kandidat av
 *     typen (catalogMoveTypes — byggd av anroparen ur generateCandidates på
 *     målsidans innehållsmodell, så viabiliteten ÄR katalogen, aldrig en
 *     egen kopia av dess predikat). ÄRLIG GRÄNS: katalogens aboveFold-flagga
 *     är bara sann för hjälten (extract.ts kan inte veta var folden går utan
 *     rendering), så vakten filtrerar INTE sektioner som redan står högt.
 *     Det gör DOM-proben, som kör i riktig Chromium och dömer en flytt utan
 *     rum som inapplicable innan menyn byggs — och verify efter den.
 *     Textblockens dubbelvisningsvakt har ingen motsvarighet här och behövs
 *     inte: en flytt visar ingen ny text, den flyttar sidans egen sektion,
 *  3. aldrig en sida där typklassen redan PRÖVATS och pensionerats
 *     (transfer-lärandet — om-erbjudande är anti-lärande),
 *  4. aldrig en sida som redan HAR en icke-pensionerad flytt-variant av
 *     typen — ALLA flyttar räknas här, även organiska: att erbjuda en
 *     hypotes sidan redan prövar är brus oavsett var draget kom ifrån,
 *  5. aldrig över mättnadstaket (REUSE_MAX_SPREAD distinkta sidor där
 *     BIBLIOTEKET spritt typklassen — se moveSeedSaturated),
 *  6. högst MAX_REUSE_OFFERS_PER_CELL frön per cell. Taket är eget (inte
 *     delat med textfröna): flytt-frön ADDERAR inga menyrader — de
 *     annoterar rader som redan finns — så en gemensam budget hade svultit
 *     en form utan att minska bruset. */
/** Path-domen för frö-vakterna (granskningsfynd 2026-08-16, mall-carve-out-
 *  lyftet): en cellPath kan vara ett MALL-MÖNSTER ("/blogg/*") och frönas
 *  paths konkreta sidor inuti det — strikt likhet missade då varje vakt.
 *  Konkret: ett flytt-frö falsifierat på /blogg/kladdkaka hade åter-erbjudits
 *  till cellen /blogg/* och åter-applicerats på exakt sidan där det mätbart
 *  föll (anti-lärande). Domen är symmetrisk: mönstret täcker sina sidor och
 *  en sida täcks av sitt mönster. */
export function pathsCover(a: string, b: string): boolean {
  return a === b || templateMatches(a, b) || templateMatches(b, a);
}

export function offerMoveSeedsForCell(args: {
  seeds: MoveSeed[];
  cellPath: string;
  /** Sektionstyperna målsidans katalog faktiskt genererar move-kandidater
   *  för — anroparen bygger den ur generateCandidates(content). */
  catalogMoveTypes: Set<string>;
  rows: ReuseVariantRow[];
  records?: Map<string, BlockTransferRecord>;
}): MoveSeed[] {
  const out: MoveSeed[] = [];
  for (const seed of args.seeds) {
    if (out.length >= MAX_REUSE_OFFERS_PER_CELL) break;
    if (pathsCover(seed.provedOnPath, args.cellPath)) continue;
    if (!args.catalogMoveTypes.has(seed.sectionType)) continue;
    if (
      args.records?.get(seed.sectionType)?.failedOnPaths.some((p) => pathsCover(p, args.cellPath))
    )
      continue;
    const alreadyHere = args.rows.some(
      (row) =>
        row.status !== "retired" &&
        pathsCover(row.path, args.cellPath) &&
        moveTypes(row).includes(seed.sectionType),
    );
    if (alreadyHere) continue;
    if (moveSeedSaturated(seed, args.rows)) continue;
    out.push(seed);
  }
  return out;
}

/** Överlevde flytt-återbruket verify-stegen? Alt-stegen kan ha bytt till en
 *  annan kandidat — proveniensen skrivs bara när den slutliga varianten
 *  faktiskt flyttar en sektion av fröets typ. (En organisk flytt av samma
 *  typ på en cell där fröet ERBJÖDS attribueras också: hypotesen "typ-T-
 *  flytten reser hit" prövas av varianten oavsett om väljaren nådde den via
 *  golvet eller poänggolvet — det är exakt det transfer-lärandet ska räkna.) */
export function moveReuseSurvived(
  finalOps: { op: string; targetId?: string }[],
  offer: { sectionType: string },
): boolean {
  return finalOps.some(
    (o) => o.op === "move_up" && moveSectionType(o.targetId) === offer.sectionType,
  );
}
