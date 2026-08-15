// Kandidatkatalogen (ägarbeslut 2026-07-27: "få ihop LLM och kod" —
// schackmotor-mönstret): KODEN genererar alla lagliga drag ur innehålls-
// modellen; LLM:en VÄLJER draget ur menyn i stället för att hitta på fritt.
// Fleet-fyndet som drev skiftet: 32/100 sajter dog på att designern aldrig
// levererade en giltig plan (tom eller avvisad i valideringen) — ett val ur
// en sluten meny kan inte avvisas by construction, och det deterministiska
// golvet (poängsättningen här) gör att tratten aldrig mer svarar "kunde inte
// analysera" på en sida med innehåll.
//
// Ärlighetskontraktet är oförändrat: varje kandidattext är ORDAGRANN sidtext
// (extract.ts garanterar äkta substrängar; rubriker kommer ur markupen),
// grindarna dömer precis som förut, och browser-förprovningen (probe-steget)
// filtrerar bara bort det som ändå aldrig hade kunnat appliceras.

import { defuseMarkers } from "./defuse";
import type { RedesignContentModel } from "./context";
import type { RedesignOp } from "./generate";
import type { MoveSeed, ReuseSeed } from "./reuse";

export interface Candidate {
  /** Stabilt id LLM-väljaren låses till ("mv-sec-3-testimonials", "ins-trusted_by-0"). */
  id: string;
  kind: "move_up" | "insert_snippet";
  /** move: sektionen som lyfts. insert: alltid "hero" (raden landar under den). */
  targetId: string;
  /** insert: den ordagranna raden. move: tom (op-detaljen är flytten själv). */
  detail: string;
  /** Deterministisk poäng — golvets rangordning när LLM:en inte svarar. */
  score: number;
  /** Människoläsbar grund för poängen — går in i väljar-prompten som menyrad. */
  basis: string;
  /** Återbrukskandidater (blockbiblioteket steg 2): sidan vars frysta
   *  whitelist validerar citatet — följer med in i op.sourcePath så
   *  validateOps exakta-likhets-gren och driftsvepet tar över orörda. */
  sourcePath?: string;
  /** Proveniensen för ett bevisat block: var det vann och vilken variant.
   *  Renderas som BETRODD [proven:]-rad i menyn (vår egen data, inte
   *  sidtext) och blir evidence.reuse när blocket överlever verify.
   *  alsoProvedOn (steg 3): ANDRA sidor där samma block också vunnit —
   *  meritlistan väljaren väger. */
  proven?: { provedOnPath: string; variantId: string; alsoProvedOn?: string[] };
}

/** Bevisbärande sektionstyper i fallande säljvikt — testimonials är starkast
 *  (riktiga röster), därefter kvantifierat förtroende. `features` är
 *  MEDVETET uteslutet: aldrig ett bevis, aldrig ett lyftmål (extract.ts). */
const PROOF_TYPE_WEIGHT: Record<string, number> = {
  testimonials: 3,
  logos: 2.5,
  stats: 2.5,
  proof: 2.2,
  pricing: 1.5,
};

/** Trust-signaltyper i fallande vikt — samma ordning som fallback-stegen
 *  använde; compliance/independence är svagare säljargument än socialt bevis. */
const SIGNAL_TYPE_WEIGHT: Record<string, number> = {
  trusted_by: 3,
  social_proof_count: 2.8,
  guarantee: 2.4,
  independence: 1.6,
  compliance: 1.4,
};

const MIN_SIGNAL_LEN = 8;
const MAX_DETAIL_LEN = 90;

// ── Beteende-sätet (steg 7, D3) ──────────────────────────────────────────────
// Katalogens rangordning ska grundas i vad besökarna på JUST den sidan gör,
// inte i typvikterna ovan. Sätet: ett valfritt per-sektion-engagemang [0,1]
// som ADDERAS på priorn — beteendet leder när data finns, priorn bryter lika
// och bär hela rangordningen när data saknas (byte-identisk default).
// Datakvalitet är INTE sätets ansvar: rollupen (steg 8) lämnar null vid tunn
// data/hög join-miss, och då anropas katalogen utan säte precis som idag.

export interface BehaviorInput {
  /** Sektions-id → observerat engagemang i [0,1] (andel/rate ur rollupen).
   *  Sektioner utan post tävlar på priorn ensam (term 0 — neutralt). */
  sectionWeight: Record<string, number>;
  /** Sektions-id → antal laddningar andelen mättes på (rollupens
   *  sectionVisits). Med posten krymper sektionens term med n/(n+N0) —
   *  DYNAMISKA GOLVET (floor-svepet 2026-08-09): inflytande proportionellt
   *  mot evidensen i stället för allt-eller-inget vid en hård tröskel.
   *  Utelämnad (rör-testets perfekta signal, äldre anropare) ⇒ ingen
   *  krympning — exakt dagens semantik. */
  sectionVisits?: Record<string, number>;
  /** Styrkan beteendet väger mot typ-priorn. Default BEHAVIOR_GAIN — vald av
   *  facit-svepet (reco-eval), inte tyckande. Överstyrs bara av eval:er. */
  gain?: number;
}

/** Facit-valt (reco-eval gain-svep 2026-08-05): från ~20 återfinner
 *  beteende-rankningen den dolda sanningen inom ett par punkter från
 *  orakel-taket; 40 ger marginal (flippar hela prior-spannet ~2,9 redan vid
 *  Δengagemang ≈ 0,07 — halva brus-SD:n) utan att priorn förlorar
 *  tiebreak-rollen vid exakta lika. */
export const BEHAVIOR_GAIN = 40;

/** Krympningens halvvärdespunkt: vid n = N0 laddningar väger beteendet
 *  hälften av vad det någonsin kan väga (n=30 ⇒ gain 15, n=100 ⇒ 27,
 *  n=1000 ⇒ 38). Facit-valt (floor-svepet 2026-08-10, reco-eval:floor):
 *  volymkrympningen + rollupens golv vid 30 dominerar både den hårda
 *  1000-grinden (som kastar bort 84,9 % träff vid n=30 mot priorns 29,4)
 *  och z-tilltrosregeln (54,7 % vid n=30) — överallt, bägge världs-
 *  familjerna. Svepet är körbart: `bun run reco-eval:floor`. */
export const BEHAVIOR_SHRINK_N0 = 50;

/** Återbrukskandidatens golv-poäng (blockbiblioteket steg 2). Härledd ur
 *  prior-taken, inte tyckt: varje OBEVISAD prior-kombination når högst
 *  3 (typ) + 1 (trust) + 0,4 (position) = 4,4 — ett block som VANN ett
 *  riktigt A/B ska stå över alla obevisade priors. Men beteende-ledda
 *  kandidater ska stå ÖVER återbruket: redan vid golv-n (30) adderar en
 *  het sektion (w ≈ 0,3) 15·0,3 ≈ 4,5 och passerar. Ordningen är
 *  principen från 2026-08-10-samtalet: målsidans egna besökare > importerat
 *  bevis > obevisade priors. Överföringen är OBEVISAD tills cellens eget
 *  test körts — poängen är en hypotes-rankning, aldrig ett facit. */
export const REUSE_PROVEN_SCORE = 5;

/** Dragformerna katalogen genererar när anroparen inte säger annat. Speglar
 *  DEFAULT_GUARDRAILS.ops i context.ts — ändra BÄGGE om vokabulären ändras
 *  (de testas mot varandra i candidates.test.ts). */
export const DEFAULT_CANDIDATE_OPS: readonly string[] = ["move_up"];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Beteende-termen för en kandidat förankrad i sektion `sectionId`. 0 när
 *  sätet inte matas eller sektionen saknar data — då är katalogen byte-
 *  identisk med den beteende-blinda. Med sectionVisits krymper termen med
 *  n/(n+N0): en andel mätt på 31 laddningar väger ~15/40 av en mätt på
 *  tusen — brus dämpas i proportion till sin storlek, aldrig via en hård
 *  grind som kastar bort mätbar signal (floor-svepet 2026-08-09). */
function behaviorTerm(behavior: BehaviorInput | undefined, sectionId: string): number {
  const w = behavior?.sectionWeight?.[sectionId];
  if (typeof w !== "number" || !Number.isFinite(w)) return 0;
  // Kontraktet är på KART-nivå (granskningsfynd 2026-08-10): finns
  // sectionVisits alls ska VARJE viktad sektion ha sin n där — en vikt vars
  // n saknas eller är trasig (NaN/negativ) döms neutral, aldrig okrympt.
  // Annars hade en buggig producent gett sektionen UTAN evidensräkning
  // fullt gain medan de mätta krymptes — motsatsen till golvets mening.
  // Helt utelämnad karta = gamla kontraktet (rör-testets perfekta signal).
  const nMap = behavior?.sectionVisits;
  let shrink = 1;
  if (nMap) {
    const n = nMap[sectionId];
    shrink =
      typeof n === "number" && Number.isFinite(n) && n > 0 ? n / (n + BEHAVIOR_SHRINK_N0) : 0;
  }
  return (behavior?.gain ?? BEHAVIOR_GAIN) * shrink * clamp01(w);
}

/** Trust-signalernas texter är regex-fångster ur PLATT text och kan dra med
 *  sig angränsande UI-brus (talentium-fixturen: "Trusted by the world's best
 *  0:30 Product overview Play video…"). Klipp vid första tidskoden/kända
 *  UI-ordet — kvarvarande prefix är fortfarande ordagrann sidtext (en
 *  substräng av korpusen), så valideringens samma-sida-krav håller.
 *
 *  Upprepnings-klippet (ägarfynd fikajobs 2026-07-28, Framer-klassen): SSR
 *  renderar samma element EN gång per brytpunkt och den platta texten blir
 *  "Trusted by … in Sweden Trusted by …" — inledningen som återkommer är
 *  duplikatets skarv. Klipp där; prefixet är fortfarande ordagrann sidtext.
 *  Exporterad: bevis-lyftets fallback (auto-generate) delar städningen. */
export function tidySignalText(raw: string): string {
  const cut = raw
    .split(/\s+\d{1,2}:\d{2}\b/)[0]
    .split(/\s+(?:Play video|Watch video|Se videon)\b/i)[0]
    .trim();
  const probe = cut.slice(0, 16).trim();
  if (probe.length < 12) return cut;
  const second = cut.indexOf(probe, probe.length);
  return second > 0 ? cut.slice(0, second).trim() : cut;
}

/** Generera hela katalogen av lagliga drag ur innehållsmodellen. Ren funktion
 *  utan DOM — browser-förprovningen (probe) annoterar/filtrerar efteråt.
 *  Sorterad: högst poäng först (golvets val = första posten).
 *
 *  `behavior` (steg 7, D3): per-sektion-engagemang som väger OM rangordningen
 *  — utelämnat ⇒ byte-identisk katalog med den beteende-blinda (låst av test).
 *  ÄVEN insert-kandidater förankras till sin källsektions engagemang — annars
 *  når beteendet aldrig en-rad-under-heron-förmågan. */
export function generateCandidates(
  content: RedesignContentModel,
  behavior?: BehaviorInput,
  reuse?: ReuseSeed[],
  moveReuse?: MoveSeed[],
  // VOKABULÄREN ÄR EN SANNING (ägarbeslut 2026-08-15: "endast flytta
  // sektioner, inte ändra text"). Katalogen ignorerade tidigare
  // guardrails.ops helt och genererade alltid bägge dragformerna — den fria
  // designern grindades på listan men katalogen, som är HUVUDVÄGEN sedan
  // steg 11, gjorde inte det. Nu läser bägge samma lista, och att släppa in
  // text igen är en ändring på ETT ställe (context.ts DEFAULT_GUARDRAILS).
  allowedOps: readonly string[] = DEFAULT_CANDIDATE_OPS,
): Candidate[] {
  const out: Candidate[] = [];
  const sectionIds = new Set(content.sections.map((s) => s.id));
  const mayInsert = allowedOps.includes("insert_snippet");

  // Flytt-kandidater: bevisbärande sektioner under folden. Hjälten är aldrig
  // ett flyttmål, och sektioner ovanför folden har inget att vinna.
  // Flytt-fröna (transferformen steg 4) annoterar i efterhand — kandidat-
  // mängden är alltid målsidans egen, fröet rör bara poäng + proveniens.
  const moveIdxByType = new Map<string, number[]>();
  for (const s of content.sections) {
    if (s.type === "hero" || s.aboveFold) continue;
    const typeWeight = PROOF_TYPE_WEIGHT[s.type] ?? 0;
    const trustBonus = s.containsTrustSignals ? 1 : 0;
    if (typeWeight + trustBonus <= 0) continue;
    if (!s.heading) continue;
    const idxs = moveIdxByType.get(s.type) ?? [];
    idxs.push(out.length);
    moveIdxByType.set(s.type, idxs);
    out.push({
      id: `mv-${s.id}`,
      kind: "move_up",
      targetId: s.id,
      detail: "",
      score:
        typeWeight + trustBonus + Math.min(s.position, 8) * 0.05 + behaviorTerm(behavior, s.id),
      basis: `${s.type}${s.containsTrustSignals ? " [proof]" : ""} below the fold (position ${s.position}): "${s.heading.slice(0, 60)}"`,
    });
  }

  // Flytt-vinnares transferform (steg 4): fröet lyfter målsidans EGEN
  // kandidat av samma typ till bevisgolvet (max — aldrig sänkning: en
  // beteende-het sektion behåller sin högre poäng) och fäster proveniensen.
  // Bär sidan flera sektioner av typen annoteras bara den STARKASTE
  // (högst egen poäng, dokumentordning vid lika) — typklassens bevis ska
  // inte blåsa upp menyn med [proven:]-rader. Utelämnad ⇒ byte-identisk
  // katalog, samma kontrakt som behavior/reuse.
  for (const seed of moveReuse ?? []) {
    const idxs = moveIdxByType.get(seed.sectionType);
    if (!idxs || idxs.length === 0) continue;
    const best = idxs.reduce((a, b) => (out[b].score > out[a].score ? b : a));
    if (out[best].proven) continue; // första fröet per typ äger annoteringen
    out[best] = {
      ...out[best],
      score: Math.max(out[best].score, REUSE_PROVEN_SCORE),
      proven: {
        provedOnPath: seed.provedOnPath,
        variantId: seed.variantId,
        ...(seed.alsoWonOn && seed.alsoWonOn.length > 0 ? { alsoProvedOn: seed.alsoWonOn } : {}),
      },
    };
  }

  // Hela avsnittet nedanför (trust-signaler, rubrik-reserven, textåterbruket)
  // är INSERT-kandidater — TEXTDRAG. Vokabulären avgör om de ens genereras
  // (ägarbeslut 2026-08-15): med move-only slutar katalogen här och menyn
  // innehåller enbart flyttar. Sorteringen är exakt densamma som i slutet, så
  // en flytt-meny ser likadan ut oavsett vilken väg som tog den hit.
  if (!mayInsert) return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  // Insert-kandidater: ordagranna trust-rader lyfta till under hjälten.
  // Dedup på normaliserad text — samma rad ska inte stå två gånger i menyn.
  const seen = new Set<string>();
  content.trustSignals.forEach((t, i) => {
    const text = tidySignalText(t.text).slice(0, MAX_DETAIL_LEN);
    const key = text.replace(/\s+/g, " ").toLowerCase();
    const weight = SIGNAL_TYPE_WEIGHT[t.type] ?? 1;
    if (text.length < MIN_SIGNAL_LEN || seen.has(key)) return;
    seen.add(key);
    out.push({
      id: `ins-${t.type}-${i}`,
      kind: "insert_snippet",
      targetId: "hero",
      detail: text,
      // Redan-ovanför-folden-signaler är svagare kandidater (redan synliga),
      // men inte noll: en rad DIREKT under rubriken slår en rad i sidfoten.
      // Beteende-förankring via signalens KÄLLSEKTION när extraktionen vet den
      // ("body"/okänd ⇒ neutral term 0 — priorn ensam, precis som utan säte).
      score:
        weight -
        (t.aboveFold ? 1 : 0) +
        (sectionIds.has(t.section) ? behaviorTerm(behavior, t.section) : 0),
      basis: `${t.type}${t.aboveFold ? " (already above the fold)" : ""}: "${text}"`,
    });
  });

  // Bevissektionernas RUBRIKER som insert-reserv (dagens fallback-texter) —
  // lägre poäng än signalerna: en rubrik är en pekare, en signal är beviset.
  for (const s of content.sections) {
    if (s.type === "hero" || !s.heading) continue;
    const typeWeight = PROOF_TYPE_WEIGHT[s.type] ?? 0;
    if (typeWeight <= 0 && !s.containsTrustSignals) continue;
    const text = s.heading.trim().slice(0, MAX_DETAIL_LEN);
    const key = text.replace(/\s+/g, " ").toLowerCase();
    if (text.length < MIN_SIGNAL_LEN || seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `insh-${s.id}`,
      kind: "insert_snippet",
      targetId: "hero",
      detail: text,
      // Rubrik-reserven förankras till SIN sektions engagemang (kritikerns
      // fix): är sektionen sidans hetaste ska även dess en-rads-lyft kunna slå
      // en kallare sektions flytt — annars är insert-förmågan beteende-blind.
      score: (typeWeight || 1.5) * 0.6 + behaviorTerm(behavior, s.id),
      basis: `heading of the ${s.type} section: "${text}"`,
    });
  }

  // Återbrukskandidater (blockbiblioteket steg 2): vinnarnas bevisade block,
  // erbjudna av nattloopen efter alla frö-vakter (mättnad, dubbelvisning,
  // viabilitet). detail är ALDRIG trunkerad — validateOps kräver exakt
  // likhet mot källsidans whitelist, och en klippt text hade fällts där.
  // Dedup mot samma-sida-kandidaterna via samma seen-mängd: bär sidan redan
  // texten som signal/rubrik är fröet överflödigt (uppströms-vakterna ska ha
  // sållat det, men menyn får aldrig visa samma text två gånger).
  (reuse ?? []).forEach((r, i) => {
    const key = r.text.replace(/\s+/g, " ").toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      id: `rins-${i}-${r.variantId.slice(0, 8)}`,
      kind: "insert_snippet",
      targetId: "hero",
      detail: r.text,
      sourcePath: r.sourcePath,
      proven: {
        provedOnPath: r.provedOnPath,
        variantId: r.variantId,
        ...(r.alsoWonOn && r.alsoWonOn.length > 0 ? { alsoProvedOn: r.alsoWonOn } : {}),
      },
      score: REUSE_PROVEN_SCORE,
      basis: `proven block from ${r.provedOnPath}: "${r.text.slice(0, 60)}"`,
    });
  });

  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Kandidat → RedesignOp (verify-kedjans språk). `why` bär väljarens (eller
 *  golvets) motivering — den blir ägar-/rapporttexten. */
export function candidateToOp(c: Candidate, why: string): RedesignOp {
  return c.kind === "move_up"
    ? { op: "move_up", targetId: c.targetId, detail: "Move this section higher on the page", why }
    : {
        op: "insert_snippet",
        targetId: "hero",
        detail: c.detail,
        // Återbruk: källsidan följer med så validateOps kör exakta-likhets-
        // grenen mot dess frysta whitelist (aldrig substräng mot målsidan).
        ...(c.sourcePath ? { sourcePath: c.sourcePath } : {}),
        why,
      };
}

/** Golvets motivering när LLM-väljaren inte svarat — ärligt märkt som
 *  regelvald, aldrig som modellens omdöme. */
export function floorWhy(c: Candidate): string {
  // basis bär ORDAGRANN sidtext och den här strängen blir variantens `why` —
  // den ägaren läser bredvid de ÄKTA grindtalen i godkännande-vyn. En rubrik
  // som själv innehåller "[gates: …]" hade annars tryckt fabricerade
  // säkerhetssiffror rakt in i den manuella grinden (granskningsfynd
  // 2026-08-08: samma injektionsklass som väljar-prompten, men mot en
  // mottagare som FAKTISKT bestämmer om varianten får serva).
  return `Rule-selected top candidate (deterministic floor): ${defuseMarkers(c.basis)}.`;
}
