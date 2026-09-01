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

/** Scroll-lås-upplåsningen (stardream-fyndet 2026-09-01): sidor frysta mitt i
 *  en modal/backdrop (cookie-dialoger är vanligast) bär skroll-låset i kopian
 *  — body{overflow:hidden;height:<viewport>} (Angular Material, body-scroll-
 *  lock m.fl.) eller iOS-mönstret body{position:fixed}. I scenen blir kopian
 *  då oskrollbar och naturhöjdsmätningen ser bara 844px. Overriden häver
 *  BARA klippningen och fix-låset (overflow + position) — höjder och övrig
 *  layout lämnas orörda, så sidor med äkta inre skrollcontainrar degraderar
 *  till samma inre skroll som i dag. Endast scenens väg (?stage=1). */
const UNLOCK_STYLE =
  "<style data-agritm-stage-unlock>html,body{overflow:visible !important}body{position:static !important}</style>";

export function unlockRootScroll(html: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${UNLOCK_STYLE}</head>`);
  if (/<body\b[^>]*>/i.test(html)) return html.replace(/(<body\b[^>]*>)/i, `$1${UNLOCK_STYLE}`);
  return UNLOCK_STYLE + html;
}
