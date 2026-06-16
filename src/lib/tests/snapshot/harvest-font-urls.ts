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
  | { kind: "embedded"; original: string }
  | { kind: "absolute"; original: string; resolved: string }
  | {
      kind: "relative-resolved";
      original: string;
      resolved: string;
      base: string;
    }
  | {
      kind: "relative-unresolvable";
      original: string;
      reason: "no-base" | "invalid-base";
    };

export interface CssPart {
  /** Decoded (post-QP) part body. */
  css: string;
  /** Value of the part's Content-Location header, if any. CSS resolves
   *  relative URLs against the stylesheet's own URL — i MHTML-replay är
   *  det partens Content-Location. */
  contentLocation: string | undefined;
}

/**
 * Enda källan till MHTML → CSS-part-partitionering. Returnerar varje text/css
 * eller text/html-part som innehåller @font-face, med QP-avkodad body och
 * partens Content-Location.
 */
export function iterateCssParts(mhtml: string): CssPart[] {
  const parsed = parseMhtml(mhtml);
  const out: CssPart[] = [];
  for (const part of parsed.parts) {
    const ct = part.headers["content-type"] || "";
    if (!/^text\/(css|html)/i.test(ct)) continue;
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    const decoded = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    if (!/@font-face/i.test(decoded)) continue;
    out.push({
      css: decoded,
      contentLocation: part.headers["content-location"] || undefined,
    });
  }
  return out;
}

// ---------------- @font-face-scopad URL-tokenizer ------------------------

const FONT_FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/gi;
const SRC_DECL_GLOBAL_RE = /src\s*:\s*([^;}]+)/gi;

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
): NormalizedFontUrl {
  // Hink 1 — redan inlinead / cid-rewriten.
  if (/^data:/i.test(original) || /^cid:/i.test(original)) {
    return { kind: "embedded", original };
  }
  // Hink 2 — http(s)-absolut, ingen base behövs.
  if (/^https?:\/\//i.test(original)) {
    return { kind: "absolute", original, resolved: original };
  }
  // Hink 3 (eller 4 om base saknas) — protokoll-relativ + path-relativ.
  if (!base) {
    return {
      kind: "relative-unresolvable",
      original,
      reason: "no-base",
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
    };
  }
  return { kind: "relative-resolved", original, resolved, base };
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
  for (const faceMatch of css.matchAll(FONT_FACE_BLOCK_RE)) {
    const faceBody = faceMatch[1];
    for (const srcMatch of faceBody.matchAll(SRC_DECL_GLOBAL_RE)) {
      const srcValue = srcMatch[1];
      for (const token of tokensFromSrcValue(srcValue)) {
        out.push(classify(token, contentLocation));
      }
    }
  }
  return out;
}
