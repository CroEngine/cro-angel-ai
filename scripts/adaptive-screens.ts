// Angel Adaptive — before/after/revert screenshots of the snippet adapting a
// page. Works on the demo OR a real FROZEN capture (corpus name / fixture path),
// so we can test the adaptation on real sites locally — no Browserbase needed.
//
//   bun run scripts/adaptive-screens.ts --out=<dir> demo
//   bun run scripts/adaptive-screens.ts --out=<dir> hubspot
//   bun run scripts/adaptive-screens.ts --out=<dir> fixtures/drift-survey/saas-landing/stripe/page.mhtml
import { chromium, type Browser, type Page } from "playwright";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, isAbsolute, basename } from "node:path";

const REPO = join(dirname(new URL(import.meta.url).pathname), "..");
const BUNDLE = join(REPO, "public/adaptive.js");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const OUT = (process.argv.find((a) => a.startsWith("--out=")) ?? `--out=${REPO}`).slice(6);
const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function resolveTarget(t: string): { path: string; label: string; isDemo: boolean } | null {
  if (t === "demo")
    return { path: join(REPO, "public/demo/index.html"), label: "demo", isDemo: true };
  if (t.endsWith(".mhtml") || t.endsWith(".html")) {
    const p = isAbsolute(t) ? t : join(REPO, t);
    return existsSync(p)
      ? { path: p, label: basename(dirname(p)) || basename(p), isDemo: false }
      : null;
  }
  const c = join(REPO, "corpus", t, "page.mhtml");
  return existsSync(c) ? { path: c, label: t, isDemo: false } : null;
}

async function stable(page: Page, tries = 40) {
  let streak = 0,
    last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const u = await page.evaluate(() => location.href);
      streak = u === last ? streak + 1 : 1;
      last = u;
      if (streak >= 2) return;
    } catch {
      streak = 0;
    }
    await sleep(200);
  }
}
async function warmup(page: Page) {
  try {
    await page.evaluate(() => {
      const h = document.documentElement.scrollHeight;
      for (let i = 0; i <= 8; i++) window.scrollTo(0, (h / 8) * i);
      window.scrollTo(0, 0);
    });
  } catch {
    /* best-effort */
  }
}

async function run(browser: Browser, t: string) {
  const r = resolveTarget(t);
  if (!r) {
    console.log(`[skip] ${t}`);
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), "screens-"));
  const isMhtml = r.path.endsWith(".mhtml");
  const file = join(tmp, isMhtml ? "page.mhtml" : "index.html");
  if (r.isDemo) {
    // strip the auto-load tag so we control when the page is original vs adapted
    writeFileSync(
      file,
      readFileSync(r.path, "utf8").replace(
        '<script src="/adaptive.js" data-site-id="demo"></script>',
        "",
      ),
    );
  } else {
    copyFileSync(r.path, file);
  }
  // bypassCSP simulates the customer allowlisting Angel in their CSP (which they
  // must do to install the snippet) — so the test mirrors the intended install.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1200 },
    deviceScaleFactor: 1,
    bypassCSP: true,
  });
  await ctx.route("**/*", (rq) =>
    rq.request().url().startsWith("file://") ? rq.continue() : rq.abort(),
  );
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [${r.label}] pageerror: ${e.message.split("\n")[0]}`));
  try {
    await page.goto(`file://${file}`, { waitUntil: "load", timeout: 30_000 });
    await sleep(800);
    await stable(page);
    await warmup(page);
    await sleep(500);
    await stable(page);
    await page.screenshot({ path: join(OUT, `adapt-${r.label}-1-before.png`) });

    // Frozen MHTML disables <script> execution AND setTimeout; page.evaluate
    // runs via CDP and bypasses the former. Because timers don't fire, the
    // snippet's async auto-crawl never runs here — so drive the (eval-free)
    // crawl synchronously for the test. On a real live site neither workaround
    // is needed: the <script> tag and timers just work.
    await page.evaluate(
      readFileSync(BUNDLE, "utf8")
        .trim()
        .replace(/;+\s*$/, ""),
    );
    await sleep(800);
    const applied = await page.evaluate(() => {
      const a = (
        window as unknown as {
          __angelAdaptive?: { inventory?: unknown; collect: () => unknown; adapt: () => unknown };
        }
      ).__angelAdaptive;
      if (!a) return null;
      if (!a.inventory) a.inventory = a.collect();
      return a.adapt();
    });
    await sleep(500);
    await page.screenshot({ path: join(OUT, `adapt-${r.label}-2-after.png`) });
    console.log(`${r.label}: ${JSON.stringify(applied)}`);
  } catch (e) {
    console.log(`[${r.label}] failed: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  for (const t of targets.length ? targets : ["demo"]) await run(browser, t);
  await browser.close();
})();
