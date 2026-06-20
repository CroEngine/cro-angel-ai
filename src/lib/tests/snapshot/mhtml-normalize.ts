/**
 * MHTML normalization for the determinism check.
 *
 * Extracted from scripts/freeze-determinism-check.ts so the masking logic is
 * unit-testable. The script imports the same patterns and functions — if you
 * change something here you do NOT need to mirror it in the script, only in
 * fixtures/determinism/WHITELIST.md.
 *
 * Fixes round-4 (Block A): MHTML body parts emitted by Chromium use
 * Content-Transfer-Encoding: quoted-printable. That means a literal `=` in
 * attribute syntax (e.g. `content="anon123"`) is encoded as `=3D` on the
 * wire: `content=3D"anon123"`. The HTML_ATTR_WHITELIST_PATTERNS were written
 * against the decoded shape with literal `=`, so every confirmed-by-design
 * row that depended on attribute-value matching (laboratory-identifier,
 * csrf-token, nonce, the cid: references, the inline boundary) silently
 * no-op'd. Apparent green on those rows came from token-value stability
 * across the three captures, NOT from masking. We add a proper QP-decode
 * pass before applying the attribute patterns; soft-line-breaks (`=\r?\n`)
 * are decoded first as before so multi-line wrapped attributes get joined.
 */

// === A-priori whitelist (mirrors fixtures/determinism/WHITELIST.md) ===
// If you change something here you MUST also update WHITELIST.md and vice versa.
export const MHTML_WHITELIST_LINE_PATTERNS: RegExp[] = [
  /^Date:\s/i,
  /^Content-Type: multipart\/related;\s*boundary=/i,
  /^Content-ID:\s</i,
  /^Content-Location:.*[?&](t|ts|cb|v|_|cache|version|build|hash)=/i,
  // Body separator lines emitted by Chromium MHTML serializer between parts.
  // Same RFC 2557 per-snapshot random mechanism as the boundary= header param.
  /^------MultipartBoundary--[A-Za-z0-9]+----\s*$/,
];

// Strip-or-mask patterns applied per-line BEFORE diff. The cid:-reference
// rewrite is the body-side complement of the Content-ID: header strip —
// Chromium synthesizes a fresh UUID per part per snapshot, and any href/src
// inside the body that points to a part rotates with it. Score-impact: neutral
// (extractor doesn't care which cid a css/img part has, only its content).
export const HTML_ATTR_WHITELIST_PATTERNS: RegExp[] = [
  /\bnonce="[^"]*"/g,
  /\bdata-[a-z-]+-nonce="[^"]*"/g,
  /<meta name="csrf-token" content="[^"]*">/gi,
  /[?&](t|ts|cb|v|_|cache|version|build|hash)=[a-z0-9.-]+/gi,
  // HubSpot per-session tracking tokens stamped into nav/link hrefs (__hstc,
  // __hssc, __hsfp, __hssrc, hubspotutk). Score-neutral query-string params the
  // extractor never reads — proven score-neutral by round6 #4 (byte-identical
  // goldens across 3 captures). Value runs to the next & " ' or whitespace
  // (the next param begins with the & of &amp;), so surrounding markup is intact.
  /\b(?:__hs(?:tc|sc|fp|src)|hubspotutk)=[^&"'\s]*/gi,
  // cid: references rotate per snapshot — Chromium synthesizes a fresh id per
  // part. Broadened from the @mhtml.blink-only UUID form to ALL cid: tokens
  // (font-…@snapshot, frame-…, css-…@mhtml.blink): the extractor only cares
  // about a part's content, not which cid addresses it. Stops at the closing
  // quote/paren so surrounding markup is untouched.
  /cid:[^"')\s]+/g,
  // Bare per-session UUIDs stamped into signup/CTA hrefs and carousel ids
  // (e.g. signup-hubspot/crm?...<uuid>..., --cl-carousel ids). Only a UUID that
  // VARIES between captures affects the diff; a stable one is a no-op here. Round6
  // #4 (identical goldens) proves all such variance is score-neutral. Standard
  // 8-4-4-4-12 hex shape; cid:-prefixed UUIDs are already eaten by the cid: mask.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // Boundary tokens that appear inline (e.g. inside Content-Type headers re-quoted in body).
  /boundary="----MultipartBoundary--[A-Za-z0-9]+----"/g,
  // HubSpot Laboratory experiment ID — envelope: meta-attr value only.
  // anon-prefixed hex; length is NOT fixed (observed 28, not 32) so match a hex
  // run rather than a fixed count (the {32} form silently no-op'd). Body-structure
  // variance (tarpit anchor) is handled by the cascade-immune diff, not masked here.
  /<meta name="laboratory-identifier-[a-z]+" content="anon[0-9a-f]+">/gi,
];

/**
 * Decode quoted-printable byte escapes on a single line.
 *
 * Only handles `=XX` (hex) decoding — soft-line-breaks (`=\r?\n`) are joined
 * earlier in normalizeMhtml before split. Idempotent against lines that
 * contain no `=XX` sequences (regex misses everything). Safe to apply to
 * MHTML header lines as well: header line shapes (`Date: ...`,
 * `Content-Type: ...`, `boundary=...`) never contain `=` immediately
 * followed by two hex characters.
 *
 * Decoded byte is interpreted as Latin-1; that matches Chromium's QP
 * output for non-ASCII content in HTML attributes (typically already escaped
 * to numeric entities or stored as multi-byte UTF-8 split across QP escapes).
 */
export function qpDecodeLine(line: string): string {
  return line.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

export function normalizeMhtml(raw: string): string {
  // QP soft-line-break decode FIRST so multi-line wrapped attributes
  // (e.g. cid:css-<UUID>@mhtml.blink split across 76-char QP rows) match the
  // body patterns. Without this, the cid: regex only catches occurrences that
  // happen to fall entirely within one QP row.
  const joined = raw.replace(/=\r?\n/g, "");
  return joined
    .split(/\r?\n/)
    .filter((line) => !MHTML_WHITELIST_LINE_PATTERNS.some((re) => re.test(line)))
    .map((line) => {
      // Block A fix: decode QP byte-escapes (`=3D` → `=`, `=22` → `"`, etc.)
      // BEFORE applying attribute masks. Patterns are written against
      // decoded HTML syntax; the on-wire MHTML body is QP-encoded.
      let out = qpDecodeLine(line);
      for (const re of HTML_ATTR_WHITELIST_PATTERNS) out = out.replace(re, "<WHITELISTED>");
      return out;
    })
    .join("\n");
}
