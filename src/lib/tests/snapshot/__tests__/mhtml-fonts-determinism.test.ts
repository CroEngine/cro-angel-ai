// F1 — deterministiska font-cids + stabil append-ordning.
//
// Bakgrund: embedMhtmlFonts myntade tidigare cid via randomUUID() → varje freeze
// fick nya `cid:font-…@snapshot`-tokens. De maskas INTE av normalizeMhtml (bara
// Chromiums `@mhtml.blink`-cids är whitelistade), så de surfade som
// capture-determinism-drift (Grind 1) på varje font-rad. Dessutom byggdes
// urlToBinary i fetch-completion-ordning → append-ordningen i post-embed-MHTML
// berodde på nätverkstiming. Fixen: innehållsadresserade cids (sha256 av
// resolved URL) + harvest-ordnad append.
//
// Testet är NÄTVERKSFRITT: global fetch stubbas så embedding faktiskt sker
// (utan lyckad fetch hamnar cids aldrig i outputen → testet vore vakuöst).

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { embedMhtmlFonts, cidForFontUrl } from "../mhtml-fonts.server";

const SYNTHETIC_FIXTURE_PATH = join(
  process.cwd(),
  "src/lib/tests/snapshot/__fixtures__/synthetic-fonts.mhtml",
);

describe("cidForFontUrl — innehållsadresserad, deterministisk", () => {
  it("samma URL → samma cid", () => {
    const u = "https://synthetic.test/fonts/a.woff2";
    expect(cidForFontUrl(u)).toBe(cidForFontUrl(u));
  });

  it("cid = font-<sha256(resolved)[0:16]>@snapshot (innehållsadresserad, inte slumpad)", () => {
    const u = "https://synthetic.test/fonts/a.woff2";
    const expected = `font-${createHash("sha256").update(u).digest("hex").slice(0, 16)}@snapshot`;
    expect(cidForFontUrl(u)).toBe(expected);
  });

  it("olika URL → olika cid", () => {
    expect(cidForFontUrl("https://x/a.woff2")).not.toBe(
      cidForFontUrl("https://x/b.woff2"),
    );
  });

  it("behåller formen cid:font-<16hex>@snapshot (downstream-regex)", () => {
    expect(cidForFontUrl("https://x/a.woff2")).toMatch(
      /^font-[0-9a-f]{16}@snapshot$/,
    );
  });
});

describe("embedMhtmlFonts — capture-determinism (oberoende pass → byte-identiskt)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("två embed-pass ger byte-identisk MHTML trots olika fetch-completion-ordning", async () => {
    const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]); // "wOF2"+pad

    // Fas-styrd fördröjning: pass 1 resolver i harvest-ordning, pass 2 i omvänd
    // ordning (delay 100-i). En korrekt impl (innehållsadresserade cids +
    // harvest-ordnad append) är ordnings-invariant → identiska bytes. En
    // regression till slumpade cids ELLER completion-ordnad append driftar.
    let phase = 0;
    let seq = 0;
    vi.stubGlobal("fetch", async () => {
      const i = seq++;
      const delayMs = phase === 0 ? i : 100 - i;
      await new Promise((r) => setTimeout(r, Math.max(0, delayMs)));
      // Minimal Response-lik form som classifiedFetch konsumerar — undviker
      // beroende på global Response i testmiljön.
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => fontBytes.buffer.slice(0),
      };
    });

    const raw = readFileSync(SYNTHETIC_FIXTURE_PATH, "utf8");
    phase = 0;
    seq = 0;
    const a = await embedMhtmlFonts(raw);
    phase = 1;
    seq = 0;
    const b = await embedMhtmlFonts(raw);

    // Icke-vakuöst: embedding skedde faktiskt (annars vore byte-likhet meningslös).
    expect(a.embeddedFontCount).toBeGreaterThan(0);
    expect(a.mhtml).toContain("cid:font-");

    // Kärnegenskapen: reproducerbar output oberoende av nätverkstiming.
    expect(b.mhtml).toBe(a.mhtml);
    expect(b.embeddedFamilies).toEqual(a.embeddedFamilies);
  });

  it("cids i outputen är härledda ur resolved URL (inte slumpade)", async () => {
    const fontBytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 9, 8, 7, 6]);
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => fontBytes.buffer.slice(0),
    }));

    const raw = readFileSync(SYNTHETIC_FIXTURE_PATH, "utf8");
    const r = await embedMhtmlFonts(raw);

    // Varje fetchad resolved URL ska ha sin innehållsadresserade cid i MHTML:en.
    for (const url of r.fontUrlsSeen) {
      expect(r.mhtml).toContain(`cid:${cidForFontUrl(url)}`);
    }
  });
});
