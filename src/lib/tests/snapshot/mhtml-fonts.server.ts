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
  embeddedFontCount: number;
  newBytes: number;
  fetchFailures: { url: string; error: string }[];
  fontUrlsSeen: string[];
  embeddedFamilies: string[];
  /** B2b: en record per harvest-förekomst. fetchRecords.length === totalHarvestedOccurrences. */
  fetchRecords: FontFetchRecord[];
  totalHarvestedOccurrences: number;
  controlProbes?: { positive: ControlProbeResult; negative: ControlProbeResult };
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

export interface FontFaceDiagnostic {
  family: string;
  hasRemoteSrc: boolean;
  /** Face har minst en url() som matchar ^(https?:)?// (inkluderar protocol-relative). */
  hasAbsoluteHttpUrl: boolean;
  /** Face har url() men ingen av dem är absolut per def ovan. */
  hasOnlyRelativeUrl: boolean;
  hasLocalOnly: boolean;
  hasMetricOverrides: boolean;
  /** Råa absoluta url()-värden i denna face. Diagnostik-oraklet för B2b-reconciliation;
   *  detta är medvetet en SEPARAT implementation från fetcherns FONT_URL_RE — de två
   *  kodvägarna måste få vara oense, annars är invariant P==M tautologisk. Inkluderar
   *  protocol-relative `//host/...` (fetcherns regex missar dem; det är hela poängen). */
  absoluteUrls: string[];
}

// Diagnostik-oraklets EGNA url()-extraktor. Avsiktligt parallell till
// FONT_URL_RE / ANY_HTTP_URL_RE — dela inte. Tar alla url()-token,
// klassificering sker sen via DIAG_IS_ABSOLUTE_RE.
const DIAG_URL_TOKEN_RE = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi;
// "Absolut" för B1-oraklet = scheme-relative ELLER http(s). Inkluderar `//cdn/x`.
const DIAG_IS_ABSOLUTE_RE = /^(?:https?:)?\/\//i;

/**
 * Diagnostisk: returnerar per @font-face-block om det har remote-src,
 * är local()-only, om metric-override-deskriptorer finns, samt absoluta
 * URLer enligt B1-oraklets egen definition. Används av breadth-smoke för
 * URL-mot-URL-reconciliation mot fetcherns harvest.
 */
export function extractFontFaceDiagnostics(
  mhtmlRaw: string,
): FontFaceDiagnostic[] {
  const parsed = parseMhtml(mhtmlRaw);
  const out: FontFaceDiagnostic[] = [];
  for (const part of parsed.parts) {
    const ct = part.headers["content-type"] || "";
    if (!/^text\/(css|html)/i.test(ct)) continue;
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    const text = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    if (!/@font-face/i.test(text)) continue;
    for (const block of text.matchAll(FONT_FACE_BLOCK_RE)) {
      const body = block[1];
      const family = familyFromFaceBody(body);
      if (!family) continue;
      const srcMatch = body.match(SRC_DECL_RE);
      const srcValue = srcMatch ? srcMatch[1] : "";
      const hasRemote = URL_TOKEN_RE.test(srcValue);
      const hasLocal = /\blocal\s*\(/i.test(srcValue);
      // Egen url()-extraktion — INTE fetcherns regex.
      const absoluteUrls: string[] = [];
      let hasAnyUrl = false;
      for (const m of srcValue.matchAll(DIAG_URL_TOKEN_RE)) {
        hasAnyUrl = true;
        const u = m[2];
        if (DIAG_IS_ABSOLUTE_RE.test(u)) absoluteUrls.push(u);
      }
      out.push({
        family,
        hasRemoteSrc: hasRemote,
        hasAbsoluteHttpUrl: absoluteUrls.length > 0,
        hasOnlyRelativeUrl: hasAnyUrl && absoluteUrls.length === 0,
        hasLocalOnly: hasLocal && !hasRemote,
        hasMetricOverrides: METRIC_OVERRIDE_RE.test(body),
        absoluteUrls,
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

// För B2b-harvest behöver vi ALLA url(...) i src-deskriptorer för @font-face,
// inte bara de med känd font-ext — annars tappar vi URL:er utan extension
// (CDN:er som serverar woff2 utan filändelse) i tystnad.
const ANY_HTTP_URL_RE = /url\(\s*(['"]?)(https?:\/\/[^)'"\s]+?)\1\s*\)/gi;
const SRC_DECL_GLOBAL_RE = /src\s*:\s*([^;}]+)/gi;

export async function embedMhtmlFonts(
  mhtmlRaw: string,
  opts: {
    fetchTimeoutMs?: number;
    userAgent?: string;
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

  // Pass 1: identify CSS-ish parts (QP-encoded text), decode bodies.
  interface CssPartState {
    idx: number;
    decoded: string;
    encoding: string;
  }
  const cssParts: CssPartState[] = [];
  for (let i = 0; i < parsed.parts.length; i++) {
    const part = parsed.parts[i];
    const ct = part.headers["content-type"] || "";
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    if (!/^text\/(css|html)/i.test(ct)) continue;
    if (!part.body.includes("@font-face") && !part.body.includes("font-face")) continue;
    const decoded = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    if (!/@font-face/i.test(decoded)) continue;
    cssParts.push({ idx: i, decoded, encoding: enc });
  }

  // Harvest per-occurrence (NOT per-unique). En record per förekomst — duplicates
  // ger skipped_dedup. URL:er utan font-ext ger skipped_ext. Detta är hela
  // B2b-poängen: completeness-invariant fetchRecords.length === totalHarvestedOccurrences.
  interface HarvestEntry {
    url: string;
    ext: string | null;
    occurrenceIndex: number;
    isFirstOccurrence: boolean;
    isFontExt: boolean;
  }
  const harvest: HarvestEntry[] = [];
  const urlToCid = new Map<string, string>();
  const seenUrls = new Set<string>();
  let occurrenceCounter = 0;
  for (const css of cssParts) {
    // Iterera @font-face-block, sen src-deskriptorer i ordning, sen url() i ordning.
    for (const faceMatch of css.decoded.matchAll(FONT_FACE_BLOCK_RE)) {
      const faceBody = faceMatch[1];
      for (const srcMatch of faceBody.matchAll(SRC_DECL_GLOBAL_RE)) {
        const srcValue = srcMatch[1];
        for (const urlMatch of srcValue.matchAll(ANY_HTTP_URL_RE)) {
          const url = urlMatch[2];
          const extMatch = url.match(FONT_EXT_RE);
          const ext = extMatch ? extMatch[1].toLowerCase() : null;
          const isFontExt = !!extMatch;
          const isFirstOccurrence = !seenUrls.has(url);
          if (isFirstOccurrence) {
            seenUrls.add(url);
            if (isFontExt) {
              urlToCid.set(
                url,
                `font-${randomUUID().replace(/-/g, "").slice(0, 16)}@snapshot`,
              );
            }
          }
          harvest.push({
            url,
            ext,
            occurrenceIndex: occurrenceCounter++,
            isFirstOccurrence,
            isFontExt,
          });
        }
      }
    }
  }
  const totalHarvestedOccurrences = harvest.length;

  // Fetch unika font-ext-URLer parallellt. classifiedFetch ger oss bucket + timing.
  const urlToFetchResult = new Map<string, ClassifiedFetch & { durationMs: number }>();
  await Promise.all(
    Array.from(urlToCid.keys()).map(async (url) => {
      const t0 = performance.now();
      const r = await classifiedFetch(url, fetchTimeoutMs, userAgent);
      urlToFetchResult.set(url, { ...r, durationMs: Math.round(performance.now() - t0) });
    }),
  );

  // Bygg fetchRecords i harvest-ordning.
  const fetchRecords: FontFetchRecord[] = harvest.map((h) => {
    if (!h.isFirstOccurrence) {
      return {
        url: h.url,
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
        url: h.url,
        ext: h.ext,
        occurrenceIndex: h.occurrenceIndex,
        attempted: false,
        outcome: "skipped_ext",
        bytes: 0,
        durationMs: 0,
      };
    }
    const fr = urlToFetchResult.get(h.url)!;
    return {
      url: h.url,
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


  // Pass 2: rewrite CSS bodies — only for URLs vi faktiskt har binär för.
  for (const css of cssParts) {
    const rewritten = css.decoded.replace(FONT_URL_RE, (full, _q, url) => {
      if (!urlToBinary.has(url)) return full;
      const cid = urlToCid.get(url)!;
      return `url("cid:${cid}")`;
    });
    if (rewritten === css.decoded) continue;
    const part = parsed.parts[css.idx];
    const newBody = css.encoding === "quoted-printable" ? qpEncode(rewritten) : rewritten;
    parsed.parts[css.idx] = { ...part, body: newBody };
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
  for (let i = 0; i < parsed.parts.length; i++) {
    const part = parsed.parts[i];
    const ct = part.headers["content-type"] || "";
    if (!/^text\/(css|html)/i.test(ct)) continue;
    const enc = (part.headers["content-transfer-encoding"] || "").toLowerCase();
    const text = enc === "quoted-printable" ? qpDecode(part.body) : part.body;
    for (const m of text.matchAll(FONT_URL_RE)) {
      if (FONT_EXT_RE.test(m[2])) externalFontSrcCount++;
    }
  }

  return {
    mhtml: out,
    externalFontSrcCount,
    embeddedFontCount,
    newBytes: Buffer.byteLength(out, "utf8"),
    fetchFailures,
    fontUrlsSeen: Array.from(urlToCid.keys()),
    embeddedFamilies: extractEmbeddedFamilies(out),
    fetchRecords,
    totalHarvestedOccurrences,
    controlProbes,
  };
}

