// Scenens vh-neutralisering (granskningsfynd 2026-08-31, MAJOR): i den
// uppslukande vyn renderas kopian i NATURHÖJD — ramens viewport ÄR hela
// dokumenthöjden, så vertikala viewport-enheter tappar sitt ankare (en
// 100vh-hjälte blir hela kopians höjd, och höjdmätningen jagar sin egen
// svans). Serve-tids-transformen skriver om v-höjder till px vid
// frysviewporten 390×844 (1vh ≡ 8.44px) — exakt den viewport varianten
// grindades i, så kopian ser ut som när den verifierades.
//
// Gäller BARA scenens serveringsväg (?stage=1) — de råa kopiorna,
// nattgrindarna och rapporten rörs inte.
//
// Base64-säkerheten: delimiter-vakten [\s:,(>] framför talet gör att
// "12vh"-sekvenser inuti data-URI:ers base64 (tecken A–Z a–z 0–9 + / =)
// aldrig matchar — inget av base64-alfabetet finns i vaktmängden.

const FREEZE_VH_PX = 844 / 100;

const V_HEIGHT = /([\s:,(>])(\d+(?:\.\d+)?)(vh|svh|dvh|lvh)\b/g;

function rewrite(css: string): string {
  return css.replace(
    V_HEIGHT,
    (_m, pre: string, num: string, _unit: string) =>
      `${pre}${(parseFloat(num) * FREEZE_VH_PX).toFixed(2)}px`,
  );
}

/** Skriver om v-höjder i <style>-block och style-attribut — aldrig i övrig
 *  markup (rubriker/brödtext som råkar innehålla "10vh" lämnas orörda). */
export function neutralizeViewportUnits(html: string): string {
  let out = html.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open: string, css: string, close: string) => `${open}${rewrite(css)}${close}`,
  );
  out = out.replace(
    /(\sstyle=")([^"]*)(")/gi,
    (_m, open: string, css: string, close: string) => `${open}${rewrite(css)}${close}`,
  );
  return out;
}
