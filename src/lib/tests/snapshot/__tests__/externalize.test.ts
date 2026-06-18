// Pure-function coverage for externalize.server.ts. The remaining functions
// there — uploadAsset / runCli — shell out to the `lovable-assets` CLI and need
// a capture-capable env, so they're exercised operationally, not in unit tests.

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveAssetUrl, sha256OfBuffer } from "../externalize.server";

describe("sha256OfBuffer", () => {
  it("matches the known SHA-256 of 'abc'", () => {
    expect(sha256OfBuffer(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("resolveAssetUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers the committed resolvedUrl (hermetic) when no env override", () => {
    vi.stubEnv("LOVABLE_ASSETS_BASE_URL", undefined); // unset → no override
    expect(
      resolveAssetUrl({
        url: "/a/b.txt",
        project_id: "proj",
        resolvedUrl: "https://committed.example/a/b.txt",
      }),
    ).toBe("https://committed.example/a/b.txt");
  });

  it("env override wins over the committed URL (debug path)", () => {
    vi.stubEnv("LOVABLE_ASSETS_BASE_URL", "https://override.example/");
    expect(
      resolveAssetUrl({
        url: "/a/b.txt",
        project_id: "proj",
        resolvedUrl: "https://committed.example/a/b.txt",
      }),
    ).toBe("https://override.example/a/b.txt");
  });

  it("legacy pointer without resolvedUrl → derived from project_id", () => {
    vi.stubEnv("LOVABLE_ASSETS_BASE_URL", undefined);
    expect(resolveAssetUrl({ url: "/a/b.txt", project_id: "proj" })).toBe(
      "https://id-preview--proj.lovable.app/a/b.txt",
    );
  });
});
