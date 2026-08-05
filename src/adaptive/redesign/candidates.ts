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

import type { RedesignContentModel } from "./context";
import type { RedesignOp } from "./generate";

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

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Beteende-termen för en kandidat förankrad i sektion `sectionId`. 0 när
 *  sätet inte matas eller sektionen saknar data — då är katalogen byte-
 *  identisk med den beteende-blinda. */
function behaviorTerm(behavior: BehaviorInput | undefined, sectionId: string): number {
  const w = behavior?.sectionWeight?.[sectionId];
  if (typeof w !== "number" || !Number.isFinite(w)) return 0;
  return (behavior?.gain ?? BEHAVIOR_GAIN) * clamp01(w);
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
): Candidate[] {
  const out: Candidate[] = [];
  const sectionIds = new Set(content.sections.map((s) => s.id));

  // Flytt-kandidater: bevisbärande sektioner under folden. Hjälten är aldrig
  // ett flyttmål, och sektioner ovanför folden har inget att vinna.
  for (const s of content.sections) {
    if (s.type === "hero" || s.aboveFold) continue;
    const typeWeight = PROOF_TYPE_WEIGHT[s.type] ?? 0;
    const trustBonus = s.containsTrustSignals ? 1 : 0;
    if (typeWeight + trustBonus <= 0) continue;
    if (!s.heading) continue;
    out.push({
      id: `mv-${s.id}`,
      kind: "move_up",
      targetId: s.id,
      detail: "",
      score: typeWeight + trustBonus + Math.min(s.position, 8) * 0.05 + behaviorTerm(behavior, s.id),
      basis: `${s.type}${s.containsTrustSignals ? " [proof]" : ""} below the fold (position ${s.position}): "${s.heading.slice(0, 60)}"`,
    });
  }

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

  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Kandidat → RedesignOp (verify-kedjans språk). `why` bär väljarens (eller
 *  golvets) motivering — den blir ägar-/rapporttexten. */
export function candidateToOp(c: Candidate, why: string): RedesignOp {
  return c.kind === "move_up"
    ? { op: "move_up", targetId: c.targetId, detail: "Move this section higher on the page", why }
    : { op: "insert_snippet", targetId: "hero", detail: c.detail, why };
}

/** Golvets motivering när LLM-väljaren inte svarat — ärligt märkt som
 *  regelvald, aldrig som modellens omdöme. */
export function floorWhy(c: Candidate): string {
  return `Rule-selected top candidate (deterministic floor): ${c.basis}.`;
}
