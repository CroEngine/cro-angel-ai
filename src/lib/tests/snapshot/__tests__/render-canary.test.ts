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

  test("cidOnly scopes to faces actually embedded — the size-gate canary contract", () => {
    // A big site after the size-gate: the used family got a cid: face; an unused
    // family was left external (relative src, like Apple) or absolute (like
    // Salesforce). The canary must verify the embedded one and SKIP the dropped
    // ones (they never render and can't resolve at file:// replay).
    const css = `
      @font-face { font-family: "Used"; src: url("cid:font-abc@snapshot"); }
      @font-face { font-family: "DroppedRel"; src: url("/wss/fonts/x.woff2"); }
      @font-face { font-family: "DroppedAbs"; src: url("https://cdn.example.com/y.woff2"); }
    `;
    // Default (every declared remote face) sees all three…
    expect(extractEmbeddedFamilies(mhtml(css))).toEqual(["DroppedAbs", "DroppedRel", "Used"]);
    // …cidOnly sees only the one with a cid: src → exactly the canary manifest.
    expect(extractEmbeddedFamilies(mhtml(css), { cidOnly: true })).toEqual(["Used"]);
  });

  test("cidOnly is a no-op when every face is embedded (the corpus case)", () => {
    // Small sites embed everything → every face is cid: → cidOnly === default.
    // This is the property that keeps hubspot/linear canary manifests unchanged.
    const css = `
      @font-face { font-family: "A"; src: url("cid:1@s"); }
      @font-face { font-family: "B"; src: url("cid:2@s"); font-weight: 700; }
    `;
    const all = extractEmbeddedFamilies(mhtml(css));
    const cid = extractEmbeddedFamilies(mhtml(css), { cidOnly: true });
    expect(cid).toEqual(all);
    expect(cid).toEqual(["A", "B"]);
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

  test("descriptor_missing: a bare CSS generic has no @font-face descriptor → gate1.reason === 'descriptor_missing'", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    // A CSS generic ("monospace") is never declared by an @font-face, so
    // document.fonts.load("1em monospace", sample) resolves to [] AND no
    // descriptor matches → the canary classifies it descriptor_missing. Real
    // manifests never contain generics (extractMainDocumentFamilies /
    // extractEmbeddedFamilies only ever return @font-face families), so this is
    // the generic-name edge of the same branch the "typo" test below exercises
    // with an unregistered brand name. The 'fallback' path (descriptor present
    // but sample out of unicode-range) is covered by the next test.
    await page.setContent(`<html><body><p>hello canary</p></body></html>`);

    const report = await runRenderCanary(page, ["monospace"], {
      fontLoadTimeoutMs: 1000,
    });

    const fam = report.families[0];
    expect(fam.gate1.reason).toBe("descriptor_missing");
    expect(fam.gate1.pass).toBe(false);
    expect(fam.gate1.loadError).toBe("no face matched descriptor");
    expect(fam.registered).toBe(false);
    // MUST NOT collapse to a load-failure or name-mismatch reason — those would
    // indicate a bug in reason selection, not a fixture choice.
    expect(fam.gate1.reason).not.toBe("unresolved");
    expect(fam.gate1.reason).not.toBe("check_mismatch");
    expect(fam.gate1.reason).not.toBe("timeout");
  });

  // A2 discriminator: document.fonts.load(family, text) resolves to []
  // in two distinct cases — descriptor-absent vs descriptor-present-but-
  // unicode-range-excluded. Must split, or unicode-range exclusion (the
  // most likely fallback cause on real marketing sites with latin /
  // latin-ext subsets) gets misrouted to canonicalization.
  //
  // These tests MUST run in a real browser engine. jsdom's document.fonts
  // is a non-functional stub that won't reproduce empty-on-out-of-range
  // or honor unicode-range at load time. A jsdom version locks in the
  // collapse the discriminator exists to prevent.
  test("A2: empty load + descriptor match (unicode-range excludes sample) → descriptor-present (fallback|metric_twin), NOT check_mismatch/descriptor_missing", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    await page.setContent(`<html><body><p>x</p></body></html>`);

    // Register a FontFace whose unicode-range is DISJOINT from the canary
    // sample text. CANARY_SAMPLE_TEXT is Latin letters + ASCII digits (incl.
    // uppercase), so a U+0041-005A (A-Z) range would actually overlap "T" and
    // trigger a load of the junk URL → unresolved. Use a Cyrillic range with
    // zero overlap: the sample has no codepoint in it, so
    // document.fonts.load("Brand", sample) is spec-required to return []
    // WITHOUT attempting the (junk) URL — the range filter excludes the face
    // before any load. A descriptor for "Brand" still exists, so
    // hasDescriptorMatch is true → fallback, NOT descriptor_missing.
    await page.evaluate(() => {
      const face = new FontFace(
        "Brand",
        "url(data:font/woff2;base64,d09GMgABAAAAAAAA)",
        { unicodeRange: "U+0400-04FF" },
      );
      document.fonts.add(face);
    });

    const report = await runRenderCanary(page, ["Brand"], {
      fontLoadTimeoutMs: 1000,
    });
    const fam = report.families[0];

    // Headline: the descriptor IS registered, the range merely excluded the
    // sample. The canary MUST route this to the descriptor-PRESENT side — NOT
    // check_mismatch (a name mismatch) and NOT descriptor_missing (no descriptor
    // at all, the typo case below). Whether it lands on 'fallback' (fonts.check
    // false) or 'metric_twin' (fonts.check true) depends on how this chromium
    // reports an out-of-range descriptor to fonts.check; both are
    // descriptor-present outcomes, so accept either rather than pin a
    // chromium-version detail.
    expect(fam.gate1.reason).not.toBe("check_mismatch");
    expect(fam.gate1.reason).not.toBe("descriptor_missing");
    expect(["fallback", "metric_twin"]).toContain(fam.gate1.reason);
    expect(fam.registered).toBe(true);
  });

  test("A2: empty load + NO descriptor match (typo) → 'descriptor_missing' with loadError", async (ctx) => {
    if (!chromiumAvailable) return ctx.skip();

    await page.setContent(`<html><body><p>x</p></body></html>`);

    await page.evaluate(() => {
      const face = new FontFace(
        "Brand",
        "url(data:font/woff2;base64,d09GMgABAAAAAAAA)",
        { unicodeRange: "U+0041-005A" },
      );
      document.fonts.add(face);
    });

    // Query for "Brnad" (typo): no FontFace has this descriptor → manifest
    // names a family no @font-face declares → descriptor_missing with the
    // actionable error message. Fix lives in extractDeclaredFamilies, NOT in
    // check-string canonicalization — which is why this is a distinct reason
    // from check_mismatch.
    const report = await runRenderCanary(page, ["Brnad"], {
      fontLoadTimeoutMs: 1000,
    });
    const fam = report.families[0];

    expect(fam.gate1.reason).toBe("descriptor_missing");
    expect(fam.gate1.pass).toBe(false);
    expect(fam.gate1.loadError).toBe("no face matched descriptor");
    expect(fam.registered).toBe(false);
  });

  // check_mismatch is the (distinct && !fontsCheckPass) defensive branch.
  // No deterministic fixture: distinct⟹check by construction. w_with measures
  // `family, <fallback>` and w_fallback measures `<fallback>` alone with the
  // same stack — everything but the family's contribution cancels, so
  // delta>EPS requires the family actually rendered, which requires it loaded,
  // which makes check(family)=true. Add canonMismatch=false (asserted by the
  // Gate1Diag side field) and the historical "non-canonical check string"
  // path is also closed. The only residual ways to fire are timing slips
  // (we await fonts.ready), subpixel noise pushing a non-distinct row above
  // EPS, or a regression. None reproduce deterministically across machines,
  // so we skip rather than ship a flaky fixture. The branch's value is as
  // a fail-safe at runtime, not as a tested code path.
  test.skip(
    "check_mismatch (distinct && !fontsCheckPass): defensive branch, distinct⟹check by construction, no deterministic fixture",
    () => {
      /* intentionally unreachable — see comment above */
    },
  );
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
