// Sidmalls-regeln — EN modul för mall-nyckelns bygge och matchning (mall-nivå-
// generering, glutenforum-fyndet 2026-07-26). Samma disciplin som segment-key.ts:
// detektorn (earned.ts), genereringen (nattloopen) och serve-vägen (serve.ts +
// persistence) talar exakt samma mallspråk, per konstruktion.
//
// Varför mallar: innehållssajter har långsvansad trafik — sajtnivån kan bära
// 230 besök i ett segment medan bästa enskilda SIDA har 34, och designer
// genereras per sida. Sidor under samma första path-segment ("/blogg/…") delar
// i praktiken layout och mall-stabila sektioner ("Vanliga frågor", "Kommentera"
// — verifierat i skördade besökar-DOM:ar). En mall-variant designas mot det
// DELADE, verifieras på flera exemplar och serveras på alla mallens sidor.
//
// Regeln är medvetet DUM och deterministisk: mall = "/" + första segmentet +
// "/*". Skyddet mot blandade layouter under samma prefix är INTE regeln utan
// kedjan efter den: mall-snittet (bara rubriker som finns på ALLA samplade
// sidor får bli op-mål) + pixelverifiering på varje samplat exemplar + den
// fail-closed appliern per sida i drift.
// Löv-modul: inga imports, ren, delbar av script och app.

/** Mall-mönstrets suffix. Ett mönster är ett vanligt path-VÄRDE i angel_variants
 *  ("/blogg/*") — inga schemaändringar, unika index funkar orört. */
export const TEMPLATE_SUFFIX = "/*";

/**
 * Mallen en konkret sida tillhör — eller null när sidan är sin egen mall:
 * startsidan "/", förstasegments-sidor ("/blogg" är listningen, inte artikeln),
 * redan-mönster och ogiltiga paths. Query/hash strippas, trailing slash
 * normaliseras, så "/blogg/x?utm=1" och "/blogg/x/" ger samma mall.
 */
export function templateOf(path: string): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "");
  if (clean.endsWith(TEMPLATE_SUFFIX)) return null; // redan ett mönster
  const segs = clean.split("/").filter(Boolean);
  if (segs.length < 2) return null; // "/", "/blogg" → egna sidor
  const first = segs[0];
  if (first.includes("*")) return null;
  return `/${first}${TEMPLATE_SUFFIX}`;
}

/** Är värdet ett mall-mönster (till skillnad från en konkret sida)? */
export function isTemplatePattern(p: string): boolean {
  return (
    typeof p === "string" &&
    p.startsWith("/") &&
    p.endsWith(TEMPLATE_SUFFIX) &&
    p.length > TEMPLATE_SUFFIX.length + 1
  );
}

/** Matchar en KONKRET sida mot ett mall-mönster — via templateOf, så matchningen
 *  och bygget aldrig kan glida isär. */
export function templateMatches(pattern: string, path: string): boolean {
  return isTemplatePattern(pattern) && templateOf(path) === pattern;
}
