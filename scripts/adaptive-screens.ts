// Angel Adaptive — before/after screenshot demo.
//
// Renders the demo page, screenshots it, injects the bundled snippet, calls
// adapt() (apply the safe patterns), screenshots again, then revert()s and
// screenshots a third time to prove it restores the original. Visual proof that
// the snippet DYNAMICALLY changes a page — reversibly, from existing content.
import { chromium } from "playwright";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const BUNDLE = join(REPO, "public/adaptive.js");
const OUT = process.argv[2] || REPO;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  const tmp = mkdtempSync(join(tmpdir(), "screens-"));
  // Strip the auto-loading tag; we inject the bundle manually so we control
  // exactly when the page is original vs adapted.
  const html = readFileSync(join(REPO, "public/demo/index.html"), "utf8").replace(
    '<script src="/adaptive.js" data-site-id="demo"></script>',
    "",
  );
  writeFileSync(join(tmp, "index.html"), html);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 1,
  });
  await ctx.route("**/*", (r) =>
    r.request().url().startsWith("file://") ? r.continue() : r.abort(),
  );
  const page = await ctx.newPage();
  await page.goto(`file://${join(tmp, "index.html")}`, { waitUntil: "load", timeout: 30_000 });
  await sleep(500);

  await page.screenshot({ path: join(OUT, "angel-1-before.png") });

  const bundle = readFileSync(BUNDLE, "utf8");
  await page.addScriptTag({ content: bundle });
  await sleep(1300); // let the snippet settle + crawl
  const applied = await page.evaluate(() =>
    (window as unknown as { __angelAdaptive: { adapt: () => unknown } }).__angelAdaptive.adapt(),
  );
  await sleep(400);
  await page.screenshot({ path: join(OUT, "angel-2-after.png") });

  await page.evaluate(() =>
    (window as unknown as { __angelAdaptive: { revert: () => void } }).__angelAdaptive.revert(),
  );
  await sleep(300);
  await page.screenshot({ path: join(OUT, "angel-3-reverted.png") });

  console.log("applied adaptations: " + JSON.stringify(applied, null, 2));
  await ctx.close();
  rmSync(tmp, { recursive: true, force: true });
  await browser.close();
})();
