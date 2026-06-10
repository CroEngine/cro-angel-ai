// Unit-test: extractEmbeddedFamilies parsar @font-face font-family ur en MHTML.
// Täcker citerings-varianter (", ', okvoterad) och fallback-listor.

import { describe, it, expect } from "vitest";

import { extractEmbeddedFamilies } from "../mhtml-fonts.server";

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
