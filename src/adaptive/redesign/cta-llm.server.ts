// Språk-universella CTA-lagret (ägarbeslut 2026-07-14: "alla möjliga språk").
//
// Den delade deterministiska vokabulären (shared/intent.ts) är GOLVET: EN+SV
// minerat + ~30 kurerade storspråk — gratis, offline, samma i webbläsaren.
// Detta är TAKET: kandidater som golvet inte kände igen skickas i EN batch
// till den befintliga LLM-etiketteraren (labeler.server.ts — "any language",
// samma modell/kontrakt som crawler-inventoriet), och rollen acquisition
// mappas till conversion med samma konfidensgolv som resolveRole använder.
//
// Fail-open åt det försiktiga hållet: utan ANTHROPIC_API_KEY (eller vid
// API-fel) returnerar etiketteraren null och golvet står ensamt — exakt som
// crawler-vägen. Etiketteraren är injicerbar (samma DI-mönster som
// generateRedesign) så mappningen kan enhetstestas utan nätverk.

import { labelTexts, type CtaLabel } from "../labeler.server";
import { LLM_CONFIDENCE_FLOOR } from "../crawler-inventory";

import type { CtaCandidate } from "./extract";
import type { RedesignContentModel } from "./context";

const MAX_LLM_CANDIDATES = 40; // etiketterarens batchtak — over-fold först

/** Lägg LLM-klassade konverterings-CTA:er (vilket språk som helst) till
 *  innehållsmodellen. Muterar content.ctas; returnerar antalet tillagda. */
export async function addLlmCtas(
  content: RedesignContentModel,
  candidates: CtaCandidate[],
  label: typeof labelTexts = labelTexts,
): Promise<number> {
  const known = new Set(content.ctas.map((c) => c.text.toLowerCase()));
  const unknowns = candidates
    .filter(
      (c) =>
        !known.has(c.text.toLowerCase()) &&
        !c.samePageAnchor && // flikar/TOC är navigation oavsett språk
        c.intent === "unknown", // golvet har redan dömt allt annat
    )
    .sort((a, b) => Number(b.aboveFold) - Number(a.aboveFold))
    .slice(0, MAX_LLM_CANDIDATES);
  if (unknowns.length === 0) return 0;

  const labels = await label(unknowns.map((c) => ({ text: c.text, href: c.href })));
  if (!labels) return 0; // ingen nyckel / API-fel → golvet står ensamt

  let added = 0;
  unknowns.forEach((c, i) => {
    const l: CtaLabel | null = labels[i] ?? null;
    // Samma golv som resolveRole: under LLM_CONFIDENCE_FLOOR litar vi inte på
    // omdömet nog för att låta det påverka brief/hit-test.
    if (l && l.role === "acquisition" && l.confidence >= LLM_CONFIDENCE_FLOOR) {
      content.ctas.push({ text: c.text, intent: "conversion", aboveFold: c.aboveFold });
      added++;
    }
  });
  return added;
}
