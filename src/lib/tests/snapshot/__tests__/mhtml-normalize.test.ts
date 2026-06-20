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

describe("round6 masks — score-neutral session noise (proven by #4 identical goldens)", () => {
  const norm = (s: string) => normalizeMhtml(s);

  it("masks __hstc/__hssc tracking tokens in QP-encoded hrefs", () => {
    const wire =
      '<a href=3D"https://www.hubspot.fr/?hubs_content=3Dwww&amp;__hstc=3D20629287.abc.1.2.3.4&amp;x">';
    const out = norm(wire);
    expect(out).toContain("<WHITELISTED>");
    expect(out).not.toContain("20629287.abc");
  });

  it("two different __hstc values normalize byte-identical", () => {
    const a = "__hstc=3D20629287.aaaaaa.1.2.3.4&amp;x";
    const b = "__hstc=3D99999999.bbbbbb.9.8.7.6&amp;x";
    expect(norm(a)).toBe(norm(b));
  });

  it("masks ALL cid: formats, not just @mhtml.blink (the prior mask missed @snapshot)", () => {
    expect(norm('src=3D"cid:font-e1432b2d21a442c4@snapshot"')).toContain("<WHITELISTED>");
    expect(norm('href=3D"cid:frame-DC2B66B6E895CDED"')).toContain("<WHITELISTED>");
    // two captures: same part, different synthesized cid -> identical normalized.
    expect(norm('url(=22cid:font-aaaa@snapshot=22)')).toBe(norm('url(=22cid:font-bbbb@snapshot=22)'));
  });

  it("masks bare per-session UUIDs in signup/CTA hrefs", () => {
    // The URL '=' before the value is itself QP-encoded as '=3D' on the wire,
    // so the id starts cleanly after qpDecodeLine (a literal '=3...' would be
    // mis-decoded as the QP escape =35='5').
    const a = 'href=3D"app.hubspot.com/signup-hubspot/crm?x=3D3548e0d0-a233-4a20-a850-072ebf82e1aa"';
    const b = 'href=3D"app.hubspot.com/signup-hubspot/crm?x=3D2fc762d5-c785-4b5d-826d-7f0ffb5d6699"';
    expect(norm(a)).toBe(norm(b));
    expect(norm(a)).toContain("<WHITELISTED>");
  });

  it("laboratory mask handles the REAL 28-hex length (the hardcoded {32} silently no-op'd)", () => {
    // Observed live values are 28 hex, not 32 — under the old {32} these two
    // distinct session IDs stayed distinct (drift). Flexible hex run fixes it.
    const a = '<meta name=3D"laboratory-identifier-other" content=3D"anonba0f76f519d55bf38c490c87ea04">';
    const b = '<meta name=3D"laboratory-identifier-other" content=3D"anon97fd89ba23e5675acb2d72ab1088">';
    expect(norm(a)).toBe(norm(b));
    expect(norm(a)).not.toContain("ba0f76f519d55bf38c490c87ea04");
  });
});
