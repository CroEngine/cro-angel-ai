// Commit 1 — tester för delade primitiver `iterateCssParts` + `harvestFontUrls`.
//
// Huvudvakten är DIFFERENTIALTESTET: nya harvestern måste fånga exakt samma
// `https?://`-URL-mängd som gamla `ANY_HTTP_URL_RE` på befintliga fixtures.
// Identitetstestet (normalize(abs)===abs) är en sekundär sanity-check.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
      faceIndex: 0,
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
      faceIndex: 0,
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
      faceIndex: 0,
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

  it("faceIndex spårar @font-face-blockets ordningsposition", () => {
    const css = `
      @font-face{font-family:"A";src:url(https://cdn/a.woff2)}
      @font-face{font-family:"B";src:url(https://cdn/b.woff2), url(https://cdn/b2.woff2)}
      @font-face{font-family:"C";src:url(https://cdn/c.woff2)}
    `;
    const r = harvestOf(css);
    expect(r).toHaveLength(4);
    expect(r.map((u) => u.faceIndex)).toEqual([0, 1, 1, 2]);
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

// =========================================================================
// Commit 3 — strukturell input-equality
// =========================================================================
//
// Test 1: producent-korrekthet — `harvestAllFontUrls` på syntetisk fixture
//         pinnad mot named constants (hink-räkning, resolved per original,
//         unresolvable reasons). Multiplicitet (multi.woff2 + multi.woff =
//         två distinkta tokens) pinnas här.
//
// Test 2: consumption-equality P==M (icke-tautologisk) — på syntetisk
//         fixture + hubspot/page.mhtml: P:s grupperings-/projektionsväg
//         (extractFontFaceDiagnostics → flatMap(f.replayUrls)) mot M:s
//         platta filter (collectEmbedTargets → resolved). Två genuint
//         olika kodvägar — en trasig projektion bryter setet.

import {
  harvestAllFontUrls,
  type HarvestedFontUrl,
} from "../harvest-font-urls";
import {
  collectEmbedTargets,
  extractFontFaceDiagnostics,
} from "../mhtml-fonts.server";
import { SYNTHETIC_FIXTURE_EXPECTED } from "../__fixtures__/synthetic-fonts.expected";

const SYNTHETIC_FIXTURE_PATH = join(
  process.cwd(),
  "src/lib/tests/snapshot/__fixtures__/synthetic-fonts.mhtml",
);

describe("harvestAllFontUrls — producent-korrekthet (syntetisk fixture)", () => {
  const raw = readFileSync(SYNTHETIC_FIXTURE_PATH, "utf8");
  const all = harvestAllFontUrls(raw);

  it("hink-räkning pinnad mot SYNTHETIC_FIXTURE_EXPECTED.counts", () => {
    const counts = {
      embedded: all.filter((u) => u.kind === "embedded").length,
      absolute: all.filter((u) => u.kind === "absolute").length,
      relativeResolved: all.filter((u) => u.kind === "relative-resolved")
        .length,
    };
    expect(counts).toEqual(SYNTHETIC_FIXTURE_EXPECTED.counts);
  });

  it("varje original → exakt resolved enligt named constants", () => {
    const map: Record<string, string> = {};
    for (const u of all) {
      if (u.kind === "absolute" || u.kind === "relative-resolved") {
        map[u.original] = u.resolved;
      }
    }
    expect(map).toEqual(SYNTHETIC_FIXTURE_EXPECTED.resolved);
  });

  it("hink 4 — original + reason pinnad", () => {
    const unresolvable = all
      .filter(
        (u): u is Extract<HarvestedFontUrl, { kind: "relative-unresolvable" }> =>
          u.kind === "relative-unresolvable",
      )
      .map((u) => ({ original: u.original, reason: u.reason }))
      .sort((a, b) => a.original.localeCompare(b.original));
    const expected = [...SYNTHETIC_FIXTURE_EXPECTED.unresolvable].sort(
      (a, b) => a.original.localeCompare(b.original),
    );
    expect(unresolvable).toEqual(expected);
  });

  it("multi-token i samma face räknas som 2 distinkta tokens", () => {
    const multi = all.filter(
      (u) =>
        (u.kind === "absolute" || u.kind === "relative-resolved") &&
        u.original.startsWith("/fonts/multi."),
    );
    expect(multi).toHaveLength(2);
    // delar samma face (samma faceIndex i samma part)
    expect(multi[0].partIndex).toBe(multi[1].partIndex);
    expect(multi[0].faceIndex).toBe(multi[1].faceIndex);
  });

  it("embedded originals pinnade", () => {
    const embedded = all
      .filter((u) => u.kind === "embedded")
      .map((u) => u.original)
      .sort();
    expect(embedded).toEqual(
      [...SYNTHETIC_FIXTURE_EXPECTED.embeddedOriginals].sort(),
    );
  });
});

describe("consumption-equality P==M (icke-tautologisk)", () => {
  it("syntetisk: extractFontFaceDiagnostics.flatMap(replayUrls) ≡ collectEmbedTargets(resolved)", () => {
    const raw = readFileSync(SYNTHETIC_FIXTURE_PATH, "utf8");
    const pReplay = new Set(
      extractFontFaceDiagnostics(raw).flatMap((f) => f.replayUrls),
    );
    const mTargets = new Set(collectEmbedTargets(raw).map((u) => u.resolved));
    expect(mTargets).toEqual(pReplay);
    // Sanity: setet är icke-tomt — annars vore equality trivialt grön.
    expect(mTargets.size).toBeGreaterThan(0);
  });

  // NOT: `corpus/hubspot/page.mhtml` är POST-embed (alla 32 font-URLer är
  // redan `cid:`-rewrittna av A2-passet i freezen). Pre-embed-MHTML skrivs
  // bara till `/tmp/corpus-breadth/<name>/page.pre-embed.mhtml` av
  // breadth-smoke, inte committad. På post-embed-input blir både pReplay
  // och mTargets tomma → equality vore tautologiskt grön och vaktar
  // ingenting. Tills en pre-embed-fixture finns i repo bär den syntetiska
  // fixturen ovan hela Test 2-lasten. Det räcker — den exerverar P:s
  // grupperings-/projektionsväg mot M:s platta filter på en input som
  // genuint innehåller hink 2 ∪ 3.
  //
  // Differential-testet ovan ("real corpus: hubspot/page.mhtml — gamla
  // regex-mängden bevaras exakt") fortsätter att skydda mot regression i
  // den befintliga (post-embed) HubSpot-fixturens behandling.
});

// =========================================================================
// Test 3 — real-corpus P==M consumption-equality
// =========================================================================
//
// Vaktar harvest/projektions-invarianten på `corpus/<name>/page.pre-embed.mhtml`
// (rå captureSnapshot, externa font-URLer kvar — inte post-embed cid:-output).
// Deterministisk, Playwright-fri, auto-curating: ny fixture committas →
// suiten plockar upp den. Ingen golden-fil, ingen per-sajt-konstant att
// uppdatera vid CSS-churn.
//
// Tre design-låsningar:
//   1. Repo-rotsankrad sökväg (fileURLToPath), inte process.cwd() — fel
//      CWD ska inte tyst skip:a sviten.
//   2. KNOWN_REMOTE_FONT_CORPORA-allowlist gata icke-vakuiteten (>0).
//      Legitimt font-lösa sajter (system-stack / pure local()) ska kunna
//      committas utan att tvingas in i allowlisten.
//   3. Skip→fail-flip: så fort ≥1 allowlistad pre-embed är committad får
//      en framtida radering INTE tyst återgå till skip-grön.

const __filenameLocal = fileURLToPath(import.meta.url);
// __tests__ → snapshot → tests → lib → src → repo-root
const CORPUS_ROOT = join(dirname(__filenameLocal), "..", "..", "..", "..", "..", "corpus");

// Korpora där vi vet att harvesten ska producera externa URLer (innan
// A2-embedding). Lägg till sajter när de re-freezas med pre-embed-skrivning.
// Font-lösa sajter (system-stack / pure local()) hör INTE hit.
const KNOWN_REMOTE_FONT_CORPORA = new Set<string>([
  "hubspot",
  "hibob",
  // "vercel", "intercom", ... lägg till efter re-freeze
]);

describe("real-corpus P==M (page.pre-embed.mhtml)", () => {
  const allCorpora = existsSync(CORPUS_ROOT)
    ? readdirSync(CORPUS_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  const discovered = allCorpora.filter((name) =>
    existsSync(join(CORPUS_ROOT, name, "page.pre-embed.mhtml")),
  );
  const allowlistedDiscovered = discovered.filter((n) =>
    KNOWN_REMOTE_FONT_CORPORA.has(n),
  );

  if (discovered.length === 0) {
    it.skip("ingen page.pre-embed.mhtml committad än — re-freeze krävs", () => {});
    return;
  }

  // Skip→fail-flip: så fort minst en allowlistad pre-embed finns kräver vi
  // att hela allowlisten är committad. Under övergången (innan första
  // re-freeze av en allowlistad sajt) är allowlistedDiscovered tom och
  // testet passerar tyst.
  it("allowlistade KNOWN_REMOTE_FONT_CORPORA har sina pre-embed-fixturer committade", () => {
    if (allowlistedDiscovered.length === 0) return;
    const missing = [...KNOWN_REMOTE_FONT_CORPORA].filter(
      (n) => !existsSync(join(CORPUS_ROOT, n, "page.pre-embed.mhtml")),
    );
    expect(missing).toEqual([]);
  });

  for (const name of discovered) {
    it(`${name}: extractFontFaceDiagnostics.flatMap(replayUrls) ≡ collectEmbedTargets(resolved)`, () => {
      const raw = readFileSync(
        join(CORPUS_ROOT, name, "page.pre-embed.mhtml"),
        "utf8",
      );
      const pReplay = new Set(
        extractFontFaceDiagnostics(raw).flatMap((f) => f.replayUrls),
      );
      const mTargets = new Set(
        collectEmbedTargets(raw).map((u) => u.resolved),
      );
      // Invarianten — alltid.
      expect(mTargets).toEqual(pReplay);
      // Icke-vakuitet — bara där vi vet att externa URLer ska finnas.
      // Fångar per-sajt tyst-harvest-död (harvest dör på just denna CSS →
      // båda tomma → toEqual passerar trivialt).
      if (KNOWN_REMOTE_FONT_CORPORA.has(name)) {
        expect(mTargets.size).toBeGreaterThan(0);
      }
    });
  }
});

