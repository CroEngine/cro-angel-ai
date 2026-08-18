// Startsidans "ärliga siffror" — den RENA delen (ägarbeslut 2026-08-18:
// startsidan säljer med äkta statistik, aldrig påhittad — påhittade
// kundresultat är vilseledande marknadsföring och dödar pitchen "motorn som
// aldrig hittar på" i första säljsamtalet).
//
// Live-siffrorna aggregeras över RIKTIGA rader (varianter, förhandsvisnings-
// jobb) och formas här till tiles. Regeln nollor döljs: en rad som "0 proven
// winners" är sann men säljer emot sidan — att UTELÄMNA en nolla är ärligt,
// att höja den är det inte. Formningen är ren och testad; DB-hämtningen bor
// i stats.server.ts.

/** Labbsajter räknas ALDRIG in i publika siffror — labbet är inte en kund,
 *  och dess syntetiska varianter skulle blåsa upp varje aggregat. */
export const LAB_SITES = ["synthetic-lab"];

export interface PublicStats {
  /** Varianter i status 'verified' — byggda, grindade, väntar på ägarknappen. */
  awaitingApproval: number;
  /** Varianter i status 'serving' — mäts mot kontrollgrupp just nu. */
  measuringNow: number;
  /** Varianter i status 'winner' — bevisade vinster. */
  provenWinners: number;
  /** Förhandsvisningsjobb med status 'ok' — byggda exempel på prospekts sidor. */
  previewsBuilt: number;
  /** Senaste variantlivscykel-händelsen (max updated_at) — "motorn lever". */
  lastEngineActionAt: string | null;
}

export interface StatTile {
  value: string;
  label: string;
}

/** En rad per siffra > 0, i säljordning. null (fetch föll) ⇒ tom lista —
 *  sektionen renderar då bara de statiska motorfakta-tilesen. */
export function statTiles(stats: PublicStats | null): StatTile[] {
  if (!stats) return [];
  const tiles: StatTile[] = [];
  if (stats.provenWinners > 0) {
    tiles.push({
      value: String(stats.provenWinners),
      label: stats.provenWinners === 1 ? "proven winner" : "proven winners",
    });
  }
  if (stats.awaitingApproval > 0) {
    tiles.push({
      value: String(stats.awaitingApproval),
      label:
        stats.awaitingApproval === 1
          ? "proposal awaiting an owner's click"
          : "proposals awaiting an owner's click",
    });
  }
  if (stats.measuringNow > 0) {
    tiles.push({
      value: String(stats.measuringNow),
      label:
        stats.measuringNow === 1
          ? "change measuring against control right now"
          : "changes measuring against control right now",
    });
  }
  if (stats.previewsBuilt > 0) {
    tiles.push({
      value: String(stats.previewsBuilt),
      label:
        stats.previewsBuilt === 1
          ? "free example built on a real site"
          : "free examples built on real sites",
    });
  }
  return tiles;
}
