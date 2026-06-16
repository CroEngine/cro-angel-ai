// B2b — unit tests för FontFetchRecord-instrumenteringen.
// Mockar globalThis.fetch så vi inte är beroende av sandbox-egress.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  embedMhtmlFonts,
  extractFontFaceDiagnostics,
  reconcileFontUrlSets,
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

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.restoreAllMocks();
});

function fontBuf(byte = 0x77): ArrayBuffer {
  return new Uint8Array([byte, byte, byte, byte]).buffer;
}

describe("embedMhtmlFonts fetchRecords", () => {
  it("404 → http_error med httpStatus och error ifyllt", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("nope", { status: 404, headers: new Headers() }),
    ) as typeof fetch;
    const css = `@font-face { font-family: "X"; src: url(https://cdn.example.com/x.woff2); }`;
    const r = await embedMhtmlFonts(mhtml(css));
    expect(r.fetchRecords).toHaveLength(1);
    const rec = r.fetchRecords[0];
    expect(rec.outcome).toBe("http_error");
    expect(rec.httpStatus).toBe(404);
    expect(rec.attempted).toBe(true);
    expect(rec.error).toBeTruthy();
  });

  it("URL utan font-ext → skipped_ext, attempted=false, ingen fetch", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const css = `@font-face { font-family: "Y"; src: url(https://cdn.example.com/font); }`;
    const r = await embedMhtmlFonts(mhtml(css));
    expect(r.fetchRecords).toHaveLength(1);
    expect(r.fetchRecords[0].outcome).toBe("skipped_ext");
    expect(r.fetchRecords[0].attempted).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("kastande fetch → network_error med error/errorCode", async () => {
    globalThis.fetch = vi.fn(async () => {
      const e = new Error("connect ENOTFOUND foo.bar") as Error & { code?: string };
      e.code = "ENOTFOUND";
      throw e;
    }) as typeof fetch;
    const css = `@font-face { font-family: "Z"; src: url(https://nope.invalid/z.woff2); }`;
    const r = await embedMhtmlFonts(mhtml(css));
    expect(r.fetchRecords[0].outcome).toBe("network_error");
    expect(r.fetchRecords[0].error).toContain("ENOTFOUND");
    expect(r.fetchRecords[0].errorCode).toBe("ENOTFOUND");
  });

  it("x-deny-reason-header → env_blocked + proxyDenyReason", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("blocked", {
        status: 403,
        headers: new Headers({ "x-deny-reason": "host-not-allowlisted" }),
      }),
    ) as typeof fetch;
    const css = `@font-face { font-family: "A"; src: url(https://blocked.example.com/a.woff2); }`;
    const r = await embedMhtmlFonts(mhtml(css));
    expect(r.fetchRecords[0].outcome).toBe("env_blocked");
    expect(r.fetchRecords[0].proxyDenyReason).toContain("host-not-allowlisted");
  });

  it("dedup → första förekomst fetchas, andra blir skipped_dedup", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response(fontBuf(), { status: 200, headers: new Headers() });
    }) as typeof fetch;
    const css = `
      @font-face { font-family: "Dup1"; src: url(https://cdn.example.com/d.woff2); }
      @font-face { font-family: "Dup2"; src: url(https://cdn.example.com/d.woff2); }
    `;
    const r = await embedMhtmlFonts(mhtml(css));
    expect(r.fetchRecords).toHaveLength(2);
    expect(r.totalHarvestedOccurrences).toBe(2);
    expect(r.fetchRecords[0].outcome).toBe("ok");
    expect(r.fetchRecords[0].attempted).toBe(true);
    expect(r.fetchRecords[1].outcome).toBe("skipped_dedup");
    expect(r.fetchRecords[1].attempted).toBe(false);
    expect(calls).toBe(1);
  });

  it("completeness-invariant: en record per förekomst", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(fontBuf(), { status: 200, headers: new Headers() }),
    ) as typeof fetch;
    const css = `
      @font-face { font-family: "M1"; src: url(https://cdn.example.com/a.woff2); }
      @font-face { font-family: "M2"; src: url(https://cdn.example.com/b.woff2); }
      @font-face { font-family: "M3"; src: url(https://cdn.example.com/a.woff2); }
    `;
    const r = await embedMhtmlFonts(mhtml(css));
    expect(r.fetchRecords.length).toBe(r.totalHarvestedOccurrences);
    expect(r.fetchRecords.length).toBe(3);
    expect(new Set(r.fetchRecords.map((x) => x.url)).size).toBe(2);
    const dedup = r.fetchRecords.filter((x) => x.outcome === "skipped_dedup");
    expect(dedup).toHaveLength(1);
  });
});

describe("embedMhtmlFonts controlProbes", () => {
  it("kör positiv + negativ probe och returnerar båda", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("gstatic")) {
        return new Response(fontBuf(), { status: 200, headers: new Headers() });
      }
      if (url.includes("example.com")) {
        return new Response("ok", { status: 200, headers: new Headers() });
      }
      return new Response(fontBuf(), { status: 200, headers: new Headers() });
    }) as typeof fetch;
    const css = `@font-face { font-family: "P"; src: url(https://cdn.example.com/p.woff2); }`;
    const r = await embedMhtmlFonts(mhtml(css), { controlProbes: {} });
    expect(r.controlProbes).toBeTruthy();
    expect(r.controlProbes!.positive.outcome).toBe("ok");
    expect(r.controlProbes!.negative.outcome).toBe("ok");
    expect(r.controlProbes!.positive.kind).toBe("positive");
    expect(r.controlProbes!.negative.kind).toBe("negative");
  });

  it("kastar om negativ probe-host står på font-CDN-denylistan", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(fontBuf(), { status: 200, headers: new Headers() }),
    ) as typeof fetch;
    const css = `@font-face { font-family: "Q"; src: url(https://cdn.example.com/q.woff2); }`;
    await expect(
      embedMhtmlFonts(mhtml(css), {
        controlProbes: { negativeUrl: "https://fonts.gstatic.com/probe.woff2" },
      }),
    ).rejects.toThrow(/denylist/i);
  });
});

describe("extractFontFaceDiagnostics replay-url oracle", () => {
  it("face med endast relativ url() utan base → hasUnresolvableRelativeUrl, inga replayUrls", () => {
    const css = `@font-face { font-family: "Rel"; src: url("/fonts/x.woff2"); }`;
    const diags = extractFontFaceDiagnostics(mhtml(css));
    expect(diags).toHaveLength(1);
    expect(diags[0].hasUnresolvableRelativeUrl).toBe(true);
    expect(diags[0].hasAbsoluteHttpUrl).toBe(false);
    expect(diags[0].replayUrls).toEqual([]);
    expect(diags[0].unresolvableUrls).toHaveLength(1);
  });

  it("face med https url() → hasAbsoluteHttpUrl, replayUrls bevarad", () => {
    const css = `@font-face { font-family: "Abs"; src: url("https://cdn.example/x.woff2"); }`;
    const diags = extractFontFaceDiagnostics(mhtml(css));
    expect(diags).toHaveLength(1);
    expect(diags[0].hasAbsoluteHttpUrl).toBe(true);
    expect(diags[0].hasUnresolvableRelativeUrl).toBe(false);
    expect(diags[0].replayUrls).toEqual(["https://cdn.example/x.woff2"]);
  });

  it("protokoll-relativ //-url utan Content-Location → hink 4 unresolvable på BÅDA sidor (P==M trivialt)", async () => {
    // Post-unifiering: båda P och M klassificerar //cdn/x utan base som
    // hink 4 (no-base). Replay-mängden är tom på båda sidor → invarianten
    // är trivialt OK; receipt fångar problemet via unresolvableRelativeUrls.
    const css = `@font-face { font-family: "Proto"; src: url(//cdn.example/proto-rel.woff2); }`;
    const fixture = mhtml(css);

    const diags = extractFontFaceDiagnostics(fixture);
    const oracleReplay = new Set<string>();
    for (const d of diags) for (const u of d.replayUrls) oracleReplay.add(u);
    expect(oracleReplay.size).toBe(0);
    expect(diags[0].unresolvableUrls).toEqual([
      { original: "//cdn.example/proto-rel.woff2", reason: "no-base" },
    ]);

    const r = await embedMhtmlFonts(fixture);
    const fetcherUrls = new Set(r.fetchRecords.map((x) => x.url));
    expect(fetcherUrls.size).toBe(0);
    expect(r.unresolvableRelativeUrls).toHaveLength(1);
    expect(r.unresolvableRelativeUrls[0]).toMatchObject({
      original: "//cdn.example/proto-rel.woff2",
      reason: "no-base",
    });

    // Invarianten är grön över hink 2 ∪ 3; hink 4 fångas av receipten.
    const recon = reconcileFontUrlSets(oracleReplay, fetcherUrls);
    expect(recon.ok).toBe(true);
  });
});
