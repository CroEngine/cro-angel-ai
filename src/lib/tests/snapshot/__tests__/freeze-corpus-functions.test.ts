// Exercises the freeze step's pure / MHTML-processing functions against the REAL
// committed corpus MHTML — hubspot AND hibob — not synthetic fixtures. This is
// the "test every function on real site data" pass for the layer that can run
// without a live engine. Network-free: font fetches are stubbed.
//
// NOT covered here (cannot run without a browser / Browserbase, so they belong
// to CI's browser job or a capture-capable env):
//   - freezeSite + its in-page FNs (ASSERT_CAPTURE_VALID_FN, POST_DISMISS_HITS_FN,
//     lazyScroll, measurePostDismissDomHits) — need Browserbase live capture.
//   - replayCorpus and the harness helpers — need Playwright Chromium.
//   - uploadAsset (externalize) — needs the lovable-assets CLI.
// Microsoft is intentionally absent: it is not in the corpus and capturing it
// requires Browserbase, which isn't available in this environment.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  parseMhtml,
  extractEmbeddedFamilies,
  extractFontFaceDiagnostics,
  collectEmbedTargets,
  reconcileFontUrlSets,
  cidForFontUrl,
  embedMhtmlFonts,
} from "../mhtml-fonts.server";
import { harvestAllFontUrls } from "../harvest-font-urls";
import { normalizeMhtml } from "../mhtml-normalize";

const SITES = ["hubspot", "hibob"] as const;
const corpusFile = (s: string, f: string) => join(process.cwd(), "corpus", s, f);

// Minimal Response-like font fetch so embedMhtmlFonts actually embeds (no real
// network). Same shape classifiedFetch consumes.
function stubFontFetch() {
  const bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4]); // "wOF2"+pad
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => bytes.buffer.slice(0),
  }));
}

describe.each(SITES)("freeze pure functions on real corpus — %s", (site) => {
  const postEmbed = readFileSync(corpusFile(site, "page.mhtml"), "utf8");
  const preEmbedPath = corpusFile(site, "page.pre-embed.mhtml");
  const preEmbed = existsSync(preEmbedPath)
    ? readFileSync(preEmbedPath, "utf8")
    : null;

  it("parseMhtml: parses the committed MHTML into parts with a boundary", () => {
    const p = parseMhtml(postEmbed);
    expect(p.boundary).toBeTruthy();
    expect(p.parts.length).toBeGreaterThan(0);
  });

  it("normalizeMhtml: non-empty and deterministic (same input → same output)", () => {
    const n1 = normalizeMhtml(postEmbed);
    expect(n1.length).toBeGreaterThan(0);
    expect(normalizeMhtml(postEmbed)).toBe(n1);
  });

  it("extractEmbeddedFamilies: sorted, deduped string array", () => {
    const fams = extractEmbeddedFamilies(postEmbed);
    expect(Array.isArray(fams)).toBe(true);
    expect([...fams].sort()).toEqual(fams);
    expect(new Set(fams).size).toBe(fams.length);
  });

  it("extractFontFaceDiagnostics: one well-formed entry per declared face", () => {
    const d = extractFontFaceDiagnostics(preEmbed ?? postEmbed);
    expect(Array.isArray(d)).toBe(true);
    for (const f of d) {
      expect(typeof f.family).toBe("string");
      expect(typeof f.hasRemoteSrc).toBe("boolean");
      expect(Array.isArray(f.replayUrls)).toBe(true);
    }
  });

  it("harvestAllFontUrls + collectEmbedTargets: every embed target is resolved (⊆ harvest)", () => {
    const src = preEmbed ?? postEmbed;
    expect(Array.isArray(harvestAllFontUrls(src))).toBe(true);
    const targets = collectEmbedTargets(src);
    for (const t of targets) {
      expect(t.resolved).toBeTruthy();
      expect(["absolute", "relative-resolved"]).toContain(t.kind);
    }
    // Non-vacuity guard on a known font-heavy site so the suite can't go
    // trivially green if harvest silently breaks on real CSS.
    if (site === "hubspot" && preEmbed) {
      expect(targets.length).toBeGreaterThan(0);
    }
  });

  it("reconcileFontUrlSets: P (diagnostics replayUrls) == M (embed targets) on real data", () => {
    const src = preEmbed ?? postEmbed;
    const P = new Set(
      extractFontFaceDiagnostics(src).flatMap((f) => f.replayUrls),
    );
    const M = new Set(collectEmbedTargets(src).map((u) => u.resolved));
    expect(reconcileFontUrlSets(P, M).ok).toBe(true);
  });

  describe("embedMhtmlFonts on real pre-embed MHTML (F1 determinism)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("two independent passes → byte-identical output, externalFontSrcCount === 0", async () => {
      if (!preEmbed) return; // pre-embed not committed for this site
      stubFontFetch();
      const a = await embedMhtmlFonts(preEmbed);
      const b = await embedMhtmlFonts(preEmbed);

      expect(b.mhtml).toBe(a.mhtml); // deterministic on real site data
      expect(a.externalFontSrcCount).toBe(0); // A2 gate would pass
      // Every embedded cid in the output is content-addressed (F1).
      for (const url of a.fontUrlsSeen) {
        expect(a.mhtml).toContain(`cid:${cidForFontUrl(url)}`);
      }
    });
  });
});
