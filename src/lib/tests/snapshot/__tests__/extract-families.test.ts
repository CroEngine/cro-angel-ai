// Unit-test: extractEmbeddedFamilies parsar @font-face font-family ur en MHTML.
// Täcker citerings-varianter (", ', okvoterad) och fallback-listor.

import { describe, it, expect } from "vitest";

import {
  extractEmbeddedFamilies,
  extractFontFaceDiagnostics,
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

describe("extractFontFaceDiagnostics", () => {
  it("flaggar local-only, remote, och metric-overrides separat", () => {
    const css = `
      @font-face { font-family: "Real"; src: url("cid:a") format("woff2"); }
      @font-face { font-family: "Fallback"; src: local("Arial"); size-adjust: 107%; ascent-override: 90%; }
      @font-face { font-family: "Mixed"; src: local("Arial"), url("cid:b"); }
    `;
    const d = extractFontFaceDiagnostics(mhtml(css));
    expect(d).toEqual([
      { family: "Real", hasRemoteSrc: true, hasLocalOnly: false, hasMetricOverrides: false },
      { family: "Fallback", hasRemoteSrc: false, hasLocalOnly: true, hasMetricOverrides: true },
      { family: "Mixed", hasRemoteSrc: true, hasLocalOnly: false, hasMetricOverrides: false },
    ]);
  });
});
