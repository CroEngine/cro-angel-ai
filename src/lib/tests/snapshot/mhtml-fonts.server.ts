// Post-capture MHTML font embedder (A2).
//
// Problem: Chromium's Page.captureSnapshot does NOT inline cross-origin font
// binaries into MHTML — only the @font-face CSS rules are preserved, with
// their original http(s):// src. At replay time harness.server.ts aborts all
// non-file:// network → Chromium falls back to OS fonts → glyph metrics
// differ → element bboxes (area, yBand) drift run-to-run vs the live capture.
//
// Fix: after captureSnapshot, scan each CSS part of the MHTML, find every
// `src: url(http(s)://...)` pointing at a font file, fetch the binary,
// append it as a new MHTML part with `Content-Location: cid:font-N@snapshot`,
// and rewrite the CSS to `url(cid:font-N@snapshot)`. Chromium resolves cid:
// internally during MHTML replay (Steg 0 confirmed: context.route() never
// sees these requests).
//
// Why cid: and not data:: the CSS part is quoted-printable encoded; stuffing
// a large base64 blob into a QP region requires re-encoding it as QP
// (= → =3D, soft line breaks at 76 chars). cid: avoids the entire trap —
// the binary lives in its own clean base64 part, and our injected url(cid:..)
// replacement is short ASCII that fits inside the existing QP body without
// re-encoding.
//
// Success metric is form-agnostic: externalFontSrcCount === 0 after rewrite.
// That invariant holds for both cid: and data: embedding, and for any host.
//
// Restrisk (documented in plan.md): we embed every font URL we find in
// @font-face rules, regardless of whether the unicode-range subset is
// actually used. Trade-off vs the alternative (filter via document.fonts):
// 36 woff2 files for hibob ≈ 200-500 KB, acceptable; correctness > size.

import { randomUUID } from "node:crypto";
import {
  iterateCssParts,
  harvestFontUrls,
  harvestAllFontUrls,
  type HarvestedFontUrl,
} from "./harvest-font-urls";

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf|eot)(?:\?[^)'"\s]*)?$/i;

// Match `url(...)` references to font files. Allows single/double/no quotes.
// We do this AFTER QP-decoding the part body, so soft line breaks are gone.
const FONT_URL_RE =
  /url\(\s*(['"]?)(https?:\/\/[^)'"\s]+?\.(?:woff2|woff|ttf|otf|eot)(?:\?[^)'"\s]*)?)\1\s*\)/gi;

const MIME_BY_EXT: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
};

// ---------------------------------------------------------------- QP codec --

export function qpDecode(input: string): string {
  // 1) soft line breaks: `=\r?\n` -> ``
  const noSoft = input.replace(/=\r?\n/g, "");
  // 2) `=XX` hex escapes -> byte
  const bytes: number[] = [];
  for (let i = 0; i < noSoft.length; i++) {
    const c = noSoft.charCodeAt(i);
    if (c === 0x3d /* = */ && i + 2 < noSoft.length) {
      const hex = noSoft.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(c & 0xff);
  }
  return Buffer.from(bytes).toString("utf8");
}

function qpEncode(input: string): string {
  const out: string[] = [];
  const bytes = Buffer.from(input, "utf8");
  let lineLen = 0;
  const pushChunk = (chunk: string) => {
    if (lineLen + chunk.length > 75) {
      out.push("=\r\n");
      lineLen = 0;
    }
    out.push(chunk);
    lineLen += chunk.length;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a /* \n */) {
      out.push("\r\n");
      lineLen = 0;
      continue;
    }
    if (b === 0x0d /* \r */) {
      // Skip; the \n handler emits CRLF for us. Handles CRLF and lone CR.
      if (bytes[i + 1] !== 0x0a) {
        out.push("\r\n");
        lineLen = 0;
      }
      continue;
    }
    // QP safe: printable ASCII (33-126) except `=` (0x3D).
    if ((b >= 33 && b <= 60) || (b >= 62 && b <= 126)) {
      pushChunk(String.fromCharCode(b));
    } else if (b === 0x20 /* space */ || b === 0x09 /* tab */) {
      // Whitespace: safe unless at end of line. Easiest correctness: always escape.
      // But to keep diffs readable we leave bare; the original Chromium output
      // also leaves whitespace bare mid-line. End-of-line whitespace is rare here.
      pushChunk(String.fromCharCode(b));
    } else {
      const hex = b.toString(16).toUpperCase().padStart(2, "0");
      pushChunk(`=${hex}`);
    }
  }
  return out.join("");
}

// ------------------------------------------------------------ MHTML parser --

interface MhtmlPart {
  rawHeaders: string;
  headers: Record<string, string>;
  body: string;
}

interface ParsedMhtml {
  topHeaders: string;
  boundary: string;
  parts: MhtmlPart[];
  trailer: string; // bytes after final boundary (usually `--\r\n` already consumed)
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Headers may use folded continuation lines (next line starts with space/tab).
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const m = line.match(/^([!-9;-~]+)\s*:\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

export function parseMhtml(mhtml: string): ParsedMhtml {
  // Find top headers / first boundary delimiter.
  const headerEnd = mhtml.search(/\r?\n\r?\n/);
  if (headerEnd < 0) throw new Error("[mhtml-fonts] no top header block");
  const topHeaders = mhtml.slice(0, headerEnd);
  const boundaryMatch = topHeaders.match(/boundary="?([^";\r\n]+)"?/i);
  if (!boundaryMatch) throw new Error("[mhtml-fonts] no boundary in top headers");
  const boundary = boundaryMatch[1];
  const delim = `--${boundary}`;
  const closeDelim = `--${boundary}--`;

  // Split body into parts.
  const bodyStart = headerEnd + (mhtml[headerEnd] === "\r" ? 2 : 1) + 1;
  const body = mhtml.slice(bodyStart);
  // Split on delimiter; first chunk is preamble before first boundary.
  const chunks = body.split(delim);
  // chunks[0] = preamble (usually empty/whitespace), drop it.
  // Last chunk starts with `--` (the close delim suffix) or just trailer.
  const partChunks: string[] = [];
  let trailer = "";
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i];
    if (c.startsWith("--")) {
      // Close delimiter — everything after is epilogue.
      trailer = c;
      break;
    }
    partChunks.push(c);
  }

  const parts: MhtmlPart[] = partChunks.map((chunk) => {
    // Strip leading CRLF that follows the boundary line.
    const c = chunk.replace(/^\r?\n/, "");
    const hEnd = c.search(/\r?\n\r?\n/);
    if (hEnd < 0) {
      return { rawHeaders: c, headers: parseHeaders(c), body: "" };
    }
    const rawHeaders = c.slice(0, hEnd);
    const sepLen = c[hEnd] === "\r" ? 4 : 2;
    let bodyStr = c.slice(hEnd + sepLen);
    // Body ends with CRLF before the next boundary — trim ONE trailing newline.
    bodyStr = bodyStr.replace(/\r?\n$/, "");
    return { rawHeaders, headers: parseHeaders(rawHeaders), body: bodyStr };
  });

  // Detect the leading line ending used by the file so we can reassemble byte-faithfully.
  // Chromium's MHTML uses CRLF. We assume CRLF.
  void closeDelim;
  return { topHeaders, boundary, parts, trailer };
}

function serializeMhtml(p: ParsedMhtml): string {
  const delim = `--${p.boundary}`;
  const out: string[] = [];
  out.push(p.topHeaders);
  out.push("\r\n\r\n");
  for (const part of p.parts) {
    out.push(delim);
    out.push("\r\n");
    out.push(part.rawHeaders);
    out.push("\r\n\r\n");
    out.push(part.body);
    out.push("\r\n");
  }
  out.push(delim);
  out.push(p.trailer || "--\r\n");
  return out.join("");
}

// ------------------------------------------------------------- API ---------

/** Klass per URL-försök. Separat env_blocked-bucket undviker att proxy-deny
 *  blandas med äkta network-fel. skipped_dedup = förekomst nr ≥2 av samma URL. */
export type FontFetchOutcome =
  | "ok"
  | "http_error"
  | "empty_body"
  | "network_error"
  | "env_blocked"
  | "timeout"
  | "skipped_ext"
  | "skipped_dedup";

export interface FontFetchRecord {
  url: string;
  ext: string | null;
  occurrenceIndex: number;
  attempted: boolean;
  outcome: FontFetchOutcome;
  bytes: number;
  httpStatus?: number;
  error?: string;
  errorCode?: string;
  proxyDenyReason?: string;
  durationMs: number;
}

export interface ControlProbeResult {
  url: string;
  kind: "positive" | "negative";
  outcome: FontFetchOutcome;
  httpStatus?: number;
  bytes: number;
  error?: string;
  errorCode?: string;
  proxyDenyReason?: string;
  durationMs: number;
}

export interface FontEmbedResult {
  mhtml: string;
  /** Count of http(s):// font URLs still present in any CSS part AFTER rewrite. */
  externalFontSrcCount: number;
  /** Sampled (≤20, deduped) external font URLs still present after rewrite — the
   *  offenders behind externalFontSrcCount, so a font-embed-failed freeze names
   *  the URLs in its report instead of needing a re-freeze to diagnose. */
  unembeddedFontUrls: string[];
  /** Subset of unembeddedFontUrls the browser actually loaded (resource-timing) —
   *  the render-drift-relevant survivors. Empty when loadedFontUrls wasn't passed
   *  (then the A2 gate falls back to the full externalFontSrcCount). */
  unembeddedLoadedFontUrls: string[];
  embeddedFontCount: number;
  newBytes: number;
  fetchFailures: { url: string; error: string }[];
  fontUrlsSeen: string[];
  embeddedFamilies: string[];
  /** B2b: en record per harvest-förekomst. fetchRecords.length === totalHarvestedOccurrences. */
  fetchRecords: FontFetchRecord[];
  totalHarvestedOccurrences: number;
  controlProbes?: { positive: ControlProbeResult; negative: ControlProbeResult };
  /** Hink 4 — @font-face/src-relativa URLer som inte gick att resolvera mot
   *  partens Content-Location. Tom array = friskt; icke-tom = sajten har
   *  CSS-parts utan giltig base, och Chromium kommer fail-fetcha dem vid replay.
   *  Caller (t.ex. breadth-smoke) avgör om detta ska fälla sajtens test. */
  unresolvableRelativeUrls: Array<{
    original: string;
    reason: "no-base" | "invalid-base";
    partIndex: number;
  }>;
  /** Commit 4 — Per-hink token-occurrence-räknare. OBS: dessa är
   *  *token-occurrences*, INTE distinkta-på-resolved (replayUrls / urlToCid
   *  dedupar, dessa inte). För antal-familjer/fetcher-mål använd
   *  `embeddedFontCount` resp. `fetchRecords`/`fontUrlsSeen`. Här finns
   *  observability per hink: hur ofta varje klass uppträder i den råa CSS:en. */
  fontUrlSummary: {
    embedded: number;
    absolute: number;
    relativeResolved: number;
    unresolvable: Array<{
      original: string;
      reason: "no-base" | "invalid-base";
      partIndex: number;
    }>;
  };
}

// Hostar som ALDRIG får användas som negativ kontrollprobe — de är diagnostik-mål
// eller del av font-CDN-allowlistor, vilket gör utfallet cirkulärt.
const NEGATIVE_PROBE_DENYLIST = [
  /(^|\.)fonts\.gstatic\.com$/i,
  /(^|\.)fonts\.googleapis\.com$/i,
  /(^|\.)intercomcdn\.com$/i,
  /(^|\.)intercomassets\.com$/i,
  /(^|\.)stripe\.com$/i,
  /(^|\.)stripecdn\.com$/i,
  /(^|\.)vercel\.com$/i,
  /(^|\.)vercel-scripts\.com$/i,
  /(^|\.)typekit\.net$/i,
  /(^|\.)use\.typekit\.net$/i,
];

const PROXY_DENY_HEADERS = ["x-deny-reason", "x-forwarded-deny", "x-proxy-block"] as const;
const PROXY_ERROR_PATTERNS =
  /(EPROXYAUTHREQUIRED|tunneling socket could not be established|proxy.*denied|blocked by proxy)/i;

interface ClassifiedFetch {
  outcome: FontFetchOutcome;
  bytes: number;
  httpStatus?: number;
  error?: string;
  errorCode?: string;
  proxyDenyReason?: string;
  /** Populated only on outcome === "ok" — undvik dubbel-fetch i embed-pass. */
  body?: Buffer;
}


async function classifiedFetch(
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<ClassifiedFetch> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": userAgent, Accept: "*/*" },
    });
    // Proxy-deny via header
    for (const h of PROXY_DENY_HEADERS) {
      const v = res.headers.get(h);
      if (v) {
        return {
          outcome: "env_blocked",
          bytes: 0,
          httpStatus: res.status,
          proxyDenyReason: `${h}: ${v}`,
          error: `proxy denied via header ${h}`,
        };
      }
    }
    // 403 via en proxy som annars inte skickar deny-header
    if (res.status === 403 && res.headers.get("via")) {
      return {
        outcome: "env_blocked",
        bytes: 0,
        httpStatus: 403,
        proxyDenyReason: `403 via ${res.headers.get("via")}`,
        error: "403 from proxy",
      };
    }
    if (!res.ok) {
      return { outcome: "http_error", bytes: 0, httpStatus: res.status, error: `HTTP ${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      return { outcome: "empty_body", bytes: 0, httpStatus: res.status, error: "empty body" };
    }
    return { outcome: "ok", bytes: buf.byteLength, httpStatus: res.status, body: buf };

  } catch (e) {
    const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string } };
    const msg = err?.message ?? String(e);
    const code = err?.code ?? err?.cause?.code;
    if (err?.name === "AbortError") {
      return { outcome: "timeout", bytes: 0, error: "timeout", errorCode: code };
    }
    if (PROXY_ERROR_PATTERNS.test(msg) || (code && PROXY_ERROR_PATTERNS.test(code))) {
      return {
        outcome: "env_blocked",
        bytes: 0,
        error: msg,
        errorCode: code,
        proxyDenyReason: `error pattern: ${code ?? msg}`,
      };
    }
    return { outcome: "network_error", bytes: 0, error: msg, errorCode: code };
  } finally {
    clearTimeout(timer);
  }
}

async function runControlProbe(
  url: string,
  kind: "positive" | "negative",
  timeoutMs: number,
  userAgent: string,
): Promise<ControlProbeResult> {
  const t0 = performance.now();
  const r = await classifiedFetch(url, timeoutMs, userAgent);
  return {
    url,
    kind,
    outcome: r.outcome,
    httpStatus: r.httpStatus,
    bytes: r.bytes,
    error: r.error,
    errorCode: r.errorCode,
    proxyDenyReason: r.proxyDenyReason,
    durationMs: Math.round(performance.now() - t0),
  };
}

export const DEFAULT_POSITIVE_PROBE_URL =
  "https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2";
export const DEFAULT_NEGATIVE_PROBE_URL =
  "https://example.com/lovable-egress-probe.woff2";

function assertNegativeProbeHostAllowed(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[mhtml-fonts] negative probe URL is not a valid URL: ${url}`);
  }
  for (const re of NEGATIVE_PROBE_DENYLIST) {
    if (re.test(host)) {
      throw new Error(
        `[mhtml-fonts] negative probe host "${host}" matches font-CDN/diagnosed denylist (${re}); ` +
          `pick a host that's NOT on any allowlist (e.g. example.com).`,
      );
    }
  }
}


// Hitta `font-family: <value>;` inuti varje `@font-face { ... }`-block.
// Hanterar:
//   - "Quoted Name"  → Quoted Name
//   - 'Quoted Name'  → Quoted Name
//   - Unquoted-Name  → Unquoted-Name
// Returnerar deduplicerade, trimmade namn. Exporteras separat så att
// freeze.server kan ringa den utan att gå via embedMhtmlFonts om vi vill.
const FONT_FACE_BLOCK_RE = /@font-face\s*\{([^}]*)\}/gi;
const FONT_FAMILY_DECL_RE = /font-family\s*:\s*([^;}]+)/i;
const SRC_DECL_RE = /src\s*:\s*([^;}]+)/i;
const URL_TOKEN_RE = /\burl\s*\(/i;
const METRIC_OVERRIDE_RE =
  /\b(size-adjust|ascent-override|descent-override|line-gap-override)\s*:/i;

// Strukturellt B1-filter: en face räknas som "embeddable remote font" bara om
// dess src-deskriptor innehåller minst en url(...)-källa. local()-only-faces
// (Next.js size-adjust-fallbacks, system-font-alias) filtreras strukturellt —
// inte via namn-regex som /Fallback$/, eftersom Next genererar t.ex.
// "__Inter_Fallback_<hash>" där suffixet inte är stabilt. Samma signal förklarar
// varför de inte fetchas, så filtret förenar B1-rensning med B2-nämnaren.
function hasRemoteSrc(faceBody: string): boolean {
  const m = faceBody.match(SRC_DECL_RE);
  if (!m) return false;
  return URL_TOKEN_RE.test(m[1]);
}

function familyFromFaceBody(faceBody: string): string | null {
  const m = faceBody.match(FONT_FAMILY_DECL_RE);
  if (!m) return null;
  // Värdet kan vara `"Foo", "Foo Fallback"` — ta första token.
  const first = m[1].split(",")[0].trim();
  const unquoted = first.replace(/^['"]|['"]$/g, "").trim();
  return unquoted || null;
}

export function extractEmbeddedFamilies(mhtmlRaw: string): string[] {
  const parsed = parseMhtml(mhtmlRaw);
  const seen = new Set<string>();
  for (const part of parsed.parts) {
    const ct = part.headers["content-type"] || "";
    if (!/^text\/(css|html)/i.test(ct)) continue;
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    const text = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    if (!/@font-face/i.test(text)) continue;
    for (const block of text.matchAll(FONT_FACE_BLOCK_RE)) {
      const body = block[1];
      // B1: hoppa faces utan remote url()-src. Metric-overrides (size-adjust m.m.)
      // exponeras via extractFontFaceDiagnostics, inte här — en face med
      // url() + size-adjust är fortfarande en riktig remote-font.
      if (!hasRemoteSrc(body)) continue;
      const family = familyFromFaceBody(body);
      if (family) seen.add(family);
    }
  }
  return Array.from(seen).sort();
}

// Minimal HTML-entity decode for <link href> / @import-värden. Den kritiska
// fallen är `&amp;` i Google-Fonts-liknande query-URLer: `<link href="…?family=
// Lato&amp;display=swap">` ska matcha partens råa `…&display=swap`-
// Content-Location. Utan denna avkodning ses stylesheeten som onåbar och dess
// familjer faller felaktigt ur huvuddokument-manifestet (Lato-buggen).
function htmlDecodeRef(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#0*38;/g, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * @font-face-familjer deklarerade av CSS som faktiskt appliceras på
 * HUVUDDOKUMENTET — dess inline `<style>` plus de stylesheet-parts som nås från
 * det via `<link rel=stylesheet>` / `@import` (transitivt). Sub-frame-only
 * stylesheets EXKLUDERAS.
 *
 * Varför separat från extractEmbeddedFamilies: den funktionen skannar VARENDA
 * text/css|html-part oavsett nåbarhet — rätt för "vad bäddade frysningen in",
 * men fel för "vad MÅSTE huvuddokumentet rendera vid replay". En font som bara
 * deklareras inuti en inbäddad widget-iframe (t.ex. HubSpots chatt-widget,
 * app.hubspot.com/conversations-visitor, som har sin egen "Lexend Deca")
 * registreras aldrig i top-framens document.fonts, så render-canaryn får INTE
 * kräva den — annars failar den `descriptor_missing` på en font den scorade
 * sidan aldrig använder.
 *
 * Begränsning: nåbarhet följer `<link>` och `@import`. Fonter som injiceras av
 * runtime-JS och som Blink serialiserat som en constructed/adopted stylesheet
 * utan motsvarande `<link>`/`<style>` i den serialiserade DOM:en missas; i
 * praktiken serialiserar Blink sådana stilar som inline `<style>` i värd-
 * dokumentet, vilket DENNA funktion skannar. Fail-open mot tom lista hanteras
 * av callern (harness faller tillbaka på hela manifestet).
 */
export function extractMainDocumentFamilies(mhtmlRaw: string): string[] {
  const parsed = parseMhtml(mhtmlRaw);

  const decodePart = (part: MhtmlPart): string => {
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    return enc === "quoted-printable" ? qpDecode(part.body) : part.body;
  };

  // Indexera varje part på Content-Location för <link>/@import-resolution.
  const byLocation = new Map<string, MhtmlPart>();
  for (const part of parsed.parts) {
    const cl = part.headers["content-location"];
    if (cl && !byLocation.has(cl)) byLocation.set(cl, part);
  }

  // Huvuddokument = första text/html-parten (Chromium serialiserar roten först).
  const mainPart = parsed.parts.find((p) =>
    /^text\/html/i.test(p.headers["content-type"] || ""),
  );
  if (!mainPart) return [];
  const mainLocation = mainPart.headers["content-location"] || "";

  const resolveRef = (ref: string, base: string): string | null => {
    const decoded = htmlDecodeRef(ref).trim();
    if (!decoded) return null;
    if (byLocation.has(decoded)) return decoded;
    try {
      const abs = new URL(decoded, base || undefined).href;
      return byLocation.has(abs) ? abs : decoded;
    } catch {
      return decoded;
    }
  };

  // CSS som appliceras på huvuddokumentet: inline <style> först, sedan BFS över
  // nåbara stylesheet-parts via <link> och @import.
  const cssChunks: string[] = [];
  const mainHtml = decodePart(mainPart);
  for (const m of mainHtml.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    cssChunks.push(m[1]);
  }

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const tag of mainHtml.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?\s*stylesheet/i.test(tag[0])) continue;
    const hm = tag[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hm) continue;
    const loc = resolveRef(hm[1], mainLocation);
    if (loc) queue.push(loc);
  }
  while (queue.length > 0) {
    const loc = queue.shift()!;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const part = byLocation.get(loc);
    if (!part) continue;
    if (!/^text\/css/i.test(part.headers["content-type"] || "")) continue;
    const css = decodePart(part);
    cssChunks.push(css);
    const base = part.headers["content-location"] || mainLocation;
    for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')]+)["']?/gi)) {
      const next = resolveRef(m[1], base);
      if (next && !seen.has(next)) queue.push(next);
    }
  }

  const families = new Set<string>();
  for (const css of cssChunks) {
    if (!/@font-face/i.test(css)) continue;
    for (const block of css.matchAll(FONT_FACE_BLOCK_RE)) {
      const body = block[1];
      if (!hasRemoteSrc(body)) continue;
      const family = familyFromFaceBody(body);
      if (family) families.add(family);
    }
  }
  return Array.from(families).sort();
}

export interface FontFaceDiagnostic {
  family: string;
  hasRemoteSrc: boolean;
  /** Face har minst en url()-token som Chromium kommer försöka fetcha vid
   *  replay (hink 2 ∪ hink 3 från harvest-font-urls). Tidigare bara hink 2;
   *  protokoll-relativa och path-relativa räknas nu in via samma chokepoint. */
  hasAbsoluteHttpUrl: boolean;
  /** Face har url()-tokens men ingen av dem kunde resolveras (hink 4 > 0 OCH
   *  inga hink 2/3). Tidigare hette detta `hasOnlyRelativeUrl` med en
   *  syntaktisk definition; nu semantisk (URL Chromium INTE kan fetcha). */
  hasUnresolvableRelativeUrl: boolean;
  hasLocalOnly: boolean;
  hasMetricOverrides: boolean;
  /** Hink 2 ∪ hink 3 — dedupade `resolved` URLer som Chromium kommer fetcha.
   *  Renamed från `absoluteUrls`; semantiken är inte längre "syntaktiskt absolut"
   *  utan "resolverbar absolut" (inkluderar path-relativa lösta mot Content-Location). */
  replayUrls: string[];
  /** Hink 1 — originals för redan inlinade fonter (data:/cid:). */
  embeddedUrls: string[];
  /** Hink 4 — relativa URLer utan giltig base. Tom = friskt. */
  unresolvableUrls: Array<{
    original: string;
    reason: "no-base" | "invalid-base";
  }>;
}

/**
 * Diagnostisk: returnerar per @font-face-block om det har remote-src,
 * är local()-only, om metric-override-deskriptorer finns, samt klassificerade
 * URLer per hink. Adopterar `iterateCssParts` + `harvestFontUrls` som chokepoint
 * — input-equality med embedMhtmlFonts (M-sidan) hålls by construction.
 */
export function extractFontFaceDiagnostics(
  mhtmlRaw: string,
): FontFaceDiagnostic[] {
  const parts = iterateCssParts(mhtmlRaw);
  const out: FontFaceDiagnostic[] = [];
  for (const part of parts) {
    // Per-face metadata (family, local-only, metric-overrides) — kräver
    // face-bodyn i klartext, inte URL-mängden. Re-scan av samma css är OK:
    // det är diagnostik, inte invariant-input. URL-klassificeringen kommer
    // strikt från harvestFontUrls.
    const faceBodies: Array<{ family: string | null; body: string }> = [];
    for (const m of part.css.matchAll(FONT_FACE_BLOCK_RE)) {
      faceBodies.push({ family: familyFromFaceBody(m[1]), body: m[1] });
    }
    const urls = harvestFontUrls(part.css, part.contentLocation);

    for (let i = 0; i < faceBodies.length; i++) {
      const fb = faceBodies[i];
      if (!fb.family) continue;
      const faceUrls = urls.filter((u) => u.faceIndex === i);
      const replay: string[] = [];
      const embedded: string[] = [];
      const unresolvable: FontFaceDiagnostic["unresolvableUrls"] = [];
      for (const u of faceUrls) {
        if (u.kind === "absolute" || u.kind === "relative-resolved") {
          replay.push(u.resolved);
        } else if (u.kind === "embedded") {
          embedded.push(u.original);
        } else {
          unresolvable.push({ original: u.original, reason: u.reason });
        }
      }
      const hasRemote = faceUrls.length > 0;
      const hasLocal = /\blocal\s*\(/i.test(fb.body);
      out.push({
        family: fb.family,
        hasRemoteSrc: hasRemote,
        hasAbsoluteHttpUrl: replay.length > 0,
        hasUnresolvableRelativeUrl: replay.length === 0 && unresolvable.length > 0,
        hasLocalOnly: hasLocal && !hasRemote,
        hasMetricOverrides: METRIC_OVERRIDE_RE.test(fb.body),
        replayUrls: replay,
        embeddedUrls: embedded,
        unresolvableUrls: unresolvable,
      });
    }
  }
  return out;
}

/**
 * URL-mot-URL-reconciliation mellan B1-oraklet (diagnostik-extraherade
 * absoluta url()-värden, P) och B2b-fetchern (FONT_URL_RE-harvestade URLer, M).
 * Två oberoende implementationer → mismatch == riktig harvest-divergens,
 * inte tautologi.
 */
export interface ReconcileResult {
  ok: boolean;
  onlyInP: string[]; // diagnostik hittade, fetcher missade (typiskt: //-URLer)
  onlyInM: string[]; // fetcher hittade, diagnostik missade (skulle indikera bug i oraklet)
}

export function reconcileFontUrlSets(
  diagnosticAbsUrls: Iterable<string>,
  fetcherHarvestedUrls: Iterable<string>,
): ReconcileResult {
  const P = new Set(diagnosticAbsUrls);
  const M = new Set(fetcherHarvestedUrls);
  const onlyInP = [...P].filter((u) => !M.has(u)).sort();
  const onlyInM = [...M].filter((u) => !P.has(u)).sort();
  return { ok: onlyInP.length === 0 && onlyInM.length === 0, onlyInP, onlyInM };
}

/**
 * Commit 3 — Publik M-yta för embed-targets. Filtrerar `harvestAllFontUrls`
 * till hink 2 ∪ 3 (URLer Chromium kommer försöka fetcha vid replay, alla
 * med ett `resolved`-fält). Tester använder denna mot P:s `replayUrls` för
 * att verifiera consumption-equality utan att gå via fetch eller embedding.
 */
export type EmbedTarget = HarvestedFontUrl & {
  kind: "absolute" | "relative-resolved";
  resolved: string;
};

export function collectEmbedTargets(mhtml: string): EmbedTarget[] {
  return harvestAllFontUrls(mhtml).filter(
    (u): u is EmbedTarget =>
      u.kind === "absolute" || u.kind === "relative-resolved",
  );
}

// Note: tidigare `ANY_HTTP_URL_RE` / `SRC_DECL_GLOBAL_RE` är borttagna.
// Harvest sker nu via delade `iterateCssParts` + `harvestFontUrls` från
// harvest-font-urls.ts — input-equality med extractFontFaceDiagnostics (P)
// hålls by construction. CSS-rewrite efter fetch använder en lokal token-regex
// som matchar samtliga url()-former (kvoterad/okvoterad) och slår upp på det
// resolverade värdet i originalToResolved → urlToCid.
const REWRITE_URL_TOKEN_RE =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;

export async function embedMhtmlFonts(
  mhtmlRaw: string,
  opts: {
    fetchTimeoutMs?: number;
    userAgent?: string;
    /** Browser-context font fetch (`page.evaluate(fetch)`) used as a FALLBACK
     *  when the server-side proxy fetch fails (CDN hotlink/IP-block — e.g.
     *  Schibsted's cdn.aftonbladet.se / static.svd.se, which 403 the proxy).
     *  The browser already loaded these via @font-face from the right origin,
     *  so its fetch reads bytes the proxy can't. Returns null on failure,
     *  including the CORS/403 case for referenced-but-unused fonts the page
     *  never actually loaded (those are score-neutral and stay unembedded). */
    browserFetch?: (url: string) => Promise<Buffer | null>;
    /** url -> bytes the browser ALREADY downloaded, captured via CDP
     *  Network.getResponseBody. The strongest fallback: it reads the actual
     *  @font-face download, so it works even when the CDN CORS/hotlink-blocks
     *  both the server-side proxy AND page.evaluate(fetch) (e.g. nytimes
     *  g1.nyt.com). Consulted before browserFetch on a server-side miss. */
    fontBodyCache?: Map<string, Buffer>;
    /** Font URLs the browser actually loaded (resource-timing). A surviving
     *  @font-face URL NOT in this set was referenced-but-unused (e.g. cross-brand
     *  fonts in shared CSS) → never rendered → safe to leave unembedded. One that
     *  IS here yet still unembedded is a real render-drift risk the gate keeps.
     *  Empty/undefined → every survivor counts (pre-fix strict behaviour). */
    loadedFontUrls?: string[];
    /** Kör positiv + negativ kontrollprobe före URL-loopen. */
    controlProbes?: {
      positiveUrl?: string;
      negativeUrl?: string;
    };
  } = {},
): Promise<FontEmbedResult> {
  const parsed = parseMhtml(mhtmlRaw);
  const fetchTimeoutMs = opts.fetchTimeoutMs ?? 10_000;
  const userAgent =
    opts.userAgent ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

  // Kontrollprober (om begärt) — körs FÖRE URL-fetch-loopen så att tolkningen
  // av records-distributionen kan guardas mot miljö-confound.
  let controlProbes: { positive: ControlProbeResult; negative: ControlProbeResult } | undefined;
  if (opts.controlProbes) {
    const posUrl = opts.controlProbes.positiveUrl ?? DEFAULT_POSITIVE_PROBE_URL;
    const negUrl = opts.controlProbes.negativeUrl ?? DEFAULT_NEGATIVE_PROBE_URL;
    assertNegativeProbeHostAllowed(negUrl);
    const [positive, negative] = await Promise.all([
      runControlProbe(posUrl, "positive", fetchTimeoutMs, userAgent),
      runControlProbe(negUrl, "negative", fetchTimeoutMs, userAgent),
    ]);
    controlProbes = { positive, negative };
  }

  // (Pass 1 nedan)



  // Pass 1: ETT producent-anrop till `harvestAllFontUrls` är källan både för
  // partitionering till embed-targets (hink 2 ∪ 3) och för
  // unresolvableRelativeUrls (hink 4) + fontUrlSummary. `iterateCssParts`
  // körs separat för rewrite-passet (Pass 2) eftersom det behöver CssPart-
  // objekten (css, encoding, partIndex) för re-encode. Det är samma rena
  // primitiv — en re-parse, inte en re-derivation av URL-mängden.
  //
  // En record per förekomst — duplicates ger skipped_dedup. URL:er utan
  // font-ext ger skipped_ext. Completeness-invariant:
  // fetchRecords.length === totalHarvestedOccurrences.
  interface HarvestEntry {
    original: string;
    resolved: string;
    ext: string | null;
    occurrenceIndex: number;
    isFirstOccurrence: boolean;
    isFontExt: boolean;
  }
  const harvest: HarvestEntry[] = [];
  const urlToCid = new Map<string, string>(); // key = resolved
  const seenResolved = new Set<string>();
  // original-token → resolved (för CSS-rewrite-uppslag; samma original kan
  // mappa till olika resolved om Content-Location skiljer mellan parts).
  // Per-part map så vi inte kollapsar olika baser.
  const partOriginalToResolved = new Map<number, Map<string, string>>();
  const unresolvableRelativeUrls: FontEmbedResult["unresolvableRelativeUrls"] = [];
  const fontUrlSummary: FontEmbedResult["fontUrlSummary"] = {
    embedded: 0,
    absolute: 0,
    relativeResolved: 0,
    unresolvable: [],
  };
  let occurrenceCounter = 0;

  const allHarvested: HarvestedFontUrl[] = harvestAllFontUrls(mhtmlRaw);
  for (const u of allHarvested) {
    if (u.kind === "embedded") {
      fontUrlSummary.embedded++;
      continue;
    }
    if (u.kind === "relative-unresolvable") {
      const entry = {
        original: u.original,
        reason: u.reason,
        partIndex: u.partIndex,
      };
      unresolvableRelativeUrls.push(entry);
      fontUrlSummary.unresolvable.push(entry);
      continue;
    }
    // hink 2 | 3
    if (u.kind === "absolute") fontUrlSummary.absolute++;
    else fontUrlSummary.relativeResolved++;
    const resolved = u.resolved;
    let localMap = partOriginalToResolved.get(u.partIndex);
    if (!localMap) {
      localMap = new Map<string, string>();
      partOriginalToResolved.set(u.partIndex, localMap);
    }
    localMap.set(u.original, resolved);
    const extMatch = resolved.match(FONT_EXT_RE);
    const ext = extMatch ? extMatch[1].toLowerCase() : null;
    const isFontExt = !!extMatch;
    const isFirst = !seenResolved.has(resolved);
    if (isFirst) {
      seenResolved.add(resolved);
      if (isFontExt) {
        urlToCid.set(
          resolved,
          `font-${randomUUID().replace(/-/g, "").slice(0, 16)}@snapshot`,
        );
      }
    }
    harvest.push({
      original: u.original,
      resolved,
      ext,
      occurrenceIndex: occurrenceCounter++,
      isFirstOccurrence: isFirst,
      isFontExt,
    });
  }
  const totalHarvestedOccurrences = harvest.length;

  // Pass 2 behöver CssPart-objekten (css, encoding, partIndex) för re-encode.
  const cssParts = iterateCssParts(mhtmlRaw);


  // Fetch unika font-ext-URLer parallellt. classifiedFetch ger oss bucket + timing.
  const urlToFetchResult = new Map<string, ClassifiedFetch & { durationMs: number }>();
  await Promise.all(
    Array.from(urlToCid.keys()).map(async (url) => {
      const t0 = performance.now();
      let r = await classifiedFetch(url, fetchTimeoutMs, userAgent);
      // Fallbacks on a server-side miss (proxy 403/hotlink-block), strongest
      // first. Only attempted on a miss, so the happy path stays fast+parallel.
      if (r.outcome !== "ok") {
        // 1) Bytes the browser already downloaded (CDP getResponseBody) — reads
        //    the real @font-face download, bypassing CORS that blocks fetch().
        const cached = opts.fontBodyCache?.get(url);
        if (cached && cached.byteLength > 0) {
          r = { outcome: "ok", bytes: cached.byteLength, httpStatus: 200, body: cached };
        } else if (opts.browserFetch) {
          // 2) page.evaluate(fetch) — works when the CDN allows CORS reads.
          const buf = await opts.browserFetch(url).catch(() => null);
          if (buf && buf.byteLength > 0) {
            r = { outcome: "ok", bytes: buf.byteLength, httpStatus: 200, body: buf };
          }
        }
      }
      urlToFetchResult.set(url, { ...r, durationMs: Math.round(performance.now() - t0) });
    }),
  );

  // Bygg fetchRecords i harvest-ordning. `url` är resolverad (vad fetchern såg).
  const fetchRecords: FontFetchRecord[] = harvest.map((h) => {
    if (!h.isFirstOccurrence) {
      return {
        url: h.resolved,
        ext: h.ext,
        occurrenceIndex: h.occurrenceIndex,
        attempted: false,
        outcome: "skipped_dedup",
        bytes: 0,
        durationMs: 0,
      };
    }
    if (!h.isFontExt) {
      return {
        url: h.resolved,
        ext: h.ext,
        occurrenceIndex: h.occurrenceIndex,
        attempted: false,
        outcome: "skipped_ext",
        bytes: 0,
        durationMs: 0,
      };
    }
    const fr = urlToFetchResult.get(h.resolved)!;
    return {
      url: h.resolved,
      ext: h.ext,
      occurrenceIndex: h.occurrenceIndex,
      attempted: true,
      outcome: fr.outcome,
      bytes: fr.bytes,
      httpStatus: fr.httpStatus,
      error: fr.error,
      errorCode: fr.errorCode,
      proxyDenyReason: fr.proxyDenyReason,
      durationMs: fr.durationMs,
    };
  });

  // Completeness-invariant: en record per förekomst. Om denna kastar har en
  // tyst skip-path smugits in i koden ovan.
  if (fetchRecords.length !== totalHarvestedOccurrences) {
    throw new Error(
      `[mhtml-fonts] completeness-invariant failed: fetchRecords.length=${fetchRecords.length} ` +
        `!== totalHarvestedOccurrences=${totalHarvestedOccurrences} — silent skip path exists`,
    );
  }

  // Bygg urlToBinary av ok-fetchar — body är redan med från classifiedFetch.
  const urlToBinary = new Map<string, Buffer>();
  const fetchFailures: { url: string; error: string }[] = [];
  for (const [url, r] of urlToFetchResult) {
    if (r.outcome === "ok" && r.body) {
      urlToBinary.set(url, r.body);
    } else if (r.outcome !== "ok") {
      fetchFailures.push({ url, error: r.error ?? r.outcome });
    }
  }


  // Pass 2: rewrite CSS bodies — match alla url()-token-former (kvoterad
  // & okvoterad), slå upp på partens originalToResolved-map → urlToCid.
  // Token-set utanför @font-face/src har ingen mapping → orörda.
  for (const css of cssParts) {
    const localMap = partOriginalToResolved.get(css.partIndex);
    if (!localMap) continue;
    const rewritten = css.css.replace(
      REWRITE_URL_TOKEN_RE,
      (full, q1?: string, q2?: string, raw?: string) => {
        const original = q1 ?? q2 ?? raw ?? "";
        const resolved = localMap.get(original);
        if (!resolved) return full;
        if (!urlToBinary.has(resolved)) return full;
        const cid = urlToCid.get(resolved)!;
        return `url("cid:${cid}")`;
      },
    );
    if (rewritten === css.css) continue;
    const part = parsed.parts[css.partIndex];
    const newBody = css.encoding === "quoted-printable" ? qpEncode(rewritten) : rewritten;
    parsed.parts[css.partIndex] = { ...part, body: newBody };
  }

  // Pass 3: append a new MHTML part for each embedded font binary.
  let embeddedFontCount = 0;
  for (const [url, buf] of urlToBinary) {
    const cid = urlToCid.get(url)!;
    const ext = (url.match(FONT_EXT_RE)?.[1] || "woff2").toLowerCase();
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    const b64 = buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
    const headers = [
      `Content-Type: ${mime}`,
      `Content-Transfer-Encoding: base64`,
      `Content-Location: cid:${cid}`,
    ].join("\r\n");
    parsed.parts.push({ rawHeaders: headers, headers: parseHeaders(headers), body: b64 });
    embeddedFontCount++;
  }

  const out = serializeMhtml(parsed);

  let externalFontSrcCount = 0;
  const unembeddedFontUrls: string[] = [];
  // Subset of survivors the browser actually loaded — the render-drift-relevant
  // ones. The rest are referenced-but-unused and score-neutral.
  const unembeddedLoadedFontUrls: string[] = [];
  const loadedSet = new Set(opts.loadedFontUrls ?? []);
  const gateLoadedSubset = loadedSet.size > 0;
  for (let i = 0; i < parsed.parts.length; i++) {
    const part = parsed.parts[i];
    const ct = part.headers["content-type"] || "";
    if (!/^text\/(css|html)/i.test(ct)) continue;
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    const text = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    for (const m of text.matchAll(FONT_URL_RE)) {
      if (FONT_EXT_RE.test(m[2])) {
        externalFontSrcCount++;
        if (unembeddedFontUrls.length < 20 && !unembeddedFontUrls.includes(m[2])) {
          unembeddedFontUrls.push(m[2]);
        }
        if (gateLoadedSubset && loadedSet.has(m[2]) && !unembeddedLoadedFontUrls.includes(m[2])) {
          unembeddedLoadedFontUrls.push(m[2]);
        }
      }
    }
  }

  return {
    mhtml: out,
    externalFontSrcCount,
    unembeddedFontUrls,
    unembeddedLoadedFontUrls,
    embeddedFontCount,
    newBytes: Buffer.byteLength(out, "utf8"),
    fetchFailures,
    fontUrlsSeen: Array.from(urlToCid.keys()),
    embeddedFamilies: extractEmbeddedFamilies(out),
    fetchRecords,
    totalHarvestedOccurrences,
    controlProbes,
    unresolvableRelativeUrls,
    fontUrlSummary,
  };
}


