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

/** Generera hela katalogen av lagliga drag ur innehållsmodellen. Ren funktion
 *  utan DOM — browser-förprovningen (probe) annoterar/filtrerar efteråt.
 *  Sorterad: högst poäng först (golvets val = första posten). */
export function generateCandidates(content: RedesignContentModel): Candidate[] {
  const out: Candidate[] = [];

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
      score: typeWeight + trustBonus + Math.min(s.position, 8) * 0.05,
      basis: `${s.type}${s.containsTrustSignals ? " [proof]" : ""} under folden (position ${s.position}): "${s.heading.slice(0, 60)}"`,
    });
  }

  // Insert-kandidater: ordagranna trust-rader lyfta till under hjälten.
  // Dedup på normaliserad text — samma rad ska inte stå två gånger i menyn.
  const seen = new Set<string>();
  content.trustSignals.forEach((t, i) => {
    const text = t.text.trim().slice(0, MAX_DETAIL_LEN);
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
      score: weight - (t.aboveFold ? 1 : 0),
      basis: `${t.type}${t.aboveFold ? " (redan ovanför folden)" : ""}: "${text}"`,
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
      score: (typeWeight || 1.5) * 0.6,
      basis: `rubriken för ${s.type}-sektionen: "${text}"`,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** Kandidat → RedesignOp (verify-kedjans språk). `why` bär väljarens (eller
 *  golvets) motivering — den blir ägar-/rapporttexten. */
export function candidateToOp(c: Candidate, why: string): RedesignOp {
  return c.kind === "move_up"
    ? { op: "move_up", targetId: c.targetId, detail: "Lyft bevissektionen högre på sidan", why }
    : { op: "insert_snippet", targetId: "hero", detail: c.detail, why };
}

/** Golvets motivering när LLM-väljaren inte svarat — ärligt märkt som
 *  regelvald, aldrig som modellens omdöme. */
export function floorWhy(c: Candidate): string {
  return `Regelvald toppkandidat (deterministiskt golv): ${c.basis}. Socialt bevis ska synas där besökaren landar.`;
}
