// Unit-test: extractEmbeddedFamilies parsar @font-face font-family ur en MHTML.
// Täcker citerings-varianter (", ', okvoterad) och fallback-listor.

import { describe, it, expect } from "vitest";

import {
  extractEmbeddedFamilies,
  extractFontFaceDiagnostics,
  extractMainDocumentFamilies,
} from "../mhtml-fonts.server";

function mhtml(cssBody: string): string {
  const boundary = "----TEST";
  return [
    `From: <Saved by Test>`,
    `Subject: Test`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    ``,
    ``,
    `--${boundary}`,
    `Content-Type: text/html`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    `<html></html>`,
    `--${boundary}`,
    `Content-Type: text/css`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    cssBody,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

describe("extractEmbeddedFamilies", () => {
  it("plockar double-quoted namn", () => {
    const css = `@font-face { font-family: "Inter Variable"; src: url("cid:x"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Inter Variable"]);
  });

  it("plockar single-quoted namn", () => {
    const css = `@font-face { font-family: 'Roboto Mono'; src: url("cid:x"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Roboto Mono"]);
  });

  it("plockar okvoterade namn", () => {
    const css = `@font-face { font-family: Inter; src: url("cid:x"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Inter"]);
  });

  it("tar bara första värdet ur fallback-lista", () => {
    const css = `@font-face { font-family: "Foo", "Foo Fallback"; src: url("cid:x"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Foo"]);
  });

  it("dedupar över flera @font-face-block", () => {
    const css = `
      @font-face { font-family: "Inter"; src: url("cid:a"); font-weight: 400; }
      @font-face { font-family: "Inter"; src: url("cid:b"); font-weight: 700; }
      @font-face { font-family: "Roboto"; src: url("cid:c"); }
    `;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Inter", "Roboto"]);
  });

  it("returnerar tom array när inga @font-face finns", () => {
    expect(extractEmbeddedFamilies(mhtml(`body { color: red; }`))).toEqual([]);
  });
});

describe("extractEmbeddedFamilies — B1 strukturellt local()-filter", () => {
  it("filtrerar bort enskild local()-only face", () => {
    const css = `@font-face { font-family: "Arial Fallback"; src: local("Arial"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual([]);
  });

  it("filtrerar bort multi-local()-only face", () => {
    const css = `@font-face { font-family: "System Fallback"; src: local("Arial"), local("Helvetica"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual([]);
  });

  it("behåller mixed src (local + url)", () => {
    const css = `@font-face { font-family: "Foo"; src: local("Arial"), url("cid:x") format("woff2"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Foo"]);
  });

  it("behåller url() face med metric-overrides", () => {
    const css = `@font-face { font-family: "Inter"; src: url("cid:x"); size-adjust: 100.06%; }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["Inter"]);
  });

  it("fångar Next.js-mönstret strukturellt (oavsett namn-hash)", () => {
    const css = `
      @font-face { font-family: "__Inter_Fallback_abc"; src: local("Arial"); size-adjust: 107%; ascent-override: 90%; }
      @font-face { font-family: "__Inter_abc"; src: url("cid:real") format("woff2"); }
    `;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["__Inter_abc"]);
  });
});

// Bygg en flerdels-MHTML med Content-Location per part, så <link>/@import-
// resolution kan testas (helpern `mhtml()` ovan har bara två länklösa parts).
function multipartMhtml(parts: Array<{ ct: string; cl?: string; body: string }>): string {
  const boundary = "----TEST";
  const lines: string[] = [
    `From: <Saved by Test>`,
    `Subject: Test`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundary}"`,
    ``,
    ``,
  ];
  for (const p of parts) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${p.ct}`);
    lines.push(`Content-Transfer-Encoding: 8bit`);
    if (p.cl) lines.push(`Content-Location: ${p.cl}`);
    lines.push(``);
    lines.push(p.body);
  }
  lines.push(`--${boundary}--`);
  lines.push(``);
  return lines.join("\r\n");
}

describe("extractMainDocumentFamilies — huvuddokument-scoping", () => {
  it("exkluderar sub-frame-only @font-face (iframe-widget-font, Lexend-Deca-buggen)", () => {
    const doc = multipartMhtml([
      {
        ct: "text/html",
        cl: "https://example.com/",
        body: `<html><head><link rel="stylesheet" href="https://fonts.example.com/css?family=Main&amp;display=swap"></head><body></body></html>`,
      },
      {
        ct: "text/css",
        cl: "https://fonts.example.com/css?family=Main&display=swap",
        body: `@font-face { font-family: "MainFont"; src: url("cid:m") format("woff2"); }`,
      },
      {
        ct: "text/html",
        cl: "https://widget.example.com/",
        body: `<html><head><link rel="stylesheet" href="https://widget.example.com/w.css"></head><body></body></html>`,
      },
      {
        ct: "text/css",
        cl: "https://widget.example.com/w.css",
        body: `@font-face { font-family: "WidgetFont"; src: url("cid:w") format("woff2"); }`,
      },
    ]);
    // Huvuddokumentet renderar bara MainFont; WidgetFont lever i iframe-parten.
    expect(extractMainDocumentFamilies(doc)).toEqual(["MainFont"]);
    // Kontrast: den oscopeade extraktorn ser BÅDA (rätt för "vad bäddades in").
    expect(extractEmbeddedFamilies(doc)).toEqual(["MainFont", "WidgetFont"]);
  });

  it("avkodar &amp; i link-href så Google-Fonts-stylesheeten nås (Lato-buggen)", () => {
    const doc = multipartMhtml([
      {
        ct: "text/html",
        cl: "https://example.com/",
        body: `<html><head><link rel="stylesheet" href="https://f.example.com/c?a=1&amp;b=2"></head></html>`,
      },
      {
        ct: "text/css",
        cl: "https://f.example.com/c?a=1&b=2",
        body: `@font-face { font-family: "Decoded"; src: url("cid:d"); }`,
      },
    ]);
    expect(extractMainDocumentFamilies(doc)).toEqual(["Decoded"]);
  });

  it("inkluderar inline <style> @font-face i huvuddokumentet", () => {
    const doc = multipartMhtml([
      {
        ct: "text/html",
        cl: "https://example.com/",
        body: `<html><head><style>@font-face { font-family: "InlineFont"; src: url("cid:i") format("woff2"); }</style></head></html>`,
      },
    ]);
    expect(extractMainDocumentFamilies(doc)).toEqual(["InlineFont"]);
  });

  it("följer @import transitivt från en länkad stylesheet", () => {
    const doc = multipartMhtml([
      {
        ct: "text/html",
        cl: "https://example.com/",
        body: `<html><head><link rel="stylesheet" href="https://example.com/a.css"></head></html>`,
      },
      {
        ct: "text/css",
        cl: "https://example.com/a.css",
        body: `@import url("https://example.com/b.css"); body { color: red; }`,
      },
      {
        ct: "text/css",
        cl: "https://example.com/b.css",
        body: `@font-face { font-family: "Imported"; src: url("cid:i"); }`,
      },
    ]);
    expect(extractMainDocumentFamilies(doc)).toEqual(["Imported"]);
  });

  it("returnerar [] när huvuddokumentet inte når någon stylesheet (harness fail-open)", () => {
    const doc = multipartMhtml([
      { ct: "text/html", cl: "https://example.com/", body: `<html><body>hi</body></html>` },
      // Orphan css-part med en font — INTE nåbar från huvuddokumentet.
      {
        ct: "text/css",
        cl: "https://example.com/orphan.css",
        body: `@font-face { font-family: "Orphan"; src: url("cid:o"); }`,
      },
    ]);
    expect(extractMainDocumentFamilies(doc)).toEqual([]);
  });
});

describe("extractFontFaceDiagnostics", () => {
  it("flaggar local-only, remote, och metric-overrides separat", () => {
    const css = `
      @font-face { font-family: "Real"; src: url("cid:a") format("woff2"); }
      @font-face { font-family: "Fallback"; src: local("Arial"); size-adjust: 107%; ascent-override: 90%; }
      @font-face { font-family: "Mixed"; src: local("Arial"), url("cid:b"); }
    `;
    const d = extractFontFaceDiagnostics(mhtml(css));
    expect(d).toHaveLength(3);
    expect(d[0]).toMatchObject({ family: "Real", hasRemoteSrc: true, hasLocalOnly: false, hasMetricOverrides: false });
    expect(d[1]).toMatchObject({ family: "Fallback", hasRemoteSrc: false, hasLocalOnly: true, hasMetricOverrides: true });
    expect(d[2]).toMatchObject({ family: "Mixed", hasRemoteSrc: true, hasLocalOnly: false, hasMetricOverrides: false });
  });
});
