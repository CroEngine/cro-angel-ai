/**
 * Block A regression tests — round-4.
 *
 * Pre-fix bug: HTML_ATTR_WHITELIST_PATTERNS targeted decoded HTML syntax
 * (`content="anon..."`) but the MHTML body part is QP-encoded
 * (`content=3D"anon..."`). The masks no-op'd; "green" on the affected rows
 * was just token-value stability across captures, not actual masking. These
 * tests pin the QP-decode-then-mask order so a regression surfaces fast.
 */
import { describe, expect, it } from "vitest";
import {
  HTML_ATTR_WHITELIST_PATTERNS,
  normalizeMhtml,
  qpDecodeLine,
} from "../mhtml-normalize";

describe("qpDecodeLine", () => {
  it("decodes =3D back to =", () => {
    expect(qpDecodeLine('content=3D"anon123"')).toBe('content="anon123"');
  });
  it("decodes =22 back to \"", () => {
    expect(qpDecodeLine("a=22b=22")).toBe('a"b"');
  });
  it("is a no-op for plain ASCII without QP escapes", () => {
    expect(qpDecodeLine("<meta name=\"x\" content=\"y\">")).toBe(
      '<meta name="x" content="y">',
    );
  });
  it("decodes multiple escapes on the same line", () => {
    expect(qpDecodeLine("<a=3Db=3Dc>")).toBe("<a=b=c>");
  });
});

describe("HTML_ATTR_WHITELIST_PATTERNS against decoded syntax", () => {
  // Sanity check — patterns must match the post-decode shape, not pre-decode.
  it("laboratory-identifier pattern matches decoded attribute", () => {
    const decoded = '<meta name="laboratory-identifier-foo" content="anon0123456789abcdef0123456789abcdef">';
    const hit = HTML_ATTR_WHITELIST_PATTERNS.some((re) => {
      re.lastIndex = 0;
      return re.test(decoded);
    });
    expect(hit).toBe(true);
  });
  it("csrf-token pattern matches decoded attribute", () => {
    const decoded = '<meta name="csrf-token" content="abc123">';
    const hit = HTML_ATTR_WHITELIST_PATTERNS.some((re) => {
      re.lastIndex = 0;
      return re.test(decoded);
    });
    expect(hit).toBe(true);
  });
});

describe("normalizeMhtml — QP-encoded body masks (round-4 regression)", () => {
  it("masks QP-encoded laboratory-identifier meta after decode", () => {
    // Wire shape: Chromium MHTML body with Content-Transfer-Encoding: quoted-printable.
    // Note: in real MHTML this is preceded by part headers, but the per-line
    // mask logic doesn't care — it operates on each line after the header filter.
    const wire = '<meta name=3D"laboratory-identifier-foo" content=3D"anon0123456789abcdef0123456789abcdef">';
    const out = normalizeMhtml(wire);
    expect(out).toContain("<WHITELISTED>");
    expect(out).not.toContain("anon0123456789abcdef0123456789abcdef");
  });

  it("masks QP-encoded csrf-token meta", () => {
    const wire = '<meta name=3D"csrf-token" content=3D"sessionXYZ">';
    const out = normalizeMhtml(wire);
    expect(out).toContain("<WHITELISTED>");
    expect(out).not.toContain("sessionXYZ");
  });

  it("masks plain (non-QP-encoded) attributes — backwards compat", () => {
    const decoded = '<meta name="laboratory-identifier-foo" content="anon0123456789abcdef0123456789abcdef">';
    const out = normalizeMhtml(decoded);
    expect(out).toContain("<WHITELISTED>");
  });

  it("two different lab-identifier values normalize to byte-identical output", () => {
    // The whole point of the mask: two captures with different session IDs
    // should produce the same normalized line, so they don't show up as drift.
    const a = '<meta name=3D"laboratory-identifier-foo" content=3D"anon0123456789abcdef0123456789abcdef">';
    const b = '<meta name=3D"laboratory-identifier-foo" content=3D"anonfedcba9876543210fedcba9876543210">';
    expect(normalizeMhtml(a)).toBe(normalizeMhtml(b));
  });

  it("strips MHTML Date: header", () => {
    const wire = ["Date: Wed, 17 Jun 2026 21:00:00 +0000", "<html>"].join("\n");
    expect(normalizeMhtml(wire)).not.toContain("Date:");
  });

  it("joins soft-line-break-wrapped attribute then masks", () => {
    // Real QP wraps at column 76. A long attribute can be split mid-value;
    // soft-line-break decode must happen before per-line split or the mask
    // sees half a string and misses.
    const wire =
      '<meta name=3D"csrf-token" content=3D"abc123de=\nfghi456">';
    const out = normalizeMhtml(wire);
    expect(out).toContain("<WHITELISTED>");
    expect(out).not.toContain("abc123defghi456");
  });
});
