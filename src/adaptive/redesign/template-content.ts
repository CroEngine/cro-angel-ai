// Mall-SNITTET (mall-nivå-generering, glutenforum-fyndet 2026-07-26). PURE.
//
// En mall-variant ("/blogg/*") serveras på ALLA mallens sidor med samma
// rubrik-lokatorer — så en op får BARA låsa mot sektioner vars rubriker finns
// på varje samplat exemplar (verifierat i skördade besökar-DOM:ar: bloggmallen
// delar "Vanliga frågor" och "Kommentera" medan h1/hero är sid-unika).
//
// Snittet är den deterministiska grinden som gör mallregeln (templateOf — dum
// med flit) säker: blandade layouter under samma prefix ger ett tomt/tunt
// snitt ⇒ liten eller ingen designyta, ärligt — aldrig en op mot något som
// bara finns på en av sidorna. Delas av detect (briefen), nattloopen
// (design-kontexten) och verify (lokatorer + exemplar-bekräftelsepassen).

import type { RedesignContentModel } from "./context";

const norm = (h: string) => h.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Rubriker som finns i ALLA modellerna (normaliserad jämförelse) — mall-
 * snittet. Hero ingår aldrig: h1 är artikelns egen titel, per definition
 * sid-unik i en mall. Originalcasing tas från första modellen (läsbara
 * briefs + exakta lokatorer). Ren; tom lista när inget delas.
 */
export function sharedTemplateHeadings(models: RedesignContentModel[]): string[] {
  if (models.length === 0) return [];
  const sets = models.map(
    (m) =>
      new Set(
        m.sections.filter((s) => s.type !== "hero" && s.heading).map((s) => norm(s.heading)),
      ),
  );
  const out: string[] = [];
  for (const s of models[0].sections) {
    if (s.type === "hero" || !s.heading) continue;
    const n = norm(s.heading);
    if (sets.every((set) => set.has(n)) && !out.some((o) => norm(o) === n)) out.push(s.heading);
  }
  return out;
}

/**
 * Filtrera en innehållsmodell till mallens designyta: BARA sektioner vars
 * rubrik ligger i snittet får bli op-mål (validateOps kräver att targetId
 * finns bland sections — filtret ÄR grinden). Hero-SEKTIONEN tas bort som mål
 * (sid-unik rubrik ⇒ lokatorn hade fallit på nästa exemplar), men `hero`-
 * fältet behålls som kontext åt briefen. Ren; muterar inte input.
 */
export function filterToTemplateSections(
  content: RedesignContentModel,
  shared: string[],
): RedesignContentModel {
  const keep = new Set(shared.map(norm));
  return {
    ...content,
    sections: content.sections.filter((s) => s.heading && keep.has(norm(s.heading))),
  };
}
