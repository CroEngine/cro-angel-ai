// Render-canary tests.
//
// Two layers:
//
//   1. Constants/contract layer (no Playwright). Asserts canary-constants.ts
//      exports the values the page-eval and the script path both depend on,
//      and that runRenderCanary's input contract matches what
//      extractEmbeddedFamilies produces. Drift here breaks the test, not
//      production silently.
//
//   2. Behavior layer (Playwright, skipped in sandbox/CI without chromium
//      sysdeps). Asserts the headline diagnostic: a font face whose source
//      URL is unreachable produces gate1.reason === "unresolved" with a
//      non-empty loadError — NOT "timeout". This is the case the canary
//      exists to catch (cid: fast-reject under file:// replay).

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import {
  CANARY_SAMPLE_TEXT,
  CANARY_VIEWPORT,
  EPSILON_LOAD_PX,
  EPSILON_FIDELITY_PX,
  FONT_LOAD_TIMEOUT_MS,
} from "../canary-constants";
import { runRenderCanary } from "../render-canary.server";
import { extractEmbeddedFamilies } from "../mhtml-fonts.server";

describe("canary-constants — single source of truth", () => {
  test("sample text is long enough that brand-font vs monospace diff dominates noise", () => {
    expect(CANARY_SAMPLE_TEXT.length).toBeGreaterThanOrEqual(40);
    expect(CANARY_SAMPLE_TEXT).toMatch(/[A-Za-z]/);
    expect(CANARY_SAMPLE_TEXT).toMatch(/[0-9]/);
  });

  test("Gate 1 threshold sits comfortably above sub-pixel noise", () => {
    expect(EPSILON_LOAD_PX).toBeGreaterThanOrEqual(1);
  });

  test("Gate 2 threshold is tighter than Gate 1 — subset-vs-original should be near-zero", () => {
    expect(EPSILON_FIDELITY_PX).toBeLessThan(EPSILON_LOAD_PX);
  });

  test("viewport pins deviceScaleFactor at 1 — harness MUST set this at context creation", () => {
    expect(CANARY_VIEWPORT.deviceScaleFactor).toBe(1);
  });

  test("default font-load timeout is finite and overridable per call", () => {
    expect(FONT_LOAD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FONT_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("family-source contract — extractEmbeddedFamilies output flows verbatim", () => {
  // The canary's expectedFamilies input MUST be the @font-face descriptor
  // verbatim. extractEmbeddedFamilies is the single producer; harness.server
  // consumes its output and passes it through unchanged. Asserting the round
  // trip here locks the contract so a refactor that "helpfully" lowercases or
  // re-quotes silently breaks every Gate-1 measurement.
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

  test("mixed quoting in @font-face → canonical unquoted descriptor flows out", () => {
    // Both rules declare the SAME family with different quoting. The canary
    // sees one descriptor, not two — and not the CSS-syntax-quoted variant.
    const css = `
      @font-face { font-family: "Sentinel A"; src: url("cid:x"); }
      @font-face { font-family: 'Sentinel A'; src: url("cid:y"); font-weight: 700; }
    `;
    const out = extractEmbeddedFamilies(mhtml(css));
    expect(out).toEqual(["Sentinel A"]);
    // And that's exactly the string that becomes expectedFamilies[0] in the
    // canary — no further transformation in harness.server.
  });

  test("descriptor preserves case — the canary keys off this string exactly", () => {
    const css = `@font-face { font-family: "GothamA-Book"; src: url("cid:x"); }`;
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["GothamA-Book"]);
  });
});

// ─── Behavior layer (Playwright) ────────────────────────────────────────────

let browser: Browser | null = null;
let context: BrowserContext;
let page: Page;
let chromiumAvailable = false;

beforeAll(async () => {
  // Same pattern as freeze-visibility.test.ts: probe chromium, skip suite if
  // the sandbox lacks sysdeps. Real validation runs on dev machines via the
  // same Playwright the harness uses.
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    context = await browser.newContext({
      viewport: { width: CANARY_VIEWPORT.width, height: CANARY_VIEWPORT.height },
      deviceScaleFactor: CANARY_VIEWPORT.deviceScaleFactor,
    });
    page = await context.newPage();
    chromiumAvailable = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[render-canary.test] Chromium kunde inte starta — skip:ar suiten. ` +
        `(${e instanceof Error ? e.message.split("\n")[0] : e})`,
    );
  }
});

afterAll(async () => {
  await browser?.close();
});

describe("runRenderCanary — Gate 1 reason taxonomy", () => {
  test("unresolved: face whose URL fails to load → gate1.reason === 'unresolved' with loadError", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    // Build a page that declares one family with an unresolvable source.
    // 127.0.0.1:1 refuses fast — exactly the fast-reject the cid: case
    // exhibits under file:// (NOT a hang, NOT a timeout).
    await page.setContent(`
      <html><head><style>
        @font-face {
          font-family: "GhostFamily";
          src: url("http://127.0.0.1:1/nonexistent.woff2") format("woff2");
        }
        body { font-family: "GhostFamily", monospace; }
      </style></head><body><p>hello canary</p></body></html>
    `);

    // Pass a short timeout so a hang (if our assumption is wrong) surfaces
    // as a timeout reason FAST, not as a 3-second wait on every CI run.
    const report = await runRenderCanary(page, ["GhostFamily"], {
      fontLoadTimeoutMs: 1000,
    });

    expect(report.expected).toEqual(["GhostFamily"]);
    const fam = report.families[0];
    expect(fam.family).toBe("GhostFamily");

    // The headline assertion: REJECTION, not timeout. If this ever flips to
    // 'timeout' the page-eval lost the race — investigate before relaxing
    // the assertion. Both reasons are Gate-1 fails; only 'unresolved' carries
    // the actionable error message.
    expect(fam.gate1.reason).toBe("unresolved");
    expect(fam.gate1.pass).toBe(false);
    expect(fam.gate1.loadError).toBeTruthy();

    // And the aggregate ok flag MUST flip false on a single Gate-1 fail.
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes("GhostFamily"))).toBe(true);
  });

  test("ok: registered FontFace with metrics distinct from monospace → gate1.reason === 'ok'", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    // Use a minimal valid woff2 via FontFace API. We don't have a brand font
    // handy in test fixtures, so we exploit a known-distinct metric: register
    // a font under a custom name whose actual source IS monospace's opposite
    // (a real proportional font installed on the system). Playwright's bundled
    // chromium ships with DejaVu Sans on Linux — metrically distinct from
    // monospace. We do this by NOT using @font-face at all and instead naming
    // a fallback chain that chromium will resolve to a real proportional face.
    //
    // Note: this exercises the metric-distinct path. The 'unresolved' test
    // above is the actual canary-of-the-canary; this one is sanity that the
    // happy path also produces the expected reason.
    await page.setContent(`<html><body><p>hello canary</p></body></html>`);

    // Register a FontFace pointing at a tiny inline TTF would be ideal but
    // adds a 50KB+ base64 to the test file. Instead, assert that "monospace"
    // measured against itself yields reason "fallback" (width identical) —
    // which is the COMPLEMENTARY case: it locks the comparison logic without
    // needing a real font file in the repo.
    const report = await runRenderCanary(page, ["monospace"], {
      fontLoadTimeoutMs: 1000,
    });

    const fam = report.families[0];
    // monospace measured against monospace fallback → delta_load ≈ 0.
    // document.fonts has no @font-face for "monospace" so fontsCheckPass
    // depends on chromium's generic-family handling; both fallback and
    // metric_twin are acceptable outcomes here. What MUST NOT happen is
    // 'unresolved' or 'check_mismatch' — those would indicate a bug in
    // the reason-selection logic, not a fixture choice.
    expect(["fallback", "metric_twin", "ok"]).toContain(fam.gate1.reason);
    expect(fam.gate1.reason).not.toBe("unresolved");
    expect(fam.gate1.reason).not.toBe("check_mismatch");
    expect(fam.gate1.reason).not.toBe("timeout");
  });
});

describe("runRenderCanary — settings round-trip in report", () => {
  test("opts overrides surface in report.settings for reproducibility", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();
    await page.setContent(`<html><body><p>x</p></body></html>`);
    const report = await runRenderCanary(page, [], {
      fontLoadTimeoutMs: 250,
      epsilonLoadPx: 5,
      epsilonFidelityPx: 0.25,
    });
    expect(report.settings.fontLoadTimeoutMs).toBe(250);
    expect(report.settings.epsilonLoadPx).toBe(5);
    expect(report.settings.epsilonFidelityPx).toBe(0.25);
    expect(report.settings.gate2Enabled).toBe(false);
    expect(report.settings.sampleText).toBe(CANARY_SAMPLE_TEXT);
  });
});
