// Commit 1 — tester för delade primitiver `iterateCssParts` + `harvestFontUrls`.
//
// Huvudvakten är DIFFERENTIALTESTET: nya harvestern måste fånga exakt samma
// `https?://`-URL-mängd som gamla `ANY_HTTP_URL_RE` på befintliga fixtures.
// Identitetstestet (normalize(abs)===abs) är en sekundär sanity-check.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  iterateCssParts,
  harvestFontUrls,
  type NormalizedFontUrl,
} from "../harvest-font-urls";

// Bygger en minimal MHTML med en text/html-tom-shell + en text/css-part
// (med valfri Content-Location). 8bit, ingen QP.
function mhtmlOf(
  cssBody: string,
  contentLocation: string | undefined,
): string {
  const boundary = "----TEST";
  const cssHeaders = [
    `Content-Type: text/css`,
    `Content-Transfer-Encoding: 8bit`,
  ];
  if (contentLocation) cssHeaders.push(`Content-Location: ${contentLocation}`);
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
    ...cssHeaders,
    ``,
    cssBody,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

// Tunn helper: hämta första (och oftast enda) CSS-partens harvest.
function harvestOf(
  cssBody: string,
  contentLocation?: string,
): NormalizedFontUrl[] {
  const parts = iterateCssParts(mhtmlOf(cssBody, contentLocation));
  expect(parts.length).toBeGreaterThan(0);
  return harvestFontUrls(parts[0].css, parts[0].contentLocation);
}

// Gamla regexet — KOPIERAT verbatim från mhtml-fonts.server.ts för
// differential-jämförelse. Får inte importeras; vi vill att en framtida
// refaktor av det interna regexet inte tyst påverkar denna jämförelse.
const OLD_ANY_HTTP_URL_RE =
  /url\(\s*(['"]?)(https?:\/\/[^)'"\s]+?)\1\s*\)/gi;

function oldRegexUrls(cssBody: string): Set<string> {
  const out = new Set<string>();
  for (const m of cssBody.matchAll(OLD_ANY_HTTP_URL_RE)) out.add(m[2]);
  return out;
}

describe("iterateCssParts", () => {
  it("returnerar text/css-part med @font-face och dess Content-Location", () => {
    const css = `@font-face{font-family:"X";src:url(https://cdn/x.woff2)}`;
    const parts = iterateCssParts(mhtmlOf(css, "https://example.com/main.css"));
    expect(parts).toHaveLength(1);
    expect(parts[0].css).toContain("@font-face");
    expect(parts[0].contentLocation).toBe("https://example.com/main.css");
  });

  it("hoppar parts utan @font-face", () => {
    const css = `.x{color:red}`;
    const parts = iterateCssParts(mhtmlOf(css, "https://x/"));
    expect(parts).toHaveLength(0);
  });
});

describe("harvestFontUrls — klassificering per hink", () => {
  it("hink 1: data:-url → embedded", () => {
    const r = harvestOf(
      `@font-face{font-family:"E";src:url(data:font/woff2;base64,AAA=)}`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "embedded" });
  });

  it("hink 1: cid:-url → embedded", () => {
    const r = harvestOf(
      `@font-face{font-family:"E";src:url(cid:font-abc@snapshot)}`,
    );
    expect(r[0]).toMatchObject({ kind: "embedded" });
  });

  it("hink 2: absolut https → resolved === original (identitet)", () => {
    const r = harvestOf(
      `@font-face{font-family:"A";src:url(https://cdn/x.woff2)}`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "absolute",
      original: "https://cdn/x.woff2",
      resolved: "https://cdn/x.woff2",
    });
  });

  it("hink 2 via protokoll-relativ: //cdn/x + https-bas → resolved=https://cdn/x", () => {
    const r = harvestOf(
      `@font-face{font-family:"P";src:url(//cdn/x.woff2)}`,
      "https://example.com/main.css",
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({
      kind: "relative-resolved",
      original: "//cdn/x.woff2",
      resolved: "https://cdn/x.woff2",
      base: "https://example.com/main.css",
    });
  });

  it("hink 3: root-relativ /x + bas → korrekt resolved", () => {
    const r = harvestOf(
      `@font-face{font-family:"R";src:url(/fonts/x.woff2)}`,
      "https://example.com/dir/main.css",
    );
    expect(r[0]).toMatchObject({
      kind: "relative-resolved",
      resolved: "https://example.com/fonts/x.woff2",
    });
  });

  it("hink 3: path-relativ x och ../x + bas → korrekt resolved", () => {
    const r1 = harvestOf(
      `@font-face{font-family:"R";src:url(x.woff2)}`,
      "https://example.com/dir/main.css",
    );
    expect(r1[0]).toMatchObject({
      kind: "relative-resolved",
      resolved: "https://example.com/dir/x.woff2",
    });
    const r2 = harvestOf(
      `@font-face{font-family:"R";src:url(../x.woff2)}`,
      "https://example.com/dir/main.css",
    );
    expect(r2[0]).toMatchObject({
      kind: "relative-resolved",
      resolved: "https://example.com/x.woff2",
    });
  });

  it("hink 4: relativ utan base → unresolvable, reason=no-base", () => {
    const r = harvestOf(
      `@font-face{font-family:"U";src:url(/fonts/x.woff2)}`,
      undefined,
    );
    expect(r[0]).toEqual({
      kind: "relative-unresolvable",
      original: "/fonts/x.woff2",
      reason: "no-base",
    });
  });

  it("hink 4: relativ med ogiltig base → unresolvable, reason=invalid-base", () => {
    const r = harvestOf(
      `@font-face{font-family:"U";src:url(/fonts/x.woff2)}`,
      "not a url",
    );
    expect(r[0]).toEqual({
      kind: "relative-unresolvable",
      original: "/fonts/x.woff2",
      reason: "invalid-base",
    });
  });
});

describe("harvestFontUrls — tokeniserings-grammatik", () => {
  it("local() ignoreras (inte url())", () => {
    const r = harvestOf(
      `@font-face{font-family:"L";src:local("Sys"), url(https://cdn/x.woff2)}`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "absolute" });
  });

  it("multi-url ger N tokens i ordning", () => {
    const r = harvestOf(
      `@font-face{font-family:"M";src:url(https://cdn/a.woff2) format("woff2"), url(https://cdn/b.woff) format("woff")}`,
    );
    expect(r).toHaveLength(2);
    expect((r[0] as { resolved: string }).resolved).toBe(
      "https://cdn/a.woff2",
    );
    expect((r[1] as { resolved: string }).resolved).toBe("https://cdn/b.woff");
  });

  it("format() / tech() argument exkluderas från token", () => {
    const r = harvestOf(
      `@font-face{font-family:"F";src:url(https://cdn/x.woff2) format("woff2") tech("variations")}`,
    );
    expect(r).toHaveLength(1);
    expect((r[0] as { original: string }).original).toBe(
      "https://cdn/x.woff2",
    );
  });

  it("url(data:…==) ger hink 1, inte trasig token", () => {
    const r = harvestOf(
      `@font-face{font-family:"D";src:url(data:font/woff2;base64,QUFB==)}`,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      kind: "embedded",
      original: "data:font/woff2;base64,QUFB==",
    });
  });

  it("kvoterad och okvoterad form klassas identiskt", () => {
    const css = `
      @font-face{font-family:"Q1";src:url("https://cdn/a.woff2")}
      @font-face{font-family:"Q2";src:url('https://cdn/a.woff2')}
      @font-face{font-family:"Q3";src:url(https://cdn/a.woff2)}
    `;
    const r = harvestOf(css);
    expect(r).toHaveLength(3);
    for (const u of r) {
      expect(u).toMatchObject({
        kind: "absolute",
        original: "https://cdn/a.woff2",
        resolved: "https://cdn/a.woff2",
      });
    }
  });

  it("background-image-url() utanför @font-face ignoreras", () => {
    const css = `
      .hero{background-image:url(https://cdn/bg.png)}
      @font-face{font-family:"F";src:url(https://cdn/x.woff2)}
    `;
    const r = harvestOf(css);
    expect(r).toHaveLength(1);
    expect((r[0] as { original: string }).original).toBe(
      "https://cdn/x.woff2",
    );
  });
});

// =========================================================================
// HUVUDVAKTEN: differentialtest mot gamla `ANY_HTTP_URL_RE`.
// =========================================================================
//
// Skydd för de URL-mängder som redan fungerar: nya harvestern måste
// reproducera den exakta `https?://`-mängden gamla regexet såg. Den får
// UTÖKA universumet (protokoll-relativa, relativa) — men aldrig droppa
// eller mutera en absolut https?://-URL.
//
// Påståenden:
//   oldRegexSet ⊆ newHttpHttpsSet
//   newHttpHttpsSet ∩ {^https?://} === oldRegexSet  (ingen ny https-url
//   som inte fanns i gamla regexets bild av samma input)

describe("harvestFontUrls — differential vs ANY_HTTP_URL_RE (huvudvakten)", () => {
  // Lokala syntetiska CSS-block som motsvarar de mönster gamla regexet
  // garanterat fångar (https?:// kvoterad och okvoterad, utan ext-restriktion).
  const SYNTHETIC_CASES: Array<{ name: string; css: string }> = [
    {
      name: "absolut https kvoterad",
      css: `@font-face{font-family:"A";src:url("https://cdn.example.com/a.woff2")}`,
    },
    {
      name: "absolut https okvoterad",
      css: `@font-face{font-family:"B";src:url(https://cdn.example.com/b.woff2)}`,
    },
    {
      name: "absolut http enkelkvoterad",
      css: `@font-face{font-family:"C";src:url('http://cdn.example.com/c.woff2')}`,
    },
    {
      name: "multi-url med format()",
      css: `@font-face{font-family:"D";src:url(https://cdn/a.woff2) format("woff2"), url(https://cdn/b.woff) format("woff")}`,
    },
    {
      name: "url utan font-ext (CDN utan filändelse)",
      css: `@font-face{font-family:"E";src:url(https://cdn.example.com/font?id=42)}`,
    },
  ];

  for (const c of SYNTHETIC_CASES) {
    it(`syntetiskt: ${c.name} — nya hink2 ≡ gamla regex-mängd`, () => {
      const harvested = harvestOf(c.css);
      const newHttp = new Set(
        harvested
          .filter(
            (u): u is Extract<NormalizedFontUrl, { kind: "absolute" }> =>
              u.kind === "absolute",
          )
          .map((u) => u.resolved),
      );
      const oldSet = oldRegexUrls(c.css);
      // oldRegexSet ⊆ newHttpHttpsSet
      for (const u of oldSet) {
        expect(newHttp.has(u)).toBe(true);
      }
      // newHttpHttpsSet ∩ {^https?://} === oldRegexSet  (modulo att alla
      // newHttp redan är https?:// per kind=absolute-villkoret)
      expect([...newHttp].sort()).toEqual([...oldSet].sort());
    });
  }

  it("real corpus: hubspot/page.mhtml — gamla regex-mängden bevaras exakt", () => {
    const fixture = join(process.cwd(), "corpus/hubspot/page.mhtml");
    if (!existsSync(fixture)) {
      // Frysartefakten saknas i denna miljö — testet är vägledande, inte krav.
      return;
    }
    const raw = readFileSync(fixture, "utf8");
    const parts = iterateCssParts(raw);
    expect(parts.length).toBeGreaterThan(0);

    // Aggregera över alla CSS-parts.
    const newHttp = new Set<string>();
    for (const p of parts) {
      for (const u of harvestFontUrls(p.css, p.contentLocation)) {
        if (u.kind === "absolute") newHttp.add(u.resolved);
      }
    }
    // Gamla regexet, applicerat på SAMMA decoded CSS-parts.
    const oldSet = new Set<string>();
    for (const p of parts) {
      for (const u of oldRegexUrls(p.css)) oldSet.add(u);
    }

    // oldRegexSet ⊆ newHttp (ingen https-url försvinner)
    const missingFromNew = [...oldSet].filter((u) => !newHttp.has(u));
    expect(missingFromNew).toEqual([]);
    // newHttp ∩ {^https?://} === oldSet (ingen ny https-url har materialiserats
    // ur tomma luften — `kind: absolute` är redan exakt https?://-filtret).
    expect([...newHttp].sort()).toEqual([...oldSet].sort());
  });
});
