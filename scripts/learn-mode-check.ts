// Angel Adaptive — learn-mode gate assertions.
//
//   bun run scripts/learn-mode-check.ts
//
// Proves the "first we collect data, then we optimise" contract end-to-end via
// the REAL install path (a one-line <script src>, timers firing) on the demo:
//
//   * learn (default, no data-mode): builds the inventory AND tracks behavior
//     (pageview, scroll depth, time, CTA clicks) but changes NOTHING on the page
//     — applied is empty, no [data-angel-adaptation] nodes exist.
//   * adaptive (data-mode="adaptive"): does the same collection AND applies the
//     safe patterns — applied is non-empty, the trust bar is in the DOM.
//
// Exits non-zero if any assertion fails, so it can gate CI like the smoke test.
import { chromium, type Browser, type Page } from "playwright";
import { copyFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const BUNDLE = join(REPO, "public/adaptive.js");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Snapshot = {
  found: boolean;
  mode?: string;
  inventoryReady: boolean;
  ctaCount: number;
  eventTypes: string[];
  maxScroll: number;
  appliedCount: number;
  domAdaptationNodes: number;
};

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// Render the demo with a controlled <script> tag (optionally data-mode="adaptive").
async function load(browser: Browser, adaptive: boolean): Promise<Page> {
  const tmp = mkdtempSync(join(tmpdir(), "learn-mode-"));
  const tag = adaptive
    ? '<script src="adaptive.js" data-site-id="demo" data-mode="adaptive"></script>'
    : '<script src="adaptive.js" data-site-id="demo"></script>';
  const html = readFileSync(join(REPO, "public/demo/index.html"), "utf8").replace(
    '<script src="/adaptive.js" data-site-id="demo"></script>',
    tag,
  );
  writeFileSync(join(tmp, "index.html"), html);
  copyFileSync(BUNDLE, join(tmp, "adaptive.js"));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith("file://") ? r.continue() : r.abort(),
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`    pageerror: ${e.message.split("\n")[0]}`));
  await page.goto(`file://${join(tmp, "index.html")}`, { waitUntil: "load", timeout: 30_000 });
  (page as unknown as { __tmp: string }).__tmp = tmp;
  return page;
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const a = (
      window as unknown as {
        __angelAdaptive?: {
          mode?: string;
          inventory?: { ctas?: unknown[] } | null;
          events?: Array<{ type: string; value?: number }>;
          applied?: unknown[];
        };
      }
    ).__angelAdaptive;
    const events = a?.events ?? [];
    const scroll = events.filter((e) => e.type === "scroll_depth").map((e) => e.value ?? 0);
    return {
      found: !!a,
      mode: a?.mode,
      inventoryReady: !!a?.inventory,
      ctaCount: a?.inventory?.ctas?.length ?? 0,
      eventTypes: Array.from(new Set(events.map((e) => e.type))),
      maxScroll: scroll.length ? Math.max(...scroll) : 0,
      appliedCount: a?.applied?.length ?? 0,
      domAdaptationNodes: document.querySelectorAll("[data-angel-adaptation]").length,
    };
  });
}

// Exercise the passive tracker: scroll the page, click a detected CTA (without
// letting an <a> navigate away), then flush via pagehide — the same lifecycle a
// real visit ends with.
async function exercise(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = document.documentElement.scrollHeight;
    for (let i = 0; i <= 8; i++) window.scrollTo(0, (h / 8) * i);
  });
  await sleep(150);
  await page.evaluate(() => {
    const a = (
      window as unknown as {
        __angelAdaptive?: { inventory?: { ctas?: Array<{ selector?: string }> } };
      }
    ).__angelAdaptive;
    const sel = a?.inventory?.ctas?.find((c) => c.selector)?.selector;
    const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
    if (el) {
      // Suppress default navigation so the file:// page stays put; the tracker's
      // capture-phase listener still sees the click.
      const stop = (ev: Event) => ev.preventDefault();
      document.addEventListener("click", stop, true);
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      document.removeEventListener("click", stop, true);
    }
    window.dispatchEvent(new Event("pagehide"));
  });
  await sleep(100);
}

async function cleanup(page: Page): Promise<void> {
  const tmp = (page as unknown as { __tmp?: string }).__tmp;
  await page.context().close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });

  // ── learn mode (default) ────────────────────────────────────────────────
  console.log("\n================ learn mode (default) ================");
  {
    const page = await load(browser, false);
    await sleep(2500); // snippet settles content then crawls + starts tracking
    const before = await snapshot(page);
    check("snippet ran", before.found);
    check("mode is learn", before.mode === "learn", before.mode);
    check("inventory collected", before.inventoryReady, `${before.ctaCount} CTAs`);
    check("pageview tracked", before.eventTypes.includes("pageview"));
    check(
      "DOM unchanged: applied is empty",
      before.appliedCount === 0,
      `applied=${before.appliedCount}`,
    );
    check("DOM unchanged: no adaptation nodes", before.domAdaptationNodes === 0);

    await exercise(page);
    const after = await snapshot(page);
    check(
      "scroll depth tracked",
      after.eventTypes.includes("scroll_depth"),
      `max=${after.maxScroll}%`,
    );
    check("time on page tracked", after.eventTypes.includes("time_on_page"));
    check("cta click tracked", after.eventTypes.includes("cta_click"));
    check(
      "STILL no DOM mutation after interaction",
      after.domAdaptationNodes === 0 && after.appliedCount === 0,
    );
    await cleanup(page);
  }

  // ── adaptive mode (opt-in) ──────────────────────────────────────────────
  console.log('\n================ adaptive mode (data-mode="adaptive") ================');
  {
    const page = await load(browser, true);
    await sleep(2500);
    const snap = await snapshot(page);
    check("snippet ran", snap.found);
    check("mode is adaptive", snap.mode === "adaptive", snap.mode);
    check("inventory collected", snap.inventoryReady, `${snap.ctaCount} CTAs`);
    check("pageview tracked (collection still runs)", snap.eventTypes.includes("pageview"));
    check("patterns applied", snap.appliedCount > 0, `applied=${snap.appliedCount}`);
    check(
      "adaptation nodes present in DOM",
      snap.domAdaptationNodes > 0,
      `nodes=${snap.domAdaptationNodes}`,
    );
    await cleanup(page);
  }

  await browser.close();
  console.log(
    `\n${failures === 0 ? "✓ all learn-mode assertions passed" : `✗ ${failures} assertion(s) failed`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
