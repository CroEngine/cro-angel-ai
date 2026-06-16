// Commit 1 — Delade primitiver för P/M-harmoniseringen.
//
// Två exports + en typ. Båda P (extractFontFaceDiagnostics) och M
// (embedMhtmlFonts) ska i commit 2 iterera via SAMMA `iterateCssParts` och
// per part anropa SAMMA `harvestFontUrls(css, contentLocation)`. Input-equality
// by construction — inte by-convention att två kodvägar råkar anropa samma
// rena funktion.
//
// Universumet partitioneras explicit och uttömmande i fyra hinkar:
//   1 embedded             — data:/cid: (ingen fetch, redan inlinead)
//   2 absolute             — https?:// (ingen base behövs)
//   3 relative-resolved    — relativ inkl. //host/x, löst mot Content-Location
//   4 relative-unresolvable — relativ utan giltig base (no-base / invalid-base)
//
// Invariant P==M opererar över hink2 ∪ hink3, dedupad på `resolved`.
// Hink 1 räknas separat. Hink 4 → receipt + assert.
//
// Scope: harvestern parsar @font-face-block och extraherar ENDAST deras
// src-deskriptorvärden. url() i background-image/@import är inte fonter.

import { parseMhtml, qpDecode } from "./mhtml-fonts.server";

export type NormalizedFontUrl =
  | { kind: "embedded"; original: string; faceIndex: number }
  | { kind: "absolute"; original: string; resolved: string; faceIndex: number }
  | {
      kind: "relative-resolved";
      original: string;
      resolved: string;
      base: string;
      faceIndex: number;
    }
  | {
      kind: "relative-unresolvable";
      original: string;
      reason: "no-base" | "invalid-base";
      faceIndex: number;
    };

export interface CssPart {
  /** Decoded (post-QP) part body. */
  css: string;
  /** Value of the part's Content-Location header, if any. CSS resolves
   *  relative URLs against the stylesheet's own URL — i MHTML-replay är
   *  det partens Content-Location. */
  contentLocation: string | undefined;
  /** Index in the parsed MHTML's parts array — back-pointer för M-sidans
   *  CSS-rewrite, exponerat så M kan iterera via SAMMA primitiv som P
   *  utan att shadowa parts-loopen. */
  partIndex: number;
  /** Original Content-Transfer-Encoding för part-body (krävs vid re-encode
   *  efter CSS-rewrite). */
  encoding: string;
}

/**
 * Enda källan till MHTML → CSS-part-partitionering. Returnerar varje text/css
 * eller text/html-part som innehåller @font-face, med QP-avkodad body,
 * partens Content-Location, samt partens index/encoding (för M-rewrite).
 */
export function iterateCssParts(mhtml: string): CssPart[] {
  const parsed = parseMhtml(mhtml);
  const out: CssPart[] = [];
  for (let i = 0; i < parsed.parts.length; i++) {
    const part = parsed.parts[i];
    const ct = part.headers["content-type"] || "";
    if (!/^text\/(css|html)/i.test(ct)) continue;
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    const decoded = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    if (!/@font-face/i.test(decoded)) continue;
    out.push({
      css: decoded,
      contentLocation: part.headers["content-location"] || undefined,
      partIndex: i,
      encoding: enc,
    });
  }
  return out;
}

// ---------------- @font-face-scopad URL-tokenizer ------------------------

const FONT_FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/gi;

// url(...) tokens, three accepted forms:
//   url("...")     double-quoted; content = [^"]*
//   url('...')     single-quoted; content = [^']*
//   url(unquoted)  unquoted;     content = [^)\s]+  (allows : , = / ; in data:)
// `local()`, `format()`, `tech()` matchar inte `url\(` och ignoreras därmed.
const URL_TOKEN_RE =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;

function tokensFromSrcValue(srcValue: string): string[] {
  const out: string[] = [];
  for (const m of srcValue.matchAll(URL_TOKEN_RE)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (raw == null) continue;
    out.push(raw);
  }
  return out;
}

function classify(
  original: string,
  base: string | undefined,
  faceIndex: number,
): NormalizedFontUrl {
  // Hink 1 — redan inlinead / cid-rewriten.
  if (/^data:/i.test(original) || /^cid:/i.test(original)) {
    return { kind: "embedded", original, faceIndex };
  }
  // Hink 2 — http(s)-absolut, ingen base behövs.
  if (/^https?:\/\//i.test(original)) {
    return { kind: "absolute", original, resolved: original, faceIndex };
  }
  // Hink 3 (eller 4 om base saknas) — protokoll-relativ + path-relativ.
  if (!base) {
    return {
      kind: "relative-unresolvable",
      original,
      reason: "no-base",
      faceIndex,
    };
  }
  let resolved: string;
  try {
    resolved = new URL(original, base).href;
  } catch {
    return {
      kind: "relative-unresolvable",
      original,
      reason: "invalid-base",
      faceIndex,
    };
  }
  return { kind: "relative-resolved", original, resolved, base, faceIndex };
}

/**
 * @font-face-scopad. För given CSS-part-text + dess Content-Location,
 * returnera klassificerade url()-tokens från @font-face/src-deskriptorer
 * i harvest-ordning (face → src → url).
 *
 * Ren funktion: output är en deterministisk funktion av (css, contentLocation).
 */
export function harvestFontUrls(
  css: string,
  contentLocation: string | undefined,
): NormalizedFontUrl[] {
  const out: NormalizedFontUrl[] = [];
  let faceIndex = 0;
  for (const faceMatch of css.matchAll(FONT_FACE_BLOCK_RE)) {
    const faceBody = faceMatch[1];
    // @font-face descriptors per spec endast har url() inuti src: — så
    // tokenisera direkt på face-body. Att gå via en separat
    // `src: ([^;}]+)`-extraktion bryter på data:-URLs som innehåller `;`
    // (t.ex. `data:font/woff2;base64,...`).
    for (const token of tokensFromSrcValue(faceBody)) {
      out.push(classify(token, contentLocation, faceIndex));
    }
    faceIndex++;
  }
  return out;
}

// ---------------- harvestAllFontUrls (commit 3) --------------------------
//
// EN producent. Både P (extractFontFaceDiagnostics) och M (collectEmbedTargets
// + embedMhtmlFonts) ska konsumera output härifrån. Decorerar varje URL med
// partens partIndex (från CssPart.partIndex — INTE en lokal räknare) och
// partens contentLocation, vilket M behöver för CSS-rewrite-bokföring och
// receipt-observability per part.

export type HarvestedFontUrl = NormalizedFontUrl & {
  partIndex: number;
  contentLocation: string | undefined;
};

export function harvestAllFontUrls(mhtml: string): HarvestedFontUrl[] {
  const out: HarvestedFontUrl[] = [];
  for (const part of iterateCssParts(mhtml)) {
    for (const u of harvestFontUrls(part.css, part.contentLocation)) {
      out.push({
        ...u,
        partIndex: part.partIndex,
        contentLocation: part.contentLocation,
      } as HarvestedFontUrl);
    }
  }
  return out;
}
