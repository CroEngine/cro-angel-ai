// Sektions-joinen: runtime-census-rubriker ↔ extract.ts sektions-id:n — DEN
// DELADE KÄRNAN (steg 8 flyttade hit den från scripts/section-join-eval, som
// nu importerar härifrån). Produktionens rollup (engagement-rollup.ts) och
// offline-eval:en MÅSTE döma exakt likadant, annars mäter eval:en en annan
// regel än den som krediterar riktiga besökares engagemang.
//
// Regeln SPEGLAR produktionens serving-lokator (applier.ts findByLocator,
// CI-pinnad in i public/adaptive.js): pass 1 exakt normaliserad rubrik, pass 2
// 24-teckens prefix-substräng. En medveten avvikelse, öppet deklarerad: där
// appliern tar FÖRSTA träffen (den måste servera något) dömer joinen >1
// träffar FLERTYDIG och räknar det som miss — KREDITERING får, till skillnad
// från servering, aldrig gissa. Injektivitetspasset garanterar därtill att en
// census-rubrik är unikt mål för högst EN sektion (annars dubbelkrediteras
// samma engagemang).
//
// Uppmätt på 28 frusna sajter (steg 5, PR #200): kandidat-flyttmål → unik
// join 81,0 %; missarna är rubriker censusen aldrig ser — klassen rollupens
// null-grind finns för.

/** Applierns normalisering, byte-speglad (applier.ts:153): ihopfällt
 *  blanksteg, trim, gemener. */
export const normHeadingKey = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export type JoinVerdict = "UNIK" | "FLERTYDIG" | "OUPPLÖST";

export interface SectionJoin {
  aId: string;
  aType: string;
  aHeading: string;
  isCandidateTarget: boolean;
  verdict: JoinVerdict;
  /** Vilken pass som avgjorde (exakt/prefix) — bara för UNIK/FLERTYDIG. */
  via: "exact" | "prefix" | null;
  matchedBHeadings: string[];
}

/** Joina EN modellsektion mot census-rubrikerna med applierns tvåpass-regel.
 *  Ren funktion — testbar utan chromium. */
export function joinSection(
  a: { id: string; type: string; heading: string },
  bHeadings: string[],
  isCandidateTarget: boolean,
): SectionJoin {
  const aKey = normHeadingKey(a.heading);
  const base = { aId: a.id, aType: a.type, aHeading: a.heading, isCandidateTarget };
  if (!aKey) return { ...base, verdict: "OUPPLÖST", via: null, matchedBHeadings: [] };
  const exact = bHeadings.filter((b) => normHeadingKey(b) === aKey);
  if (exact.length === 1) return { ...base, verdict: "UNIK", via: "exact", matchedBHeadings: exact };
  if (exact.length > 1)
    return { ...base, verdict: "FLERTYDIG", via: "exact", matchedBHeadings: exact };
  // Pass 2 — applierns driftstoleranta 24-teckens prefix (indexOf, inte bara
  // startsWith: speglar applier.ts:168 exakt).
  const needle = aKey.slice(0, 24);
  const prefix = bHeadings.filter((b) => normHeadingKey(b).indexOf(needle) >= 0);
  if (prefix.length === 1)
    return { ...base, verdict: "UNIK", via: "prefix", matchedBHeadings: prefix };
  if (prefix.length > 1)
    return { ...base, verdict: "FLERTYDIG", via: "prefix", matchedBHeadings: prefix };
  return { ...base, verdict: "OUPPLÖST", via: null, matchedBHeadings: [] };
}

/** Joina ALLA modellsektioner + kör INJEKTIVITETSPASSET: två sektioner kan
 *  annars bägge bli UNIK mot SAMMA enda census-rubrik (en exakt + en prefix
 *  vars 24-teckens nål råkar ligga i den) — och samma sektions engagemang hade
 *  dubbelkrediterats. En census-rubrik får vara mål för EXAKT EN sektion:
 *  exakt träff slår prefix, därefter dokumentordning; förlorarna demoteras
 *  till FLERTYDIG (kreditering vore en gissning).
 *
 *  Returnerar domarna + kartan normaliserad B-rubrik → ägande sektions-id —
 *  exakt den upplösning rollupen krediterar engagemang genom. */
export function claimJoins(
  aSections: { id: string; type: string; heading: string }[],
  bHeadings: string[],
  candidateTargetIds: Set<string> = new Set(),
): { joins: SectionJoin[]; claimedBy: Map<string, string> } {
  const joins = aSections.map((a) => joinSection(a, bHeadings, candidateTargetIds.has(a.id)));
  const claimed = new Map<string, SectionJoin>();
  for (const j of joins) {
    if (j.verdict !== "UNIK") continue;
    const key = normHeadingKey(j.matchedBHeadings[0] ?? "");
    const prev = claimed.get(key);
    if (!prev) {
      claimed.set(key, j);
    } else if (prev.via === "prefix" && j.via === "exact") {
      prev.verdict = "FLERTYDIG";
      claimed.set(key, j);
    } else {
      j.verdict = "FLERTYDIG";
    }
  }
  const claimedBy = new Map<string, string>();
  for (const [key, j] of claimed) claimedBy.set(key, j.aId);
  return { joins, claimedBy };
}
