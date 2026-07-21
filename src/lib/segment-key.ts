// Segmentnyckeln — EN modul för bygge, parsning och matchning (task #89,
// återanvändnings-auditens NOW-punkt 2). Nyckelformatet är systemets lingua
// franca: `kanal·enhet·land·ny/återkommande`, grov→fin, och talas av
// dashboard-rollupen (aggregate.ts), detektorn (earned.ts), serve-vägen
// (serve.ts), auto-genereringen och dashboarden. Innan den här modulen bar
// varje konsument sin egen kopia av token/split/join/prefix-semantiken —
// en glidning här hade tyst brutit matchningen mellan lagren.
//
// Tokens är DATA, inte UI: "okänd"/"ny"/"återkommande" ligger lagrade i
// variant-nycklar i produktion och får ALDRIG bytas eller översättas här —
// engelskan bor uteslutande i visningslagret (overview-panelens enLabel).
// Löv-modul: inga imports, ren, delbar av script och app.

/** Dimensionsseparatorn. Aldrig del av en token. */
export const SEG_SEP = "·";

/** Lagrade specialtokens (data, inte UI — se filhuvudet). */
export const UNKNOWN_TOKEN = "okänd";
export const RETURNING_TOKEN = "återkommande";
export const NEW_TOKEN = "ny";

/** En dimensions token — null/tom blir "okänd" (ärlig egen hink, aldrig
 *  påhittad dimension). */
export function segToken(v: string | null | undefined): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s || UNKNOWN_TOKEN;
}

/** Fjärde dimensionen: ny/återkommande. */
export function returningToken(isReturning: boolean): string {
  return isReturning ? RETURNING_TOKEN : NEW_TOKEN;
}

/** Parse: nyckel → dimensioner. */
export function segmentDims(key: string): string[] {
  return key.split(SEG_SEP);
}

/** Bygg: dimensioner → nyckel. Tokens antas redan vara segToken-ade. */
export function segmentKeyOf(dims: readonly string[]): string {
  return dims.join(SEG_SEP);
}

/** Nyckelns djup (antal dimensioner). */
export function segmentDepth(key: string): number {
  return segmentDims(key).length;
}

/** Den FULLA besökarnyckeln — exakt de fyra dimensioner decide-kontexten bär,
 *  i rollupens ordning. Serve-vägen och dashboarden måste bygga identiskt. */
export function fullSegmentKey(
  channel: string | null | undefined,
  device: string | null | undefined,
  country: string | null | undefined,
  isReturning: boolean,
): string {
  return segmentKeyOf([
    segToken(channel),
    segToken(device),
    segToken(country),
    returningToken(isReturning),
  ]);
}

/** Dimension-vis prefix-match på redan splittade dims — "go" matchar aldrig
 *  "google"; varje token jämförs hel. */
export function isDimsPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  return prefix.length <= full.length && prefix.every((t, i) => t === full[i]);
}

/** Dimension-vis prefix-match nyckel-mot-nyckel. Tom prefix-nyckel matchar
 *  ingenting (en variant utan nyckel får aldrig servera brett). */
export function isSegmentPrefix(prefix: string, full: string): boolean {
  if (!prefix) return false;
  return isDimsPrefix(segmentDims(prefix), segmentDims(full));
}

/** Föräldranyckeln (en dimension grövre); null på djup 1. */
export function parentSegmentKey(key: string): string | null {
  const dims = segmentDims(key);
  return dims.length <= 1 ? null : segmentKeyOf(dims.slice(0, -1));
}

/** Hör två nycklar till samma gren — samma nyckel, under den, eller över den?
 *  (Dashboardens scoping: valet visar sina egna, sina finare och den grövre
 *  variant som faktiskt serverar hit via lånad styrka.) */
export function segmentKeysRelated(a: string, b: string): boolean {
  return a === b || isSegmentPrefix(a, b) || isSegmentPrefix(b, a);
}
